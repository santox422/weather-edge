// @ts-nocheck
import { NextResponse } from 'next/server';
import { runPaperAnalysis } from '@/lib/services/paper-trade-engine.js';

const paperCache = new Map();
const PAPER_TTL = 5 * 60 * 1000;

export async function GET(request: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  try {
    const cached = paperCache.get(date);
    if (cached && Date.now() - cached.ts < PAPER_TTL) {
      return NextResponse.json(cached.data);
    }
    console.log(`[PAPER] Analyzing ${date}...`);
    const result = await runPaperAnalysis(date);
    paperCache.set(date, { ts: Date.now(), data: result });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[PAPER] Analysis error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
