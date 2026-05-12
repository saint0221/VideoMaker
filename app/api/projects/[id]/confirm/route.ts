import { NextRequest, NextResponse } from 'next/server';
import { loadProject } from '@/lib/project';
import { runPostScript, handleError } from '@/lib/pipeline';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  if (project.status !== 'waiting:confirm') {
    return NextResponse.json({ error: '확인 단계가 아닙니다.' }, { status: 409 });
  }

  runPostScript(id).catch((err) => handleError(id, err));

  return NextResponse.json({ confirmed: true });
}
