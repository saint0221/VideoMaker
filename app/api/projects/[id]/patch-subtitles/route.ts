import { NextRequest, NextResponse } from 'next/server';
import { loadProject, projectFile, readFile, writeFile, updateStatus } from '@/lib/project';
import { emit } from '@/lib/events';
import { runCapcutEditor } from '@/lib/pipeline/capcut-editor';
import fs from 'fs';
import path from 'path';

function parseSentenceSrt(content: string): string[] {
  return content
    .split(/\n\n+/)
    .map(block => block.trim().split('\n').slice(2).join(' ').trim())
    .filter(s => s.length > 0);
}

function buildSrtMap(projectId: string): Map<string, string[]> {
  const subtitlesDir = projectFile(projectId, 'subtitles');
  const map = new Map<string, string[]>();
  if (!fs.existsSync(subtitlesDir)) return map;

  const files = fs.readdirSync(subtitlesDir)
    .filter(f => /^scene_\d+_sentences\.srt$/.test(f))
    .sort();

  for (const file of files) {
    const m = file.match(/^scene_(\d+)_sentences\.srt$/);
    if (!m) continue;
    const content = fs.readFileSync(path.join(subtitlesDir, file), 'utf-8');
    const sentences = parseSentenceSrt(content);
    if (sentences.length > 0) map.set(String(parseInt(m[1], 10)), sentences);
  }

  return map;
}

function patchSubtitles(sceneDesignMd: string, srtMap: Map<string, string[]>): { patched: string; changes: number } {
  const sceneCounters = new Map<string, number>();
  let changes = 0;

  // Split on slot headers — matches:
  //   "### 이미지 슬롯 NN-X ..."  (scene-designer v1)
  //   "### 슬롯 N-X ..."          (legacy)
  //   "### [SCENE NN-X] ..."     (scene-designer v2)
  const SLOT_HEADER_RE = /(### (?:(?:이미지 )?슬롯 \d+-[A-Za-z]+|\[SCENE \d+-[A-Za-z]+\])[^\n]*)/;
  const parts = sceneDesignMd.split(SLOT_HEADER_RE);
  const result: string[] = [parts[0]];

  for (let i = 1; i < parts.length; i += 2) {
    const header = parts[i];
    const body = i + 1 < parts.length ? parts[i + 1] : '';

    const m = header.match(/### (?:(?:이미지 )?슬롯 |\[SCENE )(\d+)-/);
    result.push(header);

    if (!m) {
      result.push(body);
      continue;
    }

    const sceneNum = String(parseInt(m[1], 10));
    const sentences = srtMap.get(sceneNum);

    if (!sentences) {
      result.push(body);
      continue;
    }

    const idx = sceneCounters.get(sceneNum) ?? 0;
    sceneCounters.set(sceneNum, idx + 1);

    const sentence = sentences[idx] ?? '';
    if (!sentence) {
      result.push(body);
      continue;
    }

    const newBody = body.replace(/- 자막:[^\n]*/, () => {
      changes++;
      return `- 자막: "${sentence}"`;
    });
    result.push(newBody);
  }

  return { patched: result.join(''), changes };
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = loadProject(id);

  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  const sceneDesignMd = readFile(id, 'scene-design.md');
  if (!sceneDesignMd) {
    return NextResponse.json({ error: 'scene-design.md가 없습니다.' }, { status: 400 });
  }

  const srtMap = buildSrtMap(id);
  if (srtMap.size === 0) {
    return NextResponse.json({ error: 'subtitles/ 폴더에 _sentences.srt 파일이 없습니다.' }, { status: 400 });
  }

  const { patched, changes } = patchSubtitles(sceneDesignMd, srtMap);

  if (changes === 0) {
    return NextResponse.json({ error: '교체할 자막 필드를 찾지 못했습니다. scene-design.md 형식을 확인하세요.' }, { status: 400 });
  }

  writeFile(id, 'scene-design.md', patched);
  emit(id, { type: 'log', message: `✅ scene-design.md 자막 ${changes}개 패치 완료 — 캡컷 재생성 시작` });

  updateStatus(id, 'running:capcut');
  emit(id, { type: 'status', status: 'running:capcut' });

  (async () => {
    try {
      await runCapcutEditor(id);
      updateStatus(id, 'completed');
      emit(id, { type: 'status', status: 'completed' });
      emit(id, { type: 'log', message: '🎬 CapCut 프로젝트 재생성 완료! CapCut을 재시작하면 프로젝트 목록에 자동으로 나타납니다.' });
      emit(id, { type: 'done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateStatus(id, 'error', { error: msg });
      emit(id, { type: 'status', status: 'error' });
      emit(id, { type: 'log', message: `❌ CapCut 재생성 실패: ${msg}` });
    }
  })();

  return NextResponse.json({ started: true, changes });
}
