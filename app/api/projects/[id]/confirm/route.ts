import { NextRequest, NextResponse } from 'next/server';
import { loadProject, readFile } from '@/lib/project';
import { runPostScript, handleError, hasMandatoryRevisions } from '@/lib/pipeline';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  if (project.status !== 'waiting:confirm') {
    return NextResponse.json({ error: '확인 단계가 아닙니다.' }, { status: 409 });
  }

  const force = new URL(req.url).searchParams.get('force') === 'true';
  const reviewMd = readFile(id, 'script-review.md');
  if (!force && reviewMd && hasMandatoryRevisions(reviewMd)) {
    return NextResponse.json(
      { error: '🔴 필수 수정 항목이 남아있습니다. "검토 반영" 버튼으로 수정을 먼저 적용하거나, 무시하고 진행하려면 "강제 확정"을 누르세요.', hasRevisions: true },
      { status: 422 }
    );
  }

  runPostScript(id).catch((err) => handleError(id, err));

  return NextResponse.json({ confirmed: true });
}
