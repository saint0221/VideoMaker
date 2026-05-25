import { NextRequest, NextResponse } from 'next/server';
import { loadProject, updateStatus, readFile } from '@/lib/project';
import { parseReviewScore } from '@/lib/project';
import { emit } from '@/lib/events';
import { runRevisionLoop, handleError } from '@/lib/pipeline';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  if (project.status !== 'waiting:confirm') {
    return NextResponse.json({ error: '대본 확인 대기 상태가 아닙니다.' }, { status: 409 });
  }

  const scriptMd = readFile(id, 'script-final.md');
  const reviewMd = readFile(id, 'script-review.md');
  const briefMd = readFile(id, 'brief.md');
  const factCheckMd = readFile(id, 'fact-check.md') ?? undefined;

  if (!scriptMd || !reviewMd || !briefMd) {
    return NextResponse.json({ error: '필요한 파일을 찾을 수 없습니다.' }, { status: 400 });
  }

  async function run() {
    const { reviewMd: reviewMdFinal, score, verdict } = await runRevisionLoop(
      id, project!.topic, scriptMd!, reviewMd!, briefMd!, factCheckMd
    );

    updateStatus(id, 'waiting:confirm', { reviewScore: score, reviewVerdict: verdict });
    emit(id, { type: 'status', status: 'waiting:confirm' });
    emit(id, { type: 'review', score, verdict });
    emit(id, { type: 'done' });
  }

  run().catch((err) => handleError(id, err));

  return NextResponse.json({ started: true });
}
