import { NextRequest, NextResponse } from 'next/server';
import { loadProject, readFile } from '@/lib/project';
import { runPostScript, handleError } from '@/lib/pipeline';

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

  runPostScript(id).catch((err) => handleError(id, err));

  return NextResponse.json({ started: true });
}
