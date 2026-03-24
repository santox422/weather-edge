// @ts-nocheck
import { NextResponse } from 'next/server';
import { getCityMarketsMultiDay } from '@/lib/services/polymarket-service.js';

const cache = new Map();
const TTL = 90_000;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '14');
    const key = `cities_multi_${days}`;
    const c = cache.get(key);
    if (c && Date.now() - c.ts < TTL) return NextResponse.json(c.data);

    console.log(`[INFO] Fetching multi-day markets (${days} days)...`);
    const data = await getCityMarketsMultiDay(days);
    console.log('[OK] Multi-day scan complete');
    cache.set(key, { data, ts: Date.now() });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
