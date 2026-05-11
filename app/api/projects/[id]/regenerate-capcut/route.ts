import { NextRequest, NextResponse } from 'next/server';
import { loadProject, updateStatus } from '@/lib/project';
import { emit } from '@/lib/events';
import { runCapcutEditor } from '@/lib/pipeline/capcut-editor';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  updateStatus(id, 'running:capcut');
  emit(id, { type: 'status', status: 'running:capcut' });

  (async () => {
    try {
      await runCapcutEditor(id);
      updateStatus(id, 'completed');
      emit(id, { type: 'status', status: 'completed' });
      emit(id, { type: 'log', message: '🎬 CapCut 프로젝트 재생성 완료! capcut-project/ 폴더를 CapCut에서 임포트하세요.' });
      emit(id, { type: 'done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateStatus(id, 'error', { error: msg });
      emit(id, { type: 'status', status: 'error' });
      emit(id, { type: 'log', message: `❌ CapCut 재생성 실패: ${msg}` });
    }
  })();

  return NextResponse.json({ started: true });
}
