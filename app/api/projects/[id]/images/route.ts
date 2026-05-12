import { NextRequest, NextResponse } from 'next/server';
import { loadProject, listFiles } from '@/lib/project';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  const files = listFiles(id, 'images').filter((f) => /\.(jpg|png)$/i.test(f));

  const images = files.map((filename) => {
    const m = filename.match(/^scene_(.+)\.(jpg|png)$/i);
    return {
      sceneId: m ? m[1] : filename,
      localPath: `images/${filename}`,
    };
  });

  return NextResponse.json({ images });
}
