import { NextRequest, NextResponse } from 'next/server';
import { loadProject, readFile, updateStatus } from '@/lib/project';
import { emit } from '@/lib/events';
import { runTTS } from '@/lib/pipeline/tts';
import { runCapcutEditor } from '@/lib/pipeline/capcut-editor';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  const scriptMd = readFile(id, 'script-final.md');
  if (!scriptMd) {
    return NextResponse.json({ error: 'script-final.md를 찾을 수 없습니다.' }, { status: 400 });
  }

  (async () => {
    try {
      updateStatus(id, 'running:tts');
      emit(id, { type: 'status', status: 'running:tts' });
      await runTTS(id, scriptMd);
      updateStatus(id, 'done:tts');
      emit(id, { type: 'status', status: 'done:tts' });

      updateStatus(id, 'running:capcut');
      emit(id, { type: 'status', status: 'running:capcut' });
      await runCapcutEditor(id);
      updateStatus(id, 'completed');
      emit(id, { type: 'status', status: 'completed' });
      emit(id, { type: 'log', message: '🎬 TTS + CapCut 재생성 완료!' });
      emit(id, { type: 'done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateStatus(id, 'error', { error: msg });
      emit(id, { type: 'status', status: 'error' });
      emit(id, { type: 'log', message: `❌ TTS + CapCut 재생성 실패: ${msg}` });
    }
  })();

  return NextResponse.json({ started: true });
}
