import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { loadProject, writeFileBinary, projectFile } from '@/lib/project';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!loadProject(id)) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });

  const ext = file.type === 'image/png' ? 'png' : 'jpg';
  const buffer = Buffer.from(await file.arrayBuffer());

  // Remove any previous reference images before saving new one
  for (const oldExt of ['jpg', 'jpeg', 'png', 'webp']) {
    const old = projectFile(id, `reference.${oldExt}`);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }

  writeFileBinary(id, `reference.${ext}`, buffer);
  return NextResponse.json({ path: `reference.${ext}` });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!loadProject(id)) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const filePath = projectFile(id, `reference.${ext}`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      break;
    }
  }

  return NextResponse.json({ deleted: true });
}
