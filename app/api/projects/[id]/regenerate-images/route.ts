import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { loadProject, readFile, updateStatus, projectDir } from '@/lib/project';
import { runImagesBackground } from '@/lib/pipeline';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  if (project.status !== 'waiting:images') {
    return NextResponse.json({ error: '이미지 확인 대기 상태가 아닙니다.' }, { status: 409 });
  }

  const promptsMd = readFile(id, 'image-prompts.md');
  if (!promptsMd) {
    return NextResponse.json({ error: 'image-prompts.md를 찾을 수 없습니다.' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const scenes: string[] | undefined = body.scenes;

  // 지정된 씬만 삭제하거나 (scenes 파라미터), 전체 삭제
  const imagesDir = path.join(projectDir(id), 'images');
  if (fs.existsSync(imagesDir)) {
    for (const file of fs.readdirSync(imagesDir)) {
      if (file.endsWith('.jpg') || file.endsWith('.png') || file.endsWith('.webp')) {
        if (!scenes || scenes.some(s => file.startsWith(`scene_${s}`))) {
          fs.unlinkSync(path.join(imagesDir, file));
        }
      }
    }
  }

  updateStatus(id, 'running:images');

  runImagesBackground(id, promptsMd, project.imageModel, project.loraUrl);

  return NextResponse.json({ started: true });
}
