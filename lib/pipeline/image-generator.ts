import fs from 'fs';
import path from 'path';
import { emit } from '../events';
import { writeFileBinary, projectFile, projectDir, loadProject, appendCostLog } from '../project';
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

  // Auto-scale font size so the longest line fits within 90% of image width.
  // Korean/CJK chars are ~1em wide; Latin chars ~0.6em. Use 0.9em as a safe average.
  const maxWidth = Math.round(w * 0.9);
  const longestLineLen = Math.max(...lines.map((l) => l.length), 1);
  const estimatedWidth = longestLineLen * tc.size * 0.9;
  const fontSize = estimatedWidth > maxWidth
    ? Math.floor((maxWidth / (longestLineLen * 0.9)))
    : tc.size;

  const lineHeight = Math.round(fontSize * 1.3);
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
    ` font-size="${fontSize}" fill="${tc.color}"` +
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

interface ParsedScene {
  id: string;
  prompt: string;
  negativePrompt?: string;
  textComposite?: TextComposite;
  sceneRef?: string;
  refStrength?: number;
}

function parseImagePrompts(promptsMd: string): ParsedScene[] {
  const scenes: ParsedScene[] = [];
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

    const negativeMatch = block.match(/\*\*네거티브\*\*:\s*\n([^\n]+)/i);
    const negativePrompt = negativeMatch ? negativeMatch[1].trim() : undefined;

    const textBlock = block.match(/\*\*텍스트\s*합성\*\*[^\n]*\n([\s\S]+?)(?=\n---|\n##|$)/i);
    const textComposite = textBlock ? parseTextComposite(textBlock[1]) : undefined;

    // Per-scene img2img reference: "**이미지 참조**: scene_01-A"
    const refMatch = block.match(/\*\*이미지\s*참조\*\*:\s*scene[_-](\S+)/i);
    const sceneRef = refMatch ? refMatch[1].toUpperCase().replace('_', '-') : undefined;

    // Optional strength override: "**참조 강도**: 0.75"
    const strengthMatch = block.match(/\*\*참조\s*강도\*\*:\s*([\d.]+)/i);
    const refStrength = strengthMatch ? parseFloat(strengthMatch[1]) : undefined;

    scenes.push({ id: sceneId, prompt, negativePrompt, textComposite, sceneRef, refStrength });
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

export function calcImageCost(projectId: string, promptsMd: string): { toGenerate: number; skipped: number; costPerUnit: number; totalCost: number } {
  const scenes = parseImagePrompts(promptsMd);
  const alreadyDone = scenes.filter((s) =>
    fs.existsSync(path.join(projectDir(projectId), `images/scene_${s.id}.jpg`))
  ).length;
  const toGenerate = scenes.length - alreadyDone;
  const COST_PER_IMAGE = 0.025;
  return { toGenerate, skipped: alreadyDone, costPerUnit: COST_PER_IMAGE, totalCost: +(toGenerate * COST_PER_IMAGE).toFixed(4) };
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
  const imageSize = project?.aspectRatio === '9:16'
    ? { width: 1080, height: 1920 }
    : { width: 1920, height: 1080 };

  emit(projectId, { type: 'log', message: `[9단계] 이미지 생성 (${scenes.length}개 씬, ${project?.aspectRatio ?? '16:9'})` });

  const alreadyDoneImages = scenes.filter((s) =>
    fs.existsSync(path.join(projectDir(projectId), `images/scene_${s.id}.jpg`))
  ).length;
  const COST_PER_IMAGE = 0.025;
  const imagesToGenerate = scenes.length - alreadyDoneImages;
  const imageCostEntry = {
    timestamp: new Date().toISOString(),
    projectId,
    stage: 'image' as const,
    toGenerate: imagesToGenerate,
    skipped: alreadyDoneImages,
    costPerUnit: COST_PER_IMAGE,
    totalCost: +(imagesToGenerate * COST_PER_IMAGE).toFixed(4),
  };
  emit(projectId, { type: 'cost', ...imageCostEntry });
  appendCostLog(imageCostEntry);

  for (const scene of scenes) {
    const localPath = `images/scene_${scene.id}.jpg`;
    const absPath = path.join(projectDir(projectId), localPath);

    if (fs.existsSync(absPath)) {
      emit(projectId, { type: 'log', message: `  씬 ${scene.id} 건너뜀 (이미 존재)` });
      continue;
    }

    emit(projectId, { type: 'log', message: `  씬 ${scene.id} 이미지 생성 중…` });

    const BASE_NEGATIVE = 'screen on back of device, impossible object orientation, anatomically incorrect structure, physically impossible configuration';
    const negativePrompt = scene.negativePrompt
      ? `${scene.negativePrompt}, ${BASE_NEGATIVE}`
      : BASE_NEGATIVE;

    // Resolve effective reference: per-scene ref overrides global ref
    let effectiveImageUrl: string | null = referenceImageUrl;
    let effectiveStrength = options?.referenceStrength ?? 0.75;

    if (scene.sceneRef) {
      const refPath = path.join(projectDir(projectId), `images/scene_${scene.sceneRef}.jpg`);
      if (fs.existsSync(refPath)) {
        emit(projectId, { type: 'log', message: `  📎 씬 ${scene.sceneRef} 참조 이미지 업로드 중…` });
        const uploaded = await uploadToFalStorage(refPath, apiKey);
        if (uploaded) {
          effectiveImageUrl = uploaded;
          effectiveStrength = scene.refStrength ?? 0.75;
          emit(projectId, { type: 'log', message: `  ✅ 씬 ${scene.sceneRef} 참조 준비 완료 (강도 ${effectiveStrength})` });
        } else {
          emit(projectId, { type: 'log', message: `  ⚠️ 참조 이미지 업로드 실패 — 레퍼런스 없이 생성` });
          effectiveImageUrl = null;
        }
      } else {
        emit(projectId, { type: 'log', message: `  ⚠️ 씬 ${scene.sceneRef} 이미지가 아직 없음 — 레퍼런스 없이 생성` });
        effectiveImageUrl = null;
      }
    }

    // img2img uses a different endpoint and omits image_size
    const useImg2Img = !!effectiveImageUrl;
    const endpoint = useImg2Img
      ? 'https://fal.run/fal-ai/flux/dev/image-to-image'
      : 'https://fal.run/fal-ai/flux/dev';

    const body: Record<string, unknown> = {
      prompt: scene.prompt,
      negative_prompt: negativePrompt,
      num_inference_steps: 35,
      guidance_scale: 5.0,
      num_images: 1,
      enable_safety_checker: true,
    };

    if (useImg2Img) {
      body.image_url = effectiveImageUrl;
      body.strength = effectiveStrength;
    } else {
      body.image_size = imageSize;
    }

    const res = await fetch(endpoint, {
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
