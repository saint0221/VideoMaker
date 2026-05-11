import { emit } from '../events';
import { writeFileBinary, projectFile } from '../project';
import { uploadBufferToFal } from './utils';
import fs from 'fs';

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
        aspect_ratio: '16:9',
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

export async function runVideoGenerator(projectId: string): Promise<void> {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) {
    emit(projectId, { type: 'log', message: '⚠️ FAL_API_KEY 없음 — 영상 생성 건너뜀' });
    return;
  }

  // Find all generated images
  const imagesDir = projectFile(projectId, 'images');
  if (!fs.existsSync(imagesDir)) {
    emit(projectId, { type: 'log', message: '⚠️ images/ 디렉토리 없음 — 영상 생성 건너뜀' });
    return;
  }

  const imageFiles = fs.readdirSync(imagesDir).filter((f) => f.endsWith('.jpg')).sort();
  if (imageFiles.length === 0) {
    emit(projectId, { type: 'log', message: '⚠️ 생성된 이미지 없음 — 영상 생성 건너뜀' });
    return;
  }

  emit(projectId, { type: 'log', message: `[10단계] 영상 생성 (${imageFiles.length}개 씬)` });

  const videosDir = projectFile(projectId, 'videos');

  for (const imageFile of imageFiles) {
    const sceneId = imageFile.replace('scene_', '').replace('.jpg', '');

    const existingVideo = `${videosDir}/scene_${sceneId}.mp4`;
    if (fs.existsSync(existingVideo)) {
      emit(projectId, { type: 'log', message: `  ⏭️ 씬 ${sceneId} 이미 완료 — 건너뜀` });
      continue;
    }

    emit(projectId, { type: 'log', message: `  씬 ${sceneId} 영상 생성 중… (약 1~2분 소요)` });

    const imagePath = `${imagesDir}/${imageFile}`;
    const imageBuffer = fs.readFileSync(imagePath);

    const imageUrl = await uploadBufferToFal(apiKey, imageBuffer, imageFile, 'image/jpeg');

    const onProgress = (msg: string) => emit(projectId, { type: 'log', message: msg });
    const videoUrl = await generateVideo(
      apiKey,
      imageUrl,
      'cinematic slow motion, dramatic atmosphere, documentary style',
      onProgress
    );

    // Download video
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) throw new Error(`씬 ${sceneId} 영상 다운로드 실패`);

    const buf = Buffer.from(await videoRes.arrayBuffer());
    writeFileBinary(projectId, `videos/scene_${sceneId}.mp4`, buf);

    emit(projectId, { type: 'log', message: `  ✅ 씬 ${sceneId} 영상 완료` });
  }

  emit(projectId, { type: 'log', message: '✅ 영상 생성 완료' });
}
