import { NextRequest, NextResponse } from 'next/server';
import { loadProject, readFile, updateStatus } from '@/lib/project';
import { runImagesBackground, continueFromImages, handleError } from '@/lib/pipeline';
import { countScenes, SAMPLE_COUNT } from '@/lib/pipeline/image-generator';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  const { stage } = (await req.json()) as { stage: 'images' | 'video' };

  if (stage === 'images') {
    if (project.status !== 'waiting:cost-images') {
      return NextResponse.json({ error: '이미지 코스트 확인 단계가 아닙니다.' }, { status: 409 });
    }
    const promptsMd = readFile(id, 'image-prompts.md');
    if (!promptsMd) {
      return NextResponse.json({ error: 'image-prompts.md를 찾을 수 없습니다.' }, { status: 400 });
    }
    const totalScenes = countScenes(promptsMd);
    const sampleOnly = totalScenes > SAMPLE_COUNT;
    updateStatus(id, 'running:images', { costPreview: undefined });
    runImagesBackground(id, promptsMd, project.imageModel, project.loraUrl, project.loraScale, sampleOnly, project.loraTriggerWord);
    return NextResponse.json({ started: true });
  }

  if (stage === 'video') {
    if (project.status !== 'waiting:cost-video') {
      return NextResponse.json({ error: '영상 코스트 확인 단계가 아닙니다.' }, { status: 409 });
    }
    updateStatus(id, 'waiting:images', { costPreview: undefined });
    continueFromImages(id).catch((err) => handleError(id, err));
    return NextResponse.json({ started: true });
  }

  return NextResponse.json({ error: '잘못된 stage입니다.' }, { status: 400 });
}
