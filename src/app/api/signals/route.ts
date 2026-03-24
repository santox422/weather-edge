// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSignalLogs } from '@/lib/analysis/analysis-engine.js';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '7');
    const logs = getSignalLogs(days);
    return NextResponse.json({ count: logs.length, signals: logs });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
