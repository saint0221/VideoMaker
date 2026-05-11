import { emit } from '../events';
import { writeFileBinary, writeFile } from '../project';

function parseNarrations(scriptMd: string): Array<{ id: string; text: string }> {
  const scenes: Array<{ id: string; text: string }> = [];
  // Support both ## [SCENE 01 - ...] and ## 씬 01 | ... formats
  const blocks = scriptMd.split(/(?=##\s+(?:\[SCENE\s+\d+|씬\s+\d+))/i);

  for (const block of blocks) {
    const idMatch = block.match(/##\s+(?:\[SCENE\s+(\d+)|씬\s+(\d+))/i);
    if (!idMatch) continue;
    const num = idMatch[1] ?? idMatch[2];
    if (!num) continue;
    const sceneId = num.padStart(2, '0');

    // \n+ handles optional blank line between **나레이션**: and text
    const narrMatch = block.match(
      /\*\*나레이션\*\*:[ \t]*\n+([\s\S]+?)(?=\n\s*\n\*\*이미지|\n\s*\n\*\*사운드|\n---|\n##|$)/i
    );
    if (!narrMatch) continue;

    let text = narrMatch[1].trim();
    // Remove surrounding quotes (Korean and ASCII)
    text = text.replace(/^[""„''"']+|[""„''"']+$/g, '').trim();
    // Skip "no narration" markers like *(없음 — 화면이 말한다)*
    if (/^\*?\(없음[^)]*\)\*?$/.test(text)) continue;
    if (text) scenes.push({ id: sceneId, text });
  }

  return scenes;
}

function formatSRTTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

interface AlignmentData {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

function alignmentToSRT(alignment: AlignmentData): string {
  const { characters, character_start_times_seconds, character_end_times_seconds } = alignment;

  // Group characters into words split by whitespace
  const words: { text: string; start: number; end: number }[] = [];
  let wordChars: string[] = [];
  let wordStart = 0;
  let wordEnd = 0;

  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    if (ch === ' ' || ch === '\n' || ch === '\t') {
      if (wordChars.length > 0) {
        words.push({ text: wordChars.join(''), start: wordStart, end: wordEnd });
        wordChars = [];
      }
    } else {
      if (wordChars.length === 0) wordStart = character_start_times_seconds[i];
      wordChars.push(ch);
      wordEnd = character_end_times_seconds[i];
    }
  }
  if (wordChars.length > 0) {
    words.push({ text: wordChars.join(''), start: wordStart, end: wordEnd });
  }

  if (words.length === 0) return '';

  // Group words into subtitle segments (up to 4 words or 3 seconds per segment)
  const segments: { text: string; start: number; end: number }[] = [];
  let i = 0;
  while (i < words.length) {
    const segStart = words[i].start;
    const segWords: string[] = [];
    let j = i;
    while (j < words.length && segWords.length < 4 && words[j].end - segStart < 3.0) {
      segWords.push(words[j].text);
      j++;
    }
    if (j === i) j++;
    segments.push({ text: segWords.join(' '), start: segStart, end: words[j - 1].end });
    i = j;
  }

  return segments
    .map((seg, k) => `${k + 1}\n${formatSRTTime(seg.start)} --> ${formatSRTTime(seg.end)}\n${seg.text}\n`)
    .join('\n');
}

export async function runTTS(projectId: string, scriptMd: string): Promise<void> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    emit(projectId, { type: 'log', message: '⚠️ ELEVENLABS_API_KEY 없음 — TTS 건너뜀' });
    return;
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? 'Xb7hH8MSUJpSbSDYk0k2'; // Alice (multilingual)
  const scenes = parseNarrations(scriptMd);

  if (scenes.length === 0) {
    emit(projectId, { type: 'log', message: '⚠️ 나레이션 파싱 실패 — TTS 건너뜀' });
    return;
  }

  emit(projectId, { type: 'log', message: `[6단계] TTS 생성 (${scenes.length}개 씬)` });

  for (const scene of scenes) {
    emit(projectId, { type: 'log', message: `  씬 ${scene.id} TTS 생성 중…` });

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: scene.text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`ElevenLabs 오류 (씬 ${scene.id}): ${res.status} ${err}`);
    }

    const json = await res.json() as {
      audio_base64: string;
      alignment: AlignmentData;
    };

    const buf = Buffer.from(json.audio_base64, 'base64');
    writeFileBinary(projectId, `audio/scene_${scene.id}.mp3`, buf);
    writeFile(projectId, `subtitles/scene_${scene.id}.srt`, alignmentToSRT(json.alignment));

    emit(projectId, { type: 'log', message: `  ✅ 씬 ${scene.id} 완료` });
  }

  emit(projectId, { type: 'log', message: '✅ TTS 생성 완료' });
}
