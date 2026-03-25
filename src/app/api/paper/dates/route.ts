// @ts-nocheck
import { NextResponse } from 'next/server';
import { getCityMarketsMultiDay } from '@/lib/services/polymarket-service.js';

export async function GET() {
  try {
    // Only return today + 2 future days (no historical data)
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const dayAfter = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];
    const targetDates = [today, tomorrow, dayAfter];

    let marketDates: string[] = [];
    try {
      const multi = await getCityMarketsMultiDay(14);
      const allDates = new Set<string>();
      for (const city of multi.cities) {
        for (const d of Object.keys(city.marketsByDate || {})) allDates.add(d);
      }
      // Only keep dates that are today or in the future (max 3 days)
      marketDates = [...allDates].filter(d => targetDates.includes(d)).sort();
    } catch {}

    // Use market dates if available, otherwise fall back to the 3-day window
    const dates = marketDates.length > 0 ? marketDates : targetDates;
    return NextResponse.json({ dates, marketDates });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
