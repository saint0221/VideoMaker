import { NextRequest, NextResponse } from 'next/server';
import { loadProject } from '@/lib/project';
import { runPipeline, resumePipeline } from '@/lib/pipeline';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);
  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  if (project.status !== 'idle' && project.status !== 'error') {
    return NextResponse.json({ error: '이미 실행 중이거나 완료된 프로젝트입니다.' }, { status: 409 });
  }

  if (project.status === 'error') {
    resumePipeline(id).catch(console.error);
  } else {
    runPipeline(id).catch(console.error);
  }

  return NextResponse.json({ started: true });
}
