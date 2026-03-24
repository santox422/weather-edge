// @ts-nocheck
import { NextResponse } from 'next/server';
import { getCityMarketsMultiDay } from '@/lib/services/polymarket-service.js';
import Database from 'better-sqlite3';
import { join } from 'path';

let hondaDb: any = null;
try {
  hondaDb = new Database(join(process.cwd(), 'strategy-analyzer', 'hondacivic.db'), { readonly: true });
} catch {}

export async function GET() {
  try {
    const hcDates = hondaDb
      ? hondaDb.prepare(`SELECT DISTINCT target_date FROM trades WHERE type='TRADE' ORDER BY target_date DESC`).all().map((r: any) => r.target_date)
      : [];

    let marketDates: string[] = [];
    try {
      const multi = await getCityMarketsMultiDay(14);
      const allDates = new Set<string>();
      for (const city of multi.cities) {
        for (const d of Object.keys(city.marketsByDate || {})) allDates.add(d);
      }
      marketDates = [...allDates].sort();
    } catch {}

    const allDates = [...new Set([...hcDates, ...marketDates])].sort().reverse();
    return NextResponse.json({ dates: allDates, hcDates, marketDates });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
