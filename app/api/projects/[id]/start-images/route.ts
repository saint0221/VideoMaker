import { NextRequest, NextResponse } from 'next/server';
import { loadProject, readFile, updateStatus } from '@/lib/project';
import { findReferenceImage } from '@/lib/pipeline/image-generator';
import { runImagesBackground } from '@/lib/pipeline';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  const imageStageLastStatuses = ['done:prompts', 'waiting:reference', 'running:images'];
  const isImageStageError =
    project.status === 'error' &&
    project.lastStatus != null &&
    imageStageLastStatuses.includes(project.lastStatus);

  if (project.status !== 'waiting:reference' && !isImageStageError) {
    return NextResponse.json({ error: '레퍼런스 대기 상태가 아닙니다.' }, { status: 409 });
  }

  const promptsMd = readFile(id, 'image-prompts.md');
  if (!promptsMd) {
    return NextResponse.json({ error: 'image-prompts.md를 찾을 수 없습니다.' }, { status: 400 });
  }

  if (isImageStageError) {
    updateStatus(id, 'waiting:reference', { error: undefined });
  }

  const referenceImagePath = findReferenceImage(id) ?? undefined;
  runImagesBackground(id, promptsMd, referenceImagePath);

  return NextResponse.json({ started: true });
}
