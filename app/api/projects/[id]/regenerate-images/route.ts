import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { loadProject, readFile, updateStatus, projectDir } from '@/lib/project';
import { runImagesBackground } from '@/lib/pipeline';
import { SAMPLE_COUNT, countScenes } from '@/lib/pipeline/image-generator';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  const isSampleGate = project.status === 'waiting:sample-images';
  if (project.status !== 'waiting:images' && !isSampleGate) {
    return NextResponse.json({ error: '이미지 확인 대기 상태가 아닙니다.' }, { status: 409 });
  }

  const promptsMd = readFile(id, 'image-prompts.md');
  if (!promptsMd) {
    return NextResponse.json({ error: 'image-prompts.md를 찾을 수 없습니다.' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const scenes: string[] | undefined = isSampleGate ? undefined : body.scenes;

  // waiting:images에서 전체 재생성 시 씬 수가 SAMPLE_COUNT 초과이면 샘플 먼저
  const totalScenes = countScenes(promptsMd);
  const useSample = isSampleGate || (!scenes && totalScenes > SAMPLE_COUNT);

  // 샘플 재생성: 샘플 이미지만 삭제 / 전체 재생성: 지정 씬 또는 전체 삭제
  const imagesDir = path.join(projectDir(id), 'images');
  if (fs.existsSync(imagesDir)) {
    const files = fs.readdirSync(imagesDir).filter(f =>
      f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.webp')
    );
    if (isSampleGate) {
      // Delete only the sample images (first SAMPLE_COUNT by sort order)
      const sampleFiles = files.sort().slice(0, SAMPLE_COUNT);
      for (const file of sampleFiles) {
        fs.unlinkSync(path.join(imagesDir, file));
      }
    } else {
      for (const file of files) {
        if (!scenes || scenes.some(s => file.startsWith(`scene_${s}`))) {
          fs.unlinkSync(path.join(imagesDir, file));
        }
      }
    }
  }

  updateStatus(id, 'running:images');

  runImagesBackground(id, promptsMd, project.imageModel, project.loraUrl, project.loraScale, useSample, project.loraTriggerWord);

  return NextResponse.json({ started: true });
}
