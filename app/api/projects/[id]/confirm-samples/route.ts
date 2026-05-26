import { NextRequest, NextResponse } from 'next/server';
import { loadProject, readFile } from '@/lib/project';
import { runImagesBackground } from '@/lib/pipeline';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  if (project.status !== 'waiting:sample-images') {
    return NextResponse.json({ error: '샘플 이미지 확인 대기 상태가 아닙니다.' }, { status: 409 });
  }

  const promptsMd = readFile(id, 'image-prompts.md');
  if (!promptsMd) {
    return NextResponse.json({ error: 'image-prompts.md를 찾을 수 없습니다.' }, { status: 400 });
  }

  runImagesBackground(id, promptsMd, project.imageModel, project.loraUrl, project.loraScale, false, project.loraTriggerWord);

  return NextResponse.json({ started: true });
}
