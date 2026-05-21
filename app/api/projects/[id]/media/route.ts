import { NextRequest, NextResponse } from 'next/server';
import { projectFile } from '@/lib/project';
import { downloadFromS3 } from '@/lib/s3';
import fs from 'fs';
import path from 'path';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.srt': 'text/plain',
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = req.nextUrl.searchParams.get('file');

  if (!file) {
    return NextResponse.json({ error: 'file 파라미터가 필요합니다.' }, { status: 400 });
  }

  // Security: prevent path traversal
  const normalized = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const filePath = projectFile(id, normalized);

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] ?? 'application/octet-stream';
  const isImage = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);

  let buffer: Buffer | null = null;

  if (fs.existsSync(filePath)) {
    buffer = fs.readFileSync(filePath);
  } else {
    buffer = await downloadFromS3(id, normalized);
    if (buffer) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, buffer);
    }
  }

  if (!buffer) {
    return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 });
  }

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': contentType,
      ...(isImage && { 'Cache-Control': 'no-store' }),
    },
  });
}
