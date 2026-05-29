import { emit } from '../events';
import { writeFileBinary, projectFile, loadProject, appendCostLog } from '../project';
import { uploadBufferToFal } from './utils';
import fs from 'fs';
import path from 'path';


interface KlingQueueResult {
  request_id: string;
  status: string;
  status_url: string;
  response_url: string;
}

interface KlingStatusResult {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  error?: string;
}

interface KlingVideoResult {
  video?: { url: string };
}


async function generateVideo(
  apiKey: string,
  imageUrl: string,
  prompt: string,
  aspectRatio: '16:9' | '9:16' = '16:9',
  onProgress?: (msg: string) => void
): Promise<string> {
  const submitRes = await fetch(
    'https://queue.fal.run/fal-ai/kling-video/v2.1/standard/image-to-video',
    {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_url: imageUrl,
        prompt,
        duration: '5',
        aspect_ratio: aspectRatio,
      }),
    }
  );

  if (!submitRes.ok) {
    const err = await submitRes.text();
    throw new Error(`Kling 요청 실패: ${submitRes.status} ${err}`);
  }

  const { status_url: statusUrl, response_url: responseUrl } = (await submitRes.json()) as KlingQueueResult;

  // Poll until completed
  for (let attempt = 0; attempt < 180; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));

    const statusRes = await fetch(statusUrl, {
      headers: { Authorization: `Key ${apiKey}` },
    });

    if (!statusRes.ok) {
      onProgress?.(`  ⚠️ 상태 확인 실패 (${statusRes.status}) — 재시도 중…`);
      continue;
    }

    const status = (await statusRes.json()) as KlingStatusResult;

    if ((attempt + 1) % 6 === 0) {
      onProgress?.(`  ⏳ 영상 생성 대기 중… (${Math.round((attempt + 1) * 5)}초 경과)`);
    }

    if (status.status === 'COMPLETED') {
      const resultRes = await fetch(responseUrl, {
        headers: { Authorization: `Key ${apiKey}` },
      });
      if (!resultRes.ok) throw new Error(`영상 결과 조회 실패: ${resultRes.status}`);
      const result = (await resultRes.json()) as KlingVideoResult;
      const videoUrl = result.video?.url;
      if (!videoUrl) throw new Error(`영상 URL 없음 — 응답: ${JSON.stringify(result)}`);
      return videoUrl;
    }
    if (status.status === 'FAILED') {
      throw new Error(`Kling 실패: ${status.error ?? '알 수 없는 오류'}`);
    }
  }

  throw new Error('Kling 타임아웃 (15분)');
}

export function calcVideoCost(projectId: string): { toGenerate: number; skipped: number; costPerUnit: number; totalCost: number } {
  const imagesDir = projectFile(projectId, 'images');
  const videosDir = projectFile(projectId, 'videos');
  const imageFiles = fs.existsSync(imagesDir)
    ? fs.readdirSync(imagesDir).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f)).sort()
    : [];

  const sceneGroups = new Map<string, string[]>();
  for (const f of imageFiles) {
    const m = f.match(/^scene_(\d+)/);
    if (!m) continue;
    const num = m[1];
    if (!sceneGroups.has(num)) sceneGroups.set(num, []);
    sceneGroups.get(num)!.push(f);
  }

  let toGenerate = 0;
  let skipped = 0;
  for (const [sceneNum, imgs] of sceneGroups) {
    for (let i = 0; i < imgs.length; i++) {
      const suffix = String.fromCharCode(65 + i);
      const fileName = `scene_${sceneNum}-${suffix}.mp4`;
      if (fs.existsSync(path.join(videosDir, fileName))) skipped++;
      else toGenerate++;
    }
  }

  const COST_PER_CLIP = 0.28;
  return { toGenerate, skipped, costPerUnit: COST_PER_CLIP, totalCost: +(toGenerate * COST_PER_CLIP).toFixed(4) };
}

