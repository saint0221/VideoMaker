import { NextResponse } from 'next/server';

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  preview_url: string;
  labels: Record<string, string>;
}

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ELEVENLABS_API_KEY 없음' }, { status: 400 });
  }

  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': apiKey },
  });

  if (!res.ok) {
    return NextResponse.json({ error: `ElevenLabs 오류: ${res.status}` }, { status: res.status });
  }

  const data = await res.json() as { voices: ElevenLabsVoice[] };
  const voices = data.voices.map(v => ({
    voice_id: v.voice_id,
    name: v.name,
    category: v.category,
    preview_url: v.preview_url,
    labels: v.labels,
  }));

  return NextResponse.json({ voices });
}
