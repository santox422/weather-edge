// @ts-nocheck
import { NextResponse } from 'next/server';
import { runPaperAnalysis, executePaperTrades } from '@/lib/services/paper-trade-engine.js';
import { getPortfolio } from '@/lib/services/paper-trade-store.js';

export async function POST(request: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  try {
    console.log(`[PAPER] Execute trades for ${date}...`);
    const analysis = await runPaperAnalysis(date);
    if (analysis.error) {
      return NextResponse.json({ error: analysis.error }, { status: 400 });
    }
    const result = executePaperTrades(analysis);
    const portfolio = getPortfolio();
    return NextResponse.json({ ...result, portfolio, analysis });
  } catch (err: any) {
    console.error('[PAPER] Execute error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
