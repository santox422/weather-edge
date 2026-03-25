// @ts-nocheck
import { NextResponse } from 'next/server';
import { getPortfolio } from '@/lib/services/paper-trade-store.js';

export async function GET() {
  try {
    const portfolio = getPortfolio();
    return NextResponse.json(portfolio);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
