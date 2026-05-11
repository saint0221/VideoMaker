import { NextRequest, NextResponse } from 'next/server';
import { loadProject, readFile } from '@/lib/project';

const ALLOWED_FILES = [
  'research.md',
  'strategy.md',
  'concept.md',
  'brief.md',
  'script-final.md',
  'script-review.md',
];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  const filename = req.nextUrl.searchParams.get('file');
  if (!filename || !ALLOWED_FILES.includes(filename)) {
    return NextResponse.json({ error: '허용되지 않은 파일입니다.' }, { status: 400 });
  }

  const content = readFile(id, filename);
  if (!content) {
    return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 });
  }

  if (req.nextUrl.searchParams.get('download') === '1') {
    return new Response(content, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  }

  return NextResponse.json({ content });
}
