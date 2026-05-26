import { NextRequest, NextResponse } from 'next/server';
import { loadProject, deleteProject, updateStatus } from '@/lib/project';
import type { ImageModel } from '@/lib/types';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);
  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }
  return NextResponse.json(project);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deleted = deleteProject(id);
  if (!deleted) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}

const VALID_IMAGE_MODELS: ImageModel[] = ['fal-ai/flux/dev', 'fal-ai/flux/schnell', 'fal-ai/fast-sdxl'];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);
  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }
  const body = (await req.json()) as { imageModel?: ImageModel; loraUrl?: string; loraScale?: number; loraTriggerWord?: string };
  const patch: Record<string, unknown> = {};
  if (body.imageModel !== undefined) {
    if (!VALID_IMAGE_MODELS.includes(body.imageModel)) {
      return NextResponse.json({ error: '유효하지 않은 모델입니다.' }, { status: 400 });
    }
    patch.imageModel = body.imageModel;
  }
  if (body.loraUrl !== undefined) {
    patch.loraUrl = body.loraUrl.trim() || undefined;
  }
  if (body.loraScale !== undefined) {
    const scale = Number(body.loraScale);
    if (!isNaN(scale) && scale >= 0.1 && scale <= 2.0) {
      patch.loraScale = Math.round(scale * 10) / 10;
    }
  }
  if (body.loraTriggerWord !== undefined) {
    patch.loraTriggerWord = body.loraTriggerWord.trim() || undefined;
  }
  if (Object.keys(patch).length > 0) {
    updateStatus(id, project.status, patch);
  }
  return NextResponse.json({ ok: true });
}
