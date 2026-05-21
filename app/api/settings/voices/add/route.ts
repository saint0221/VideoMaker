import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ELEVENLABS_API_KEY 없음' }, { status: 400 });
  }

  const { publicOwnerId, voiceId, name } = await req.json() as {
    publicOwnerId: string;
    voiceId: string;
    name: string;
  };

  const res = await fetch(
    `https://api.elevenlabs.io/v1/voices/add/${publicOwnerId}/${voiceId}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_name: name }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `추가 실패: ${res.status} ${text}` }, { status: res.status });
  }

  const data = await res.json() as { voice_id: string };
  return NextResponse.json({ voice_id: data.voice_id });
}
