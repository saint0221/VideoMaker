import { NextRequest, NextResponse } from 'next/server';
import { loadProject, listFiles, updateStatus } from '@/lib/project';
import { calcVideoCost } from '@/lib/pipeline/video-generator';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  if (project.status.startsWith('running:')) {
    return NextResponse.json({ error: '파이프라인이 이미 실행 중입니다.' }, { status: 409 });
  }

  const images = listFiles(id, 'images').filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));
  if (images.length === 0) {
    return NextResponse.json({ error: 'images/ 폴더에 이미지가 없습니다.' }, { status: 400 });
  }

  const cost = calcVideoCost(id);
  const costPreview = { stage: 'video' as const, ...cost };
  updateStatus(id, 'waiting:cost-video', { costPreview });

  return NextResponse.json({ costPreview });
}
