import { NextRequest, NextResponse } from 'next/server';

export interface LibraryVoice {
  public_owner_id: string;
  voice_id: string;
  name: string;
  accent: string;
  gender: string;
  age: string;
  language: string;
  description: string;
  preview_url: string;
  category: string;
  cloned_by_count: number;
  rate: number;
  free_users_allowed: boolean;
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ELEVENLABS_API_KEY 없음' }, { status: 400 });
  }

  const { searchParams } = req.nextUrl;
  const search = searchParams.get('search') ?? '';
  const language = searchParams.get('language') ?? '';
  const page_size = searchParams.get('page_size') ?? '24';

  const params = new URLSearchParams({ page_size });
  if (search) params.set('search', search);
  if (language) params.set('language', language);

  const res = await fetch(`https://api.elevenlabs.io/v1/shared-voices?${params}`, {
    headers: { 'xi-api-key': apiKey },
  });

  if (!res.ok) {
    return NextResponse.json({ error: `ElevenLabs 오류: ${res.status}` }, { status: res.status });
  }

  const data = await res.json() as { voices: LibraryVoice[]; has_more: boolean };
  return NextResponse.json({ voices: data.voices, has_more: data.has_more });
}
