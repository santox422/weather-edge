import { NextResponse } from 'next/server';
import { updateSettings } from '@/lib/services/paper-db.js';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    updateSettings(body);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
