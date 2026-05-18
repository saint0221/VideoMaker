import { NextRequest, NextResponse } from 'next/server';
import { loadProject, readFile, updateStatus } from '@/lib/project';
import { emit } from '@/lib/events';
import { runSceneDesigner } from '@/lib/pipeline/scene-designer';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  const scriptMd = readFile(id, 'script-final.md');
  const briefMd = readFile(id, 'brief.md');

  if (!scriptMd || !briefMd) {
    return NextResponse.json({ error: 'script-final.md 또는 brief.md가 없습니다.' }, { status: 400 });
  }

  updateStatus(id, 'running:scene');
  emit(id, { type: 'status', status: 'running:scene' });

  (async () => {
    try {
      await runSceneDesigner(id, project.topic, scriptMd, briefMd);
      updateStatus(id, 'completed');
      emit(id, { type: 'status', status: 'completed' });
      emit(id, { type: 'log', message: '✅ 씬 설계 재생성 완료. 자막 패치 후 CapCut을 재생성하세요.' });
      emit(id, { type: 'done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateStatus(id, 'error', { error: msg });
      emit(id, { type: 'status', status: 'error' });
      emit(id, { type: 'log', message: `❌ 씬 설계 재생성 실패: ${msg}` });
    }
  })();

  return NextResponse.json({ started: true });
}
