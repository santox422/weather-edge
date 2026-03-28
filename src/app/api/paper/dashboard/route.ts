// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSettings, getModelPortfolios, getAllTrades, getAllSignals, getAllDailyEvents, deleteFutureTrades } from '@/lib/services/paper-db.js';
import { getCityMarketsMultiDay } from '@/lib/services/polymarket-service.js';
import Database from 'better-sqlite3';
import { join } from 'path';

let hondaDb: any = null;
try {
  hondaDb = new Database(join(process.cwd(), 'strategy-analyzer', 'hondacivic.db'), { readonly: true });
} catch {}

export async function GET() {
  try {
    // Cleanup: purge any trades/signals wrongly created for future dates
    const todayStr = new Date().toISOString().split('T')[0];
    const cleanup = deleteFutureTrades(todayStr);
    if (cleanup.trades + cleanup.signals + cleanup.events > 0) {
      console.log(`[PAPER-CLEANUP] Purged future entries: ${cleanup.trades} trades, ${cleanup.signals} signals, ${cleanup.events} events`);
    }

    const settings = getSettings();
    const portfolios = getModelPortfolios();
    const trades = getAllTrades();
    const signals = getAllSignals();
    const events = getAllDailyEvents();

    let hcDates = {};
    if (hondaDb) {
      const hcPositions = hondaDb.prepare(`
        SELECT city, target_date, temperature, temp_high, unit, outcome,
               SUM(CASE WHEN side='BUY' THEN usdc_size ELSE 0 END) as buy_cost,
               SUM(CASE WHEN side='SELL' THEN usdc_size ELSE 0 END) as sell_proceeds,
               SUM(CASE WHEN side='BUY' THEN size ELSE 0 END) as buy_shares,
               SUM(CASE WHEN side='SELL' THEN size ELSE 0 END) as sell_shares,
               COUNT(*) as trade_count
        FROM trades WHERE type='TRADE'
        GROUP BY city, target_date, temperature, temp_high, unit, outcome
      `).all();

      const hcRedeems = hondaDb.prepare(`
        SELECT city, target_date, temperature, SUM(usdc_size) as redeemed
        FROM trades WHERE type='REDEEM'
        GROUP BY city, target_date, temperature
      `).all();

      const redeemMap = {};
      for (const r of hcRedeems) redeemMap[`${r.city}|${r.target_date}|${r.temperature}`] = r.redeemed;

      for (const r of hcPositions) {
        if (!hcDates[r.target_date]) hcDates[r.target_date] = {};
        if (!hcDates[r.target_date][r.city]) {
          hcDates[r.target_date][r.city] = { 
            city: r.city, 
            unit: r.unit, 
            yesPositions: [], 
            noPositions: [], 
            totalYesCost: 0, 
            totalNoCost: 0, 
            tradeCount: 0 
          };
        }
        const cd = hcDates[r.target_date][r.city];
        const netCost = r.buy_cost - r.sell_proceeds;
        const netShares = r.buy_shares - r.sell_shares;
        const label = r.temp_high && r.temp_high !== 999 ? `${r.temperature}-${r.temp_high}°${r.unit}` : r.temp_high === 999 ? `${r.temperature}°${r.unit}+` : `${r.temperature}°${r.unit}`;
        const redeemed = redeemMap[`${r.city}|${r.target_date}|${r.temperature}`] || 0;
        const pos = { temp: r.temperature, label, netCost: +netCost.toFixed(2), netShares: +netShares.toFixed(1), redeemed, trades: r.trade_count };

        if (r.outcome === 'Yes') { cd.yesPositions.push(pos); cd.totalYesCost += Math.max(0, netCost); }
        else { cd.noPositions.push(pos); cd.totalNoCost += Math.max(0, netCost); }
        cd.tradeCount += r.trade_count;
      }
      
      for (const date of Object.keys(hcDates)) {
        for (const cd of Object.values(hcDates[date])) {
           cd.totalCost = cd.totalYesCost + cd.totalNoCost;
           const topYes = cd.yesPositions.sort((a,b)=>b.netCost - a.netCost)[0];
           cd.mainYesBracket = topYes?.label || null;
           cd.mainYesPrice = topYes && topYes.netShares > 0 ? +((topYes.netCost / topYes.netShares) * 100).toFixed(1) : 0;
        }
      }
    }

    // Now format a nice daily report array
    const today = new Date().toISOString().split('T')[0];
    const startDate = settings.start_date || today;
    const datesSet = new Set([...trades.map(t=>t.date), ...signals.map(s=>s.date), ...events.map(e=>e.date), ...Object.keys(hcDates)]);
    // Always include today
    datesSet.add(today);

    // Get active markets for context
    let activeMarkets = {};
    try {
      const multi = await getCityMarketsMultiDay(14);
      for (const city of multi.cities) {
        for (const [date, market] of Object.entries(city.marketsByDate || {})) {
          if (!activeMarkets[date]) activeMarkets[date] = [];
          if (market) activeMarkets[date].push(city.slug);
        }
      }
    } catch {}

    const dates = [...datesSet]
      .filter(date => date >= startDate)
      .sort((a,b)=>b.localeCompare(a))
      .map(date => {
      // Group by city for this date
      const citySet = new Set([
        ...trades.filter(t=>t.date===date).map(t=>t.city),
        ...signals.filter(s=>s.date===date).map(s=>s.city),
        ...events.filter(e=>e.date===date).map(e=>e.city),
        ...(hcDates[date] ? Object.keys(hcDates[date]) : []),
        ...(activeMarkets[date] || [])
      ]);

      const cities = [...citySet].sort().map(city => {
        const cityTrades = trades.filter(t=>t.date===date && t.city===city);
        const citySignals = signals.filter(s=>s.date===date && s.city===city);
        const cityEvents = events.find(e=>e.date===date && e.city===city);
        const hcData = hcDates[date]?.[city] || null;
        const isActive = (activeMarkets[date] || []).includes(city);

        return {
          city,
          isActive,
          final_temp: cityEvents?.final_temp || null,
          winning_bracket: cityEvents?.winning_bracket || null,
          trades: cityTrades,
          signals: citySignals,
          hc: hcData
        };
      });

      return { date, cities };
    });

    return NextResponse.json({
      settings,
      portfolios,
      dates
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
