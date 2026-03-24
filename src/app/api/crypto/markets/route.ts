// @ts-nocheck
import { NextResponse } from 'next/server';
import { getBitcoinMarkets } from '@/lib/services/crypto-service.js';
import { extractCryptoFeatures, deriveProbability, evaluateCryptoTrade } from '@/lib/analysis/crypto-engine.js';

const cache = new Map();
const TTL = 90_000;

export async function GET() {
  try {
    const c = cache.get('crypto_markets');
    if (c && Date.now() - c.ts < TTL) return NextResponse.json(c.data);
    console.log('[CRYPTO] Fetching BTC Polymarket events...');
    const markets = await getBitcoinMarkets();
    cache.set('crypto_markets', { data: markets, ts: Date.now() });
    return NextResponse.json(markets);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
