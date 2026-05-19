import { NextRequest, NextResponse } from 'next/server';
import { loadProject, updateStatus } from '@/lib/project';
import { calcVideoCost } from '@/lib/pipeline/video-generator';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  if (project.status !== 'waiting:images') {
    return NextResponse.json({ error: '이미지 확인 단계가 아닙니다.' }, { status: 409 });
  }

  const cost = calcVideoCost(id);
  const costPreview = { stage: 'video' as const, ...cost };
  updateStatus(id, 'waiting:cost-video', { costPreview });

  return NextResponse.json({ costPreview });
}
