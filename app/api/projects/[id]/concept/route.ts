import { NextRequest, NextResponse } from 'next/server';
import { loadProject } from '@/lib/project';
import { saveConcept, runPipelineFromPlanning } from '@/lib/pipeline';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  if (project.status !== 'waiting:concept') {
    return NextResponse.json({ error: '컨셉 선택 단계가 아닙니다.' }, { status: 409 });
  }

  const { conceptIndex } = await req.json();
  if (typeof conceptIndex !== 'number' || isNaN(conceptIndex)) {
    return NextResponse.json({ error: '유효한 컨셉 번호를 입력해주세요.' }, { status: 400 });
  }

  await saveConcept(id, conceptIndex);

  runPipelineFromPlanning(id).catch(console.error);

  return NextResponse.json({ started: true });
}
