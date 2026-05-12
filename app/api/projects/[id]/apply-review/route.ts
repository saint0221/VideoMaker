import { NextRequest, NextResponse } from 'next/server';
import { loadProject, updateStatus, readFile } from '@/lib/project';
import { runScriptReviser } from '@/lib/pipeline/script-reviser';
import { runReviewer } from '@/lib/pipeline/reviewer';
import { parseReviewScore } from '@/lib/project';
import { emit } from '@/lib/events';
import { hasMandatoryRevisions, handleError } from '@/lib/pipeline';

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
    updateStatus(id, 'running:revising');
    emit(id, { type: 'status', status: 'running:revising' });

    const revisedScript = await runScriptReviser(id, scriptMd!, reviewMd!);

    updateStatus(id, 'running:review');
    emit(id, { type: 'status', status: 'running:review' });

    let reviewMdFinal = await runReviewer(id, project!.topic, revisedScript, briefMd!, factCheckMd);
    let { score, verdict } = parseReviewScore(reviewMdFinal);

    // 재검토 후에도 필수 수정 항목이 있으면 한 번 더 수정 (무한 루프 방지를 위해 1회만)
    if (hasMandatoryRevisions(reviewMdFinal)) {
      emit(id, { type: 'log', message: '🔴 재검토 후 필수 수정 항목 감지 — 최종 수정 적용 중...' });
      updateStatus(id, 'running:revising');
      emit(id, { type: 'status', status: 'running:revising' });
      const finalScript = await runScriptReviser(id, revisedScript, reviewMdFinal);

      updateStatus(id, 'running:review');
      emit(id, { type: 'status', status: 'running:review' });
      reviewMdFinal = await runReviewer(id, project!.topic, finalScript, briefMd!, factCheckMd);
      ({ score, verdict } = parseReviewScore(reviewMdFinal));
    }

    updateStatus(id, 'waiting:confirm', { reviewScore: score, reviewVerdict: verdict });
    emit(id, { type: 'status', status: 'waiting:confirm' });
    emit(id, { type: 'review', score, verdict });
    emit(id, { type: 'done' });
  }

  run().catch((err) => handleError(id, err));

  return NextResponse.json({ started: true });
}
