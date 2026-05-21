import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { createProject, listProjects, projectDir } from '@/lib/project';
import { s3Enabled, listProjectIdsFromS3, downloadFromS3 } from '@/lib/s3';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (s3Enabled()) {
    const localIds = new Set(listProjects().map((p) => p.id));
    const s3Ids = await listProjectIdsFromS3();
    await Promise.all(
      s3Ids
        .filter((id) => !localIds.has(id))
        .map(async (id) => {
          const buf = await downloadFromS3(id, 'state.json');
          if (buf) {
            const dir = projectDir(id);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'state.json'), buf);
          }
        })
    );
  }
  return NextResponse.json(listProjects());
}

export async function POST(req: NextRequest) {
  const { topic, aspectRatio } = await req.json();
  if (!topic?.trim()) {
    return NextResponse.json({ error: '토픽을 입력해주세요.' }, { status: 400 });
  }

  const ratio = aspectRatio === '9:16' ? '9:16' : '16:9';
  const project = createProject(topic.trim(), ratio);
  return NextResponse.json(project, { status: 201 });
}
