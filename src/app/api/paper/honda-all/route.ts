// @ts-nocheck
import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import { join } from 'path';

let hondaDb: any = null;
try {
  hondaDb = new Database(join(process.cwd(), 'strategy-analyzer', 'hondacivic.db'), { readonly: true });
} catch {}

export async function GET() {
  if (!hondaDb) return NextResponse.json({ dates: {} });
  try {
    const rows = hondaDb.prepare(`
      SELECT city, target_date, temperature, temp_high, unit, outcome,
             SUM(CASE WHEN side='BUY' THEN usdc_size ELSE 0 END) as buy_cost,
             SUM(CASE WHEN side='SELL' THEN usdc_size ELSE 0 END) as sell_proceeds,
             SUM(CASE WHEN side='BUY' THEN size ELSE 0 END) as buy_shares,
             SUM(CASE WHEN side='SELL' THEN size ELSE 0 END) as sell_shares,
             COUNT(*) as trade_count
      FROM trades WHERE type='TRADE'
      GROUP BY city, target_date, temperature, temp_high, unit, outcome
      ORDER BY target_date DESC, city, outcome DESC, temperature
    `).all();

    const redeems = hondaDb.prepare(`
      SELECT city, target_date, temperature, SUM(usdc_size) as redeemed
      FROM trades WHERE type='REDEEM'
      GROUP BY city, target_date, temperature
    `).all();

    const redeemMap: Record<string, number> = {};
    for (const r of redeems) redeemMap[`${r.city}|${r.target_date}|${r.temperature}`] = r.redeemed;

    const dates: Record<string, any> = {};
    for (const r of rows) {
      if (!dates[r.target_date]) dates[r.target_date] = {};
      if (!dates[r.target_date][r.city]) {
        dates[r.target_date][r.city] = { city: r.city, unit: r.unit, yesPositions: [], noPositions: [], totalYesCost: 0, totalNoCost: 0, tradeCount: 0 };
      }
      const cd = dates[r.target_date][r.city];
      const netCost = r.buy_cost - r.sell_proceeds;
      const netShares = r.buy_shares - r.sell_shares;
      const label = r.temp_high && r.temp_high !== 999 ? `${r.temperature}-${r.temp_high}°${r.unit}` : r.temp_high === 999 ? `${r.temperature}°${r.unit}+` : `${r.temperature}°${r.unit}`;
      const redeemed = redeemMap[`${r.city}|${r.target_date}|${r.temperature}`] || 0;
      const pos = { temp: r.temperature, label, netCost: +netCost.toFixed(2), netShares: +netShares.toFixed(1), redeemed, trades: r.trade_count };

      if (r.outcome === 'Yes') { cd.yesPositions.push(pos); cd.totalYesCost += Math.max(0, netCost); }
      else { cd.noPositions.push(pos); cd.totalNoCost += Math.max(0, netCost); }
      cd.tradeCount += r.trade_count;
    }

    for (const [date, cities] of Object.entries(dates)) {
      for (const cd of Object.values(cities as any)) {
        (cd as any).totalYesCost = +(cd as any).totalYesCost.toFixed(2);
        (cd as any).totalNoCost = +(cd as any).totalNoCost.toFixed(2);
        (cd as any).totalCost = +((cd as any).totalYesCost + (cd as any).totalNoCost).toFixed(2);
        (cd as any).totalRedeemed = +[...(cd as any).yesPositions, ...(cd as any).noPositions].reduce((s: number, p: any) => s + p.redeemed, 0).toFixed(2);
        (cd as any).estimatedPnl = +((cd as any).totalRedeemed - (cd as any).totalCost).toFixed(2);
        const topYes = (cd as any).yesPositions.sort((a: any, b: any) => b.netCost - a.netCost)[0];
        (cd as any).mainYesBracket = topYes?.label || null;
        (cd as any).mainYesPrice = topYes && topYes.netShares > 0 ? +((topYes.netCost / topYes.netShares) * 100).toFixed(1) : 0;
      }
      dates[date] = Object.values(cities as any);
    }

    return NextResponse.json({ dates });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
