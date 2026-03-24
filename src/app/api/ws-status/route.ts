// @ts-nocheck
import { NextResponse } from 'next/server';

export async function GET() {
  const priceFeed = (globalThis as any).__priceFeed;
  const wss = (globalThis as any).__wss;
  return NextResponse.json({
    connected: priceFeed?.connected ?? false,
    subscribedTokens: priceFeed?.subscribedTokens?.size ?? 0,
    browserClients: wss?.clients?.size ?? 0,
    lastPricesCount: priceFeed?.lastPrices?.size ?? 0,
  });
}
