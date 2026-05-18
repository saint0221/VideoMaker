import fs from 'fs';
import path from 'path';
import { emit } from '../events';
import { writeFileBinary, projectFile, projectDir, loadProject } from '../project';
import { uploadBufferToFal } from './utils';

interface FalImageResult {
  images: Array<{ url: string; content_type: string }>;
}

export interface ImageGeneratorOptions {
  referenceImagePath?: string;
  referenceStrength?: number;
}

interface TextComposite {
  content: string;
  font: string;
  x: number;
  y: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  size: number;
}

function parseTextComposite(block: string): TextComposite | undefined {
  const contentMatch = block.match(/내용:\s*"([^"]+)"/);
  if (!contentMatch) return undefined;

  const fontMatch = block.match(/폰트:\s*(\S+)/);
  const posMatch = block.match(/x=([\d.]+),\s*y=([\d.]+)/);
  const colorMatch = block.match(/색상:\s*(#[0-9A-Fa-f]{3,8})/);
  const strokeMatch = block.match(/테두리:\s*(#[0-9A-Fa-f]{3,8})\s+(\d+)px/);
  const sizeMatch = block.match(/크기:\s*(\d+)px/);

  return {
    content: contentMatch[1].replace(/\\n/g, '\n'),
    font: fontMatch?.[1] ?? 'sans-serif',
    x: posMatch ? parseFloat(posMatch[1]) : 0.5,
    y: posMatch ? parseFloat(posMatch[2]) : 0.85,
    color: colorMatch?.[1] ?? '#FFFFFF',
    strokeColor: strokeMatch?.[1] ?? '#000000',
    strokeWidth: strokeMatch ? parseInt(strokeMatch[2]) : 2,
    size: sizeMatch ? parseInt(sizeMatch[1]) : 60,
  };
}

async function compositeText(imagePath: string, tc: TextComposite): Promise<void> {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(imagePath).metadata();
  const w = meta.width ?? 1920;
  const h = meta.height ?? 1080;

  const x = Math.round(tc.x * w);
  const y = Math.round(tc.y * h);
  const lines = tc.content.split('\n');
  const lineHeight = Math.round(tc.size * 1.3);
  const totalHeight = lineHeight * (lines.length - 1);
  const startY = y - Math.round(totalHeight / 2);

  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const tspans = lines
    .map((line, i) =>
      `<tspan x="${x}" y="${startY + i * lineHeight}">${escape(line)}</tspan>`
    )
    .join('');

  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<text text-anchor="middle" dominant-baseline="middle"` +
    ` font-family="${tc.font}, AppleSDGothicNeo-Bold, NanumGothic, sans-serif"` +
    ` font-size="${tc.size}" fill="${tc.color}"` +
    ` stroke="${tc.strokeColor}" stroke-width="${tc.strokeWidth}" paint-order="stroke"` +
    `>${tspans}</text></svg>`
  );

  const tmpPath = imagePath + '.tmp.jpg';
  await sharp(imagePath)
    .composite([{ input: svg, blend: 'over' }])
    .jpeg({ quality: 95 })
    .toFile(tmpPath);

  fs.renameSync(tmpPath, imagePath);
}

function parseImagePrompts(promptsMd: string): Array<{ id: string; prompt: string; textComposite?: TextComposite }> {
  const scenes: Array<{ id: string; prompt: string; textComposite?: TextComposite }> = [];
  const blocks = promptsMd.split(/(?=##\s+SCENE\s+\d)/i);

  for (const block of blocks) {
    // Handles: "SCENE 01", "SCENE 02-A", "SCENE 02 — CUT 1", "SCENE 02 — CUT A"
    const idMatch = block.match(/##\s+SCENE\s+(\d+)(?:-([A-Za-z]))?(?:\s*[-—–]+\s*(?:CUT\s*)?(\d+|[A-Za-z]))?/i);
    if (!idMatch) continue;

    const baseNum = idMatch[1].padStart(2, '0');
    let sceneId: string;
    if (idMatch[2]) {
      // SCENE 02-A
      sceneId = `${baseNum}-${idMatch[2].toUpperCase()}`;
    } else if (idMatch[3]) {
      // SCENE 02 — CUT 1  →  02-A,  CUT 2  →  02-B
      const suffix = idMatch[3];
      const letter = /^\d+$/.test(suffix)
        ? String.fromCharCode(64 + parseInt(suffix))
        : suffix.toUpperCase();
      sceneId = `${baseNum}-${letter}`;
    } else {
      sceneId = baseNum;
    }

    const promptMatch = block.match(/\*\*프롬프트\s*\(영문\)\*\*:\s*\n([\s\S]+?)(?=\n\s*\n\*\*프롬프트\s*\(한글\)|$)/i);
    if (!promptMatch) continue;

    const prompt = promptMatch[1].trim();
    if (!prompt) continue;

    const textBlock = block.match(/\*\*텍스트\s*합성\*\*[^\n]*\n([\s\S]+?)(?=\n---|\n##|$)/i);
    const textComposite = textBlock ? parseTextComposite(textBlock[1]) : undefined;

    scenes.push({ id: sceneId, prompt, textComposite });
  }

  return scenes;
}

async function uploadToFalStorage(filePath: string, apiKey: string): Promise<string | null> {
  try {
    const buffer = fs.readFileSync(filePath);
    const ext = filePath.split('.').pop()?.toLowerCase() ?? 'jpg';
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
    return await uploadBufferToFal(apiKey, buffer, `reference.${ext}`, mimeType);
  } catch {
    return null;
  }
}

export function findReferenceImage(projectId: string): string | null {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const p = projectFile(projectId, `reference.${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export async function runImageGenerator(
  projectId: string,
  promptsMd: string,
  options?: ImageGeneratorOptions,
): Promise<void> {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) {
    emit(projectId, { type: 'log', message: '⚠️ FAL_API_KEY 없음 — 이미지 생성 건너뜀' });
    return;
  }

  const scenes = parseImagePrompts(promptsMd);
  if (scenes.length === 0) {
    emit(projectId, { type: 'log', message: '⚠️ 이미지 프롬프트 파싱 실패 — 이미지 생성 건너뜀' });
    return;
  }

  let referenceImageUrl: string | null = null;
  if (options?.referenceImagePath) {
    emit(projectId, { type: 'log', message: '  📎 레퍼런스 이미지 업로드 중…' });
    referenceImageUrl = await uploadToFalStorage(options.referenceImagePath, apiKey);
    if (referenceImageUrl) {
      emit(projectId, { type: 'log', message: '  ✅ 레퍼런스 이미지 준비 완료 — 스타일 참조 적용' });
    } else {
      emit(projectId, { type: 'log', message: '  ⚠️ 레퍼런스 업로드 실패 — 레퍼런스 없이 생성합니다' });
    }
  }

  const project = loadProject(projectId);
  const imageSize = project?.aspectRatio === '9:16' ? 'portrait_9_16' : 'landscape_16_9';

  emit(projectId, { type: 'log', message: `[9단계] 이미지 생성 (${scenes.length}개 씬, ${project?.aspectRatio ?? '16:9'})` });

  const alreadyDoneImages = scenes.filter((s) =>
    fs.existsSync(path.join(projectDir(projectId), `images/scene_${s.id}.jpg`))
  ).length;
  const COST_PER_IMAGE = 0.025;
  const imagesToGenerate = scenes.length - alreadyDoneImages;
  emit(projectId, {
    type: 'cost',
    stage: 'image',
    toGenerate: imagesToGenerate,
    skipped: alreadyDoneImages,
    costPerUnit: COST_PER_IMAGE,
    totalCost: +(imagesToGenerate * COST_PER_IMAGE).toFixed(4),
  });

  for (const scene of scenes) {
    const localPath = `images/scene_${scene.id}.jpg`;
    const absPath = path.join(projectDir(projectId), localPath);

    if (fs.existsSync(absPath)) {
      emit(projectId, { type: 'log', message: `  씬 ${scene.id} 건너뜀 (이미 존재)` });
      continue;
    }

    emit(projectId, { type: 'log', message: `  씬 ${scene.id} 이미지 생성 중…` });

    const body: Record<string, unknown> = {
      prompt: scene.prompt,
      image_size: imageSize,
      num_inference_steps: 28,
      guidance_scale: 3.5,
      num_images: 1,
      enable_safety_checker: true,
    };

    if (referenceImageUrl) {
      body.image_url = referenceImageUrl;
      body.strength = options?.referenceStrength ?? 0.75;
    }

    const res = await fetch('https://fal.run/fal-ai/flux/dev', {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`FAL 이미지 오류 (씬 ${scene.id}): ${res.status} ${err}`);
    }

    const data = (await res.json()) as FalImageResult;
    const imageUrl = data.images?.[0]?.url;
    if (!imageUrl) throw new Error(`씬 ${scene.id} 이미지 URL 없음`);

    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`씬 ${scene.id} 이미지 다운로드 실패`);

    const buf = Buffer.from(await imgRes.arrayBuffer());
    writeFileBinary(projectId, localPath, buf);

    if (scene.textComposite) {
      await compositeText(absPath, scene.textComposite);
      emit(projectId, { type: 'log', message: `  ✏️  씬 ${scene.id} 텍스트 합성 완료` });
    }

    emit(projectId, { type: 'image', sceneId: scene.id, localPath });
    emit(projectId, { type: 'log', message: `  ✅ 씬 ${scene.id} 이미지 완료` });
  }

  emit(projectId, { type: 'log', message: '✅ 이미지 생성 완료 — 확인 후 영상 생성을 진행해주세요' });
}