export async function runVideoGenerator(projectId: string): Promise<void> {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) {
    emit(projectId, { type: 'log', message: '⚠️ FAL_API_KEY 없음 — 영상 생성 건너뜀' });
    return;
  }

  const key: string = apiKey;
  const project = loadProject(projectId);
  const aspectRatio: '16:9' | '9:16' = project?.aspectRatio === '9:16' ? '9:16' : '16:9';

  // Find all generated images
  const imagesDir = projectFile(projectId, 'images');
  if (!fs.existsSync(imagesDir)) {
    emit(projectId, { type: 'log', message: '⚠️ images/ 디렉토리 없음 — 영상 생성 건너뜀' });
    return;
  }

  const imageFiles = fs.readdirSync(imagesDir).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f)).sort();
  if (imageFiles.length === 0) {
    emit(projectId, { type: 'log', message: '⚠️ 생성된 이미지 없음 — 영상 생성 건너뜀' });
    return;
  }

  const videosDir = projectFile(projectId, 'videos');

  // 씬 번호별로 이미지 그룹화
  const sceneGroups = new Map<string, string[]>();
  for (const f of imageFiles) {
    const m = f.match(/^scene_(\d+)/);
    if (!m) continue;
    const num = m[1];
    if (!sceneGroups.has(num)) sceneGroups.set(num, []);
    sceneGroups.get(num)!.push(f);
  }

  // 전체 클립 수 계산 (로그용)
  let totalClips = 0;
  for (const [, imgs] of sceneGroups) {
    totalClips += imgs.length;
  }

  emit(projectId, { type: 'log', message: `[10단계] 영상 생성 (${totalClips}개 클립)` });

  let videoToGenerate = 0;
  let videoSkipped = 0;
  for (const [sceneNum, sceneImages] of sceneGroups) {
    for (let i = 0; i < sceneImages.length; i++) {
      const suffix = String.fromCharCode(65 + i);
      const fileName = `scene_${sceneNum}-${suffix}.mp4`;
      if (fs.existsSync(path.join(videosDir, fileName))) {
        videoSkipped++;
      } else {
        videoToGenerate++;
      }
    }
  }
  const COST_PER_CLIP = 0.28;
  const videoCostEntry = {
    timestamp: new Date().toISOString(),
    projectId,
    stage: 'video' as const,
    toGenerate: videoToGenerate,
    skipped: videoSkipped,
    costPerUnit: COST_PER_CLIP,
    totalCost: +(videoToGenerate * COST_PER_CLIP).toFixed(4),
  };
  emit(projectId, { type: 'cost', ...videoCostEntry });
  appendCostLog(videoCostEntry);

  type Clip = { sceneNum: string; suffix: string; imageFile: string; videoFileName: string };

  const clips: Clip[] = [];
  for (const [sceneNum, sceneImages] of [...sceneGroups.entries()].sort()) {
    for (let i = 0; i < sceneImages.length; i++) {
      const suffix = String.fromCharCode(65 + i);
      const videoFileName = `scene_${sceneNum}-${suffix}.mp4`;
      if (fs.existsSync(path.join(videosDir, videoFileName))) {
        emit(projectId, { type: 'log', message: `  ⏭️ 씬 ${sceneNum}-${suffix} 이미 완료 — 건너뜀` });
        continue;
      }
      const imageFile = sceneImages[i];
      clips.push({ sceneNum, suffix, imageFile, videoFileName });
    }
  }

  const CONCURRENCY = 3;
  const errors: string[] = [];
  let next = 0;

  async function processClip(clip: Clip): Promise<void> {
    const { sceneNum, suffix, imageFile, videoFileName } = clip;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 10000 * attempt));
        emit(projectId, { type: 'log', message: `  씬 ${sceneNum}-${suffix} 영상 재시도 ${attempt}/2…` });
      }
      try {
        emit(projectId, { type: 'log', message: `  씬 ${sceneNum}-${suffix} 영상 생성 중… (약 1~2분 소요)` });
        const imageBuffer = fs.readFileSync(path.join(imagesDir, imageFile));
        const mimeType = /\.png$/i.test(imageFile) ? 'image/png' : /\.webp$/i.test(imageFile) ? 'image/webp' : 'image/jpeg';
        const imageUrl = await uploadBufferToFal(key, imageBuffer, imageFile, mimeType);
        const onProgress = (msg: string) => emit(projectId, { type: 'log', message: msg });
        const videoUrl = await generateVideo(
          key,
          imageUrl,
          'cinematic slow motion, dramatic atmosphere, documentary style',
          aspectRatio,
          onProgress
        );
        const videoRes = await fetch(videoUrl);
        if (!videoRes.ok) throw new Error(`씬 ${sceneNum}-${suffix} 영상 다운로드 실패`);
        const buf = Buffer.from(await videoRes.arrayBuffer());
        writeFileBinary(projectId, `videos/${videoFileName}`, buf);
        emit(projectId, { type: 'log', message: `  ✅ 씬 ${sceneNum}-${suffix} 완료` });
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr !== undefined) {
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      errors.push(msg);
      emit(projectId, { type: 'log', message: `  ❌ 씬 ${sceneNum}-${suffix} 영상 실패: ${msg}` });
    }
  }

  async function worker(): Promise<void> {
    while (next < clips.length) {
      const clip = clips[next++];
      await processClip(clip);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, clips.length) }, () => worker()));

  if (errors.length > 0) {
    throw new Error(`영상 생성 실패 (${errors.length}개 클립):\n${errors.join('\n')}`);
  }

  emit(projectId, { type: 'log', message: '✅ 영상 생성 완료' });
}
