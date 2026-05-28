import fs from 'fs';
import path from 'path';
import { emit } from '../events';
import { writeFileBinary, projectDir, loadProject, appendCostLog } from '../project';
import type { ImageModel } from '../types';

export const MODEL_PRICE: Record<ImageModel, number> = {
  'fal-ai/flux-lora': 0.035,
  'fal-ai/flux/schnell': 0.003,
  'fal-ai/fast-sdxl': 0.0025,
  'fal-ai/flux-2/lora': 0.042,
};

interface FalImageResult {
  images: Array<{ url: string; content_type: string }>;
}

export const SAMPLE_COUNT = 3;

export interface ImageGeneratorOptions {
  imageModel?: ImageModel;
  loraUrl?: string;
  loraScale?: number;
  sampleOnly?: boolean;
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
  const contentMatch = block.match(/내용:\s*(?:"([^"]+)"|([^\n"]+))/);
  if (!contentMatch) return undefined;

  const fontMatch = block.match(/폰트:\s*(\S+)/);
  const posMatch = block.match(/x=([\d.]+),\s*y=([\d.]+)/);
  const colorMatch = block.match(/색상:\s*(#[0-9A-Fa-f]{3,8})/);
  const strokeMatch = block.match(/테두리:\s*(#[0-9A-Fa-f]{3,8})\s+(\d+)px/);
  const sizeMatch = block.match(/크기:\s*(\d+)px/);

  return {
    content: (contentMatch[1] ?? contentMatch[2]).trim().replace(/\\n/g, '\n'),
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
}

interface CharacterEntry {
  label: string;
  description: string;
}

function parseCharacterEntries(promptsMd: string): CharacterEntry[] {
  const match = promptsMd.match(/##\s*CHARACTER_ANCHOR\s*\n([\s\S]+?)(?=\n---|\n##\s+)/i);
  if (!match) return [];
  const anchor = match[1].trim();
  if (!anchor || anchor === 'N/A') return [];
  const entries: CharacterEntry[] = [];
  for (const block of anchor.split(/\n\n+/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const label = trimmed.substring(0, colonIdx).trim();
    const description = trimmed.substring(colonIdx + 1).trim();
    if (label && description) entries.push({ label, description });
  }
  return entries;
}

const CREATURE_TERMS = [
  'dog', 'cat', 'horse', 'bird', 'fish', 'wolf', 'fox', 'bear', 'lion', 'tiger',
  'rabbit', 'retriever', 'labrador', 'poodle', 'husky', 'bulldog', 'corgi',
  'parrot', 'dragon', 'monster', 'creature', 'animal', 'puppy', 'kitten',
  'snake', 'hamster', 'deer', 'owl', 'eagle',
];

// Words that indicate a human figure is present in the scene.
// Excludes 'silhouette' (matches "brain silhouette") and uses word-boundary matching
// to avoid substring false positives like "commanding" → "man", "demanding" → "man".
const HUMAN_TERMS = [
  // generic
  'character', 'figure', 'person', 'woman', 'man',
  'couple', 'pair', 'embrace', 'hug', 'standing', 'sitting',
  'walking', 'people', 'someone', 'human', 'portrait', 'face', 'body',
  // age / gender
  'boy', 'girl', 'child', 'children', 'elder', 'elderly', 'youth', 'baby',
  // royalty / nobility
  'king', 'queen', 'emperor', 'empress', 'prince', 'princess',
  'lord', 'noble', 'nobleman', 'noblewoman', 'aristocrat',
  // military / official
  'soldier', 'warrior', 'general', 'officer', 'guard', 'knight',
  'official', 'minister', 'envoy', 'ambassador',
  // historical / cultural roles
  'scholar', 'monk', 'priest', 'shaman', 'philosopher',
  'merchant', 'farmer', 'servant', 'slave', 'artisan',
  'assassin', 'spy', 'rebel', 'prisoner',
  // family / relationship
  'father', 'mother', 'son', 'daughter', 'husband', 'wife',
  'brother', 'sister', 'family',
  // body-part cues that imply a person
  'hands', 'eyes', 'gaze',
];
const HUMAN_TERM_RE = new RegExp(`\\b(${HUMAN_TERMS.join('|')})\\b`);

function filterCharactersForScene(entries: CharacterEntry[], scenePrompt: string): CharacterEntry[] {
  const promptLower = scenePrompt.toLowerCase();
  return entries.filter(entry => {
    const combined = `${entry.label} ${entry.description}`.toLowerCase();
    const entryCreatureTerms = CREATURE_TERMS.filter(t => new RegExp(`\\b${t}\\b`).test(combined));
    if (entryCreatureTerms.length > 0) {
      return entryCreatureTerms.some(t => promptLower.includes(t));
    }
    // Human entry: only include when the scene actually features a human figure
    return HUMAN_TERM_RE.test(promptLower);
  });
}

function buildAnchorString(entries: CharacterEntry[]): string {
  return entries.map(e => `${e.label}: ${e.description}`).join('\n\n');
}

// SDXL 77-token CLIP limit: compress CHARACTER_ANCHOR to ~10 essential visual tokens.
// Extracts short comma-delimited visual phrases, skips narrative/negative sentence openers.
function compressAnchorForSdxl(anchor: string): string {
  const skipPattern = /^(no named|all human|all figures|or shown|not individualized|primary|secondary)/i;
  const phrases = anchor
    .replace(/\([^)]+\)/g, '')
    .split(/[,;—–]/)
    .map(s => s.trim())
    .filter(s => {
      const words = s.split(/\s+/).filter(Boolean);
      return words.length >= 1 && words.length <= 5 && !skipPattern.test(s);
    });
  return phrases.slice(0, 4).join(', ');
}

function parseImagePrompts(promptsMd: string): ParsedScene[] {
  const scenes: ParsedScene[] = [];
  // Support both "## SCENE 01" and "### SLOT 01-A" header formats
  const blocks = promptsMd.split(/(?=(?:##\s+SCENE|###\s+SLOT)\s+[\dA-Z])/i);

  for (const block of blocks) {
    // Handles: "SCENE 01", "SCENE 02-A", "SCENE 02 — CUT 1", "### SLOT 01-A"
    const idMatch = block.match(
      /(?:##\s+SCENE|###\s+SLOT)\s+(\d+)(?:[_-]([A-Za-z]))?(?:\s*[-—–]+\s*(?:CUT\s*)?(\d+|[A-Za-z]))?/i,
    );
    if (!idMatch) continue;

    const baseNum = idMatch[1].padStart(2, '0');
    let sceneId: string;
    if (idMatch[2]) {
      // SCENE 02-A or SLOT 02-A
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

    // Support both Korean "**프롬프트 (영문)**:" and English "**English prompt**:" field labels
    const promptMatch = block.match(
      /\*\*(?:프롬프트\s*\(영문\)|English\s+prompt)\*\*:\s*\n([\s\S]+?)(?=\n\s*\n\*\*(?:프롬프트\s*\(한글\)|한국어)|$)/i,
    );
    if (!promptMatch) continue;

    const prompt = promptMatch[1].trim();
    if (!prompt) continue;

    // Support both "**네거티브**:" and "**Negative prompt**:" labels
    const negativeMatch = block.match(/\*\*(?:네거티브|Negative\s+prompt)\*\*:\s*\n?([^\n]+)/i);
    const negativePrompt = negativeMatch ? negativeMatch[1].trim() : undefined;

    const textBlock = block.match(/\*\*텍스트\s*합성\*\*[^\n]*\n([\s\S]+?)(?=\n---|\n##|$)/i);
    const textComposite = textBlock ? parseTextComposite(textBlock[1]) : undefined;

    scenes.push({ id: sceneId, prompt, negativePrompt, textComposite });
  }

  return scenes;
}

export function countScenes(promptsMd: string): number {
  return parseImagePrompts(promptsMd).length;
}

export function calcImageCost(projectId: string, promptsMd: string, imageModel?: ImageModel): { toGenerate: number; skipped: number; costPerUnit: number; totalCost: number } {
  const scenes = parseImagePrompts(promptsMd);
  const alreadyDone = scenes.filter((s) =>
    fs.existsSync(path.join(projectDir(projectId), `images/scene_${s.id}.jpg`))
  ).length;
  const toGenerate = scenes.length - alreadyDone;
  const COST_PER_IMAGE = MODEL_PRICE[imageModel ?? 'fal-ai/flux-lora'];
  return { toGenerate, skipped: alreadyDone, costPerUnit: COST_PER_IMAGE, totalCost: +(toGenerate * COST_PER_IMAGE).toFixed(4) };
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

  const allScenes = parseImagePrompts(promptsMd);
  if (allScenes.length === 0) {
    emit(projectId, { type: 'log', message: '⚠️ 이미지 프롬프트 파싱 실패 — 이미지 생성 건너뜀' });
    return;
  }

  // Slice to sample scenes BEFORE the "already exists" filter
  const scenes = options?.sampleOnly ? allScenes.slice(0, SAMPLE_COUNT) : allScenes;

  const characterEntries = parseCharacterEntries(promptsMd);
  if (characterEntries.length > 0) {
    emit(projectId, { type: 'log', message: `  🎭 캐릭터 앵커 적용 — ${characterEntries.length}개 캐릭터, 씬별 필요 인물만 주입` });
  }

  const project = loadProject(projectId);
  const imageSize = project?.aspectRatio === '9:16'
    ? { width: 1080, height: 1920 }
    : { width: 1920, height: 1080 };

  const sampleLabel = options?.sampleOnly ? ` (샘플 ${scenes.length}장)` : '';
  emit(projectId, { type: 'log', message: `[9단계] 이미지 생성 (${scenes.length}개 씬, ${project?.aspectRatio ?? '16:9'})${sampleLabel}` });

  const alreadyDoneImages = scenes.filter((s) =>
    fs.existsSync(path.join(projectDir(projectId), `images/scene_${s.id}.jpg`))
  ).length;
  const COST_PER_IMAGE = MODEL_PRICE[options?.imageModel ?? 'fal-ai/flux-lora'];
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

  const key: string = apiKey;

  type SceneTask = { scene: ParsedScene; absPath: string; localPath: string };

  const tasks: SceneTask[] = [];
  for (const scene of scenes) {
    const localPath = `images/scene_${scene.id}.jpg`;
    const absPath = path.join(projectDir(projectId), localPath);
    if (fs.existsSync(absPath)) {
      emit(projectId, { type: 'log', message: `  씬 ${scene.id} 건너뜀 (이미 존재)` });
      continue;
    }
    tasks.push({ scene, absPath, localPath });
  }

  const CONCURRENCY = 3;
  const errors: string[] = [];
  let next = 0;

  async function processScene({ scene, absPath, localPath }: SceneTask): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 3000 * attempt));
        emit(projectId, { type: 'log', message: `  씬 ${scene.id} 이미지 재시도 ${attempt}/2…` });
      }
      try {
        emit(projectId, { type: 'log', message: `  씬 ${scene.id} 이미지 생성 중…` });

        const BASE_NEGATIVE = 'screen on back of device, impossible object orientation, anatomically incorrect structure, physically impossible configuration, character sheet, reference sheet, grid layout, collage, tiled pattern, pattern repeat, multiple variants, multiple views, multiple poses, turnaround sheet';
        const negativePrompt = scene.negativePrompt
          ? `${scene.negativePrompt}, ${BASE_NEGATIVE}`
          : BASE_NEGATIVE;

        const loraUrl = options?.loraUrl;
        const loraScale = options?.loraScale ?? 0.8;

        // flux/schnell, flux-2는 loras 파라미터 미지원 → flux-lora로 강제 전환
        const baseModel = options?.imageModel ?? 'fal-ai/flux-lora';
        const loraCompatible = baseModel === 'fal-ai/flux-lora' || baseModel === 'fal-ai/fast-sdxl' || baseModel === 'fal-ai/flux-2/lora';
        const model = loraUrl && !loraCompatible ? 'fal-ai/flux-lora' : baseModel;
        const endpoint = `https://fal.run/${model}`;
        const isSchnell = model === 'fal-ai/flux/schnell';
        const isFastSdxl = model === 'fal-ai/fast-sdxl';
        const isFlux2Lora = model === 'fal-ai/flux-2/lora';
        const isFluxLora = model === 'fal-ai/flux-lora';

        const relevantEntries = filterCharactersForScene(characterEntries, scene.prompt);
        const sceneAnchor = relevantEntries.length > 0 ? buildAnchorString(relevantEntries) : null;
        const finalPrompt = sceneAnchor
          ? isFastSdxl
            ? `${scene.prompt}, ${compressAnchorForSdxl(sceneAnchor)}`
            : `${sceneAnchor}\n\n${scene.prompt}`
          : scene.prompt;

        const body: Record<string, unknown> = {
          prompt: finalPrompt,
          num_images: 1,
          negative_prompt: negativePrompt,
          guidance_scale: isFastSdxl ? 7.5 : (isFluxLora || isFlux2Lora) ? 3.5 : 5.0,
          num_inference_steps: isSchnell ? 4 : (isFastSdxl ? 50 : (isFluxLora || isFlux2Lora) ? 28 : 35),
          enable_safety_checker: true,
          image_size: imageSize,
        };

        if ((isFluxLora || isFastSdxl || isFlux2Lora) && loraUrl) {
          body.loras = [{ path: loraUrl, scale: loraScale }];
          emit(projectId, { type: 'log', message: `  🎨 LoRA 적용 (${model}): scale=${loraScale.toFixed(1)} — ${loraUrl}` });
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Key ${key}`,
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
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr !== undefined) {
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      errors.push(msg);
      emit(projectId, { type: 'log', message: `  ❌ 씬 ${scene.id} 이미지 실패: ${msg}` });
    }
  }

  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const task = tasks[next++];
      await processScene(task);
    }
  }

  if (tasks.length > 0) {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, () => worker()));
  }

  if (errors.length > 0) {
    throw new Error(`이미지 생성 실패 (${errors.length}개 씬):\n${errors.join('\n')}`);
  }

  emit(projectId, { type: 'log', message: '✅ 이미지 생성 완료 — 확인 후 영상 생성을 진행해주세요' });
}
