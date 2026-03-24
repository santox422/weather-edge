// @ts-nocheck — JS service modules
import { NextResponse } from 'next/server';
import { getCityMarkets } from '@/lib/services/polymarket-service.js';

const cache = new Map();
const TTL = 90_000;

export async function GET() {
  try {
    const c = cache.get('cities');
    if (c && Date.now() - c.ts < TTL) return NextResponse.json(c.data);

    console.log('[INFO] Fetching city markets...');
    const cities = await getCityMarkets();
    console.log(`[OK] ${cities.filter(c => c.activeMarket).length}/${cities.length} cities have active markets`);
    cache.set('cities', { data: cities, ts: Date.now() });
    return NextResponse.json(cities);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
