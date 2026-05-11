import { NextRequest, NextResponse } from 'next/server';
import { createProject, listProjects } from '@/lib/project';

export async function GET() {
  const projects = listProjects();
  return NextResponse.json(projects);
}

export async function POST(req: NextRequest) {
  const { topic } = await req.json();
  if (!topic?.trim()) {
    return NextResponse.json({ error: '토픽을 입력해주세요.' }, { status: 400 });
  }

  const project = createProject(topic.trim());
  return NextResponse.json(project, { status: 201 });
}
