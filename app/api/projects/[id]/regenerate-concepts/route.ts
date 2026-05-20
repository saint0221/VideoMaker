import { NextRequest, NextResponse } from 'next/server';
import { loadProject, updateStatus, readFile, parseConcepts } from '@/lib/project';
import { emit } from '@/lib/events';
import { runStrategist } from '@/lib/pipeline/strategist';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  if (project.status !== 'waiting:concept') {
    return NextResponse.json({ error: '컨셉 선택 단계가 아닙니다.' }, { status: 409 });
  }

  (async () => {
    try {
      updateStatus(id, 'running:strategy');
      emit(id, { type: 'status', status: 'running:strategy' });
      emit(id, { type: 'log', message: '🔄 새로운 컨셉을 생성하는 중...' });

      const researchMd = readFile(id, 'research.md');
      if (!researchMd) throw new Error('research.md를 찾을 수 없습니다.');

      const youtubeAnalysisMd = readFile(id, 'youtube-analysis.md') ?? undefined;
      const strategyMd = await runStrategist(id, project.topic, researchMd, youtubeAnalysisMd);
      const concepts = parseConcepts(strategyMd);

      updateStatus(id, 'waiting:concept', { concepts });
      emit(id, { type: 'status', status: 'waiting:concept' });
      emit(id, { type: 'concepts', concepts });
      emit(id, { type: 'log', message: '✅ 새 컨셉 생성 완료' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      emit(id, { type: 'log', message: `❌ 컨셉 재생성 오류: ${message}` });
      updateStatus(id, 'waiting:concept');
      emit(id, { type: 'status', status: 'waiting:concept' });
    }
  })();

  return NextResponse.json({ started: true });
}
