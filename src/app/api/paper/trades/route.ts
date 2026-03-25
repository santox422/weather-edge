// @ts-nocheck
import { NextResponse } from 'next/server';
import { getTrades } from '@/lib/services/paper-trade-store.js';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || undefined;
    const city = searchParams.get('city') || undefined;
    const trades = getTrades({ date, city });
    return NextResponse.json({ trades });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
