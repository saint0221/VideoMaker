import { NextRequest, NextResponse } from 'next/server';
import { loadProject, readFile, updateStatus } from '@/lib/project';
import { findReferenceImage, calcImageCost } from '@/lib/pipeline/image-generator';
import { runImagePrompter } from '@/lib/pipeline/image-prompter';
import { emit } from '@/lib/events';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  const imageStageLastStatuses = ['done:prompts', 'waiting:reference', 'running:images'];
  const isImageStageError =
    project.status === 'error' &&
    project.lastStatus != null &&
    imageStageLastStatuses.includes(project.lastStatus);

  if (project.status !== 'waiting:reference' && !isImageStageError) {
    return NextResponse.json({ error: '레퍼런스 대기 상태가 아닙니다.' }, { status: 409 });
  }

  const promptsMd = readFile(id, 'image-prompts.md');
  if (!promptsMd) {
    return NextResponse.json({ error: 'image-prompts.md를 찾을 수 없습니다.' }, { status: 400 });
  }

  const cost = calcImageCost(id, promptsMd);
  const costPreview = { stage: 'images' as const, ...cost };
  updateStatus(id, 'waiting:cost-images', { costPreview, error: undefined });

  const refPath = findReferenceImage(id);
  if (refPath) {
    const sceneDesignMd = readFile(id, 'scene-design.md');
    const scriptMd = readFile(id, 'script-final.md');
    if (sceneDesignMd && scriptMd) {
      emit(id, { type: 'log', message: '  🎨 레퍼런스 이미지 스타일 분석 후 프롬프트 재생성 중…' });
      runImagePrompter(id, project.topic, sceneDesignMd, scriptMd, refPath).then(() => {
        emit(id, { type: 'log', message: '  ✅ 레퍼런스 스타일 반영 프롬프트 재생성 완료' });
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        emit(id, { type: 'log', message: `  ⚠️ 프롬프트 재생성 실패 — 기존 프롬프트로 진행: ${msg}` });
      });
    }
  }

  return NextResponse.json({ costPreview });
}
