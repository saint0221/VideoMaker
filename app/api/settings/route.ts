import { NextRequest, NextResponse } from 'next/server';
import { loadSettings, saveSettings } from '@/lib/settings';
import type { Settings } from '@/lib/settings';

export async function GET() {
  return NextResponse.json(loadSettings());
}

export async function PATCH(req: NextRequest) {
  const body: Partial<Settings> = await req.json();
  const current = loadSettings();
  const updated: Settings = { ...current };
  if (typeof body.capcutRoot === 'string' && body.capcutRoot.trim()) {
    updated.capcutRoot = body.capcutRoot.trim();
  }
  if (typeof body.voiceId === 'string') {
    updated.voiceId = body.voiceId || undefined;
  }
  saveSettings(updated);
  return NextResponse.json(updated);
}
