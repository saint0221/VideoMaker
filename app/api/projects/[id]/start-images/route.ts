import { NextRequest, NextResponse } from 'next/server';
import { loadProject, readFile, updateStatus } from '@/lib/project';
import { calcImageCost } from '@/lib/pipeline/image-generator';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  const imageStageLastStatuses = ['done:prompts', 'running:images'];
  const isImageStageError =
    project.status === 'error' &&
    project.lastStatus != null &&
    imageStageLastStatuses.includes(project.lastStatus);

  if (!isImageStageError) {
    return NextResponse.json({ error: '이미지 단계 오류 복구 상태가 아닙니다.' }, { status: 409 });
  }

  const promptsMd = readFile(id, 'image-prompts.md');
  if (!promptsMd) {
    return NextResponse.json({ error: 'image-prompts.md를 찾을 수 없습니다.' }, { status: 400 });
  }

  const cost = calcImageCost(id, promptsMd, project.imageModel);
  const costPreview = { stage: 'images' as const, ...cost };
  updateStatus(id, 'waiting:cost-images', { costPreview, error: undefined });

  return NextResponse.json({ costPreview });
}
