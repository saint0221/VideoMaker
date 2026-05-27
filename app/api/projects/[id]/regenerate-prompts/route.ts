import { NextRequest, NextResponse } from 'next/server';
import { loadProject, updateStatus, readFile } from '@/lib/project';
import { runSceneDesigner } from '@/lib/pipeline/scene-designer';
import { runImagePrompter } from '@/lib/pipeline/image-prompter';
import { emit } from '@/lib/events';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  if (project.status !== 'waiting:images') {
    return NextResponse.json({ error: '이미지 확인 대기 상태가 아닙니다.' }, { status: 409 });
  }

  const scriptMd = readFile(id, 'script-final.md');
  const briefMd = readFile(id, 'brief.md');

  if (!scriptMd || !briefMd) {
    return NextResponse.json({ error: 'script-final.md 또는 brief.md를 찾을 수 없습니다.' }, { status: 400 });
  }

  async function run() {
    updateStatus(id, 'running:scene');
    emit(id, { type: 'status', status: 'running:scene' });

    const sceneDesignMd = await runSceneDesigner(id, project!.topic, scriptMd!, briefMd!, project!.loraTriggerWord, project!.imageModel);

    updateStatus(id, 'running:prompts');
    emit(id, { type: 'status', status: 'running:prompts' });
    await runImagePrompter(id, project!.topic, sceneDesignMd, scriptMd!, undefined, project!.loraTriggerWord, undefined, project!.loraStyleDesc);

    updateStatus(id, 'waiting:images');
    emit(id, { type: 'status', status: 'waiting:images' });
    emit(id, { type: 'done' });
  }

  run().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    updateStatus(id, 'error', { error: message });
    emit(id, { type: 'error', message });
    emit(id, { type: 'done' });
  });

  return NextResponse.json({ started: true });
}
