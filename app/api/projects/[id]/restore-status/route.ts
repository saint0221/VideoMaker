import { NextRequest, NextResponse } from 'next/server';
import { loadProject, updateStatus } from '@/lib/project';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { targetStatus } = await req.json();
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  if (project.status !== 'error') {
    return NextResponse.json({ error: '에러 상태가 아닙니다.' }, { status: 409 });
  }

  updateStatus(id, targetStatus, { error: undefined });
  return NextResponse.json({ restored: true });
}
