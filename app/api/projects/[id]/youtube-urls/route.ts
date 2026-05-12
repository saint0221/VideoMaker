import { NextRequest, NextResponse } from 'next/server';
import { loadProject, updateStatus } from '@/lib/project';
import { runPipelineFromYoutube, handleError } from '@/lib/pipeline';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  if (project.status !== 'waiting:youtube-urls') {
    return NextResponse.json({ error: '유튜브 URL 입력 단계가 아닙니다.' }, { status: 409 });
  }

  const body = await req.json();
  const urls: string[] = Array.isArray(body.urls) ? body.urls.filter((u: unknown) => typeof u === 'string' && u.trim()) : [];

  updateStatus(id, 'waiting:youtube-urls', { youtubeUrls: urls });

  runPipelineFromYoutube(id).catch((err) => handleError(id, err));

  return NextResponse.json({ started: true });
}
