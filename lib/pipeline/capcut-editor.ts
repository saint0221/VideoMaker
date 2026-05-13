import { emit } from '../events';
import { projectDir } from '../project';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getFileDuration(filePath: string): number {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8' }
    ).trim();
    return Math.round(parseFloat(out) * 1_000_000);
  } catch {
    return 0;
  }
}

function extractLastFrame(videoPath: string, outputPath: string): boolean {
  try {
    execSync(
      `ffmpeg -y -sseof -0.1 -i "${videoPath}" -frames:v 1 -q:v 2 "${outputPath}" 2>/dev/null`,
      { encoding: 'utf-8' }
    );
    return fs.existsSync(outputPath);
  } catch {
    return false;
  }
}

interface SrtEntry {
  start: number;  // microseconds
  end: number;    // microseconds
  text: string;
}

function parseSrt(content: string): SrtEntry[] {
  const entries: SrtEntry[] = [];
  const blocks = content.trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    const m = lines[1].match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
    if (!m) continue;
    const toUs = (h: string, min: string, s: string, ms: string) =>
      (parseInt(h) * 3600 + parseInt(min) * 60 + parseInt(s)) * 1_000_000 + parseInt(ms) * 1_000;
    entries.push({
      start: toUs(m[1], m[2], m[3], m[4]),
      end: toUs(m[5], m[6], m[7], m[8]),
      text: lines.slice(2).join('\n'),
    });
  }
  return entries;
}

function makeTextContent(text: string, fontSize: number): string {
  const style = {
    text,
    fill: { content: { render_type: 'color', color: [{ alpha: 1, blue: 1, green: 1, red: 1 }] } },
    size_ratio: 1,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    letter_spacing: 0,
  };
  return JSON.stringify({
    styles: [style],
    align: 'center',
    base_content: text,
    fixed_height: -1,
    fixed_width: -1,
    inner_padding: -1,
    text_size: fontSize,
    typesetting: 'horizontal',
    vertical_align: 'center',
  });
}

interface SceneAsset {
  id: string;
  videoFiles: string[];
  imageFiles: string[];
  audioFile?: string;
  srtFile?: string;
  duration: number;
}

function copyAsset(src: string, destDir: string): string | undefined {
  if (!fs.existsSync(src)) return undefined;
  const dest = path.join(destDir, path.basename(src));
  fs.copyFileSync(src, dest);
  return dest;
}

export async function runCapcutEditor(projectId: string): Promise<void> {
  emit(projectId, { type: 'log', message: '[11단계] CapCut 프로젝트 생성 중...' });

  const pDir = projectDir(projectId);
  const capcutDir = path.join(pDir, 'capcut-project');
  if (!fs.existsSync(capcutDir)) fs.mkdirSync(capcutDir, { recursive: true });

  const videosDir = path.join(pDir, 'videos');
  const imagesDir = path.join(pDir, 'images');
  const audioDir = path.join(pDir, 'audio');
  const subsDir = path.join(pDir, 'subtitles');

  const videoFiles = fs.existsSync(videosDir)
    ? fs.readdirSync(videosDir).filter((f) => f.endsWith('.mp4')).sort()
    : [];
  const imageFiles = fs.existsSync(imagesDir)
    ? fs.readdirSync(imagesDir).filter((f) => f.endsWith('.jpg')).sort()
    : [];

  const sceneIds = new Set<string>();
  for (const f of [...videoFiles, ...imageFiles]) {
    const m = f.match(/scene_(\d+)/);
    if (m) sceneIds.add(m[1]);
  }

  if (sceneIds.size === 0) {
    emit(projectId, { type: 'log', message: '⚠️ 씬 에셋 없음 — CapCut 프로젝트 건너뜀' });
    return;
  }

  const scenes: SceneAsset[] = [];

  for (const id of [...sceneIds].sort()) {
    const audioSrc = path.join(audioDir, `scene_${id}.mp3`);
    const srtSrc = path.join(subsDir, `scene_${id}.srt`);

    const audioFile = copyAsset(audioSrc, capcutDir);
    const srtFile = copyAsset(srtSrc, capcutDir);

    const videoPattern = new RegExp(`^scene_${id}(?:-[A-Za-z])?\\.mp4$`);
    const sceneVideoFiles = fs.existsSync(videosDir)
      ? fs.readdirSync(videosDir)
          .filter((f) => videoPattern.test(f))
          .sort()
          .map((f) => copyAsset(path.join(videosDir, f), capcutDir))
          .filter(Boolean) as string[]
      : [];

    let sceneImageFiles: string[] = [];
    if (sceneVideoFiles.length === 0 && fs.existsSync(imagesDir)) {
      const imagePattern = new RegExp(`^scene_${id}(?:-[A-Za-z])?\\.jpg$`);
      sceneImageFiles = fs.readdirSync(imagesDir)
        .filter((f) => imagePattern.test(f))
        .sort()
        .map((f) => copyAsset(path.join(imagesDir, f), capcutDir))
        .filter(Boolean) as string[];
    }

    const totalVideoDuration = sceneVideoFiles.reduce((sum, f) => sum + (getFileDuration(f) || 5_000_000), 0);
    const audioDuration = audioFile ? getFileDuration(audioFile) : 0;
    // 오디오가 있으면 오디오 길이를 씬 기준으로 삼음 (영상이 길면 트림, 짧으면 freeze로 채움)
    const duration = sceneVideoFiles.length > 0
      ? (audioDuration > 0 ? audioDuration : totalVideoDuration)
      : (audioDuration > 0 ? audioDuration : 4_000_000);

    scenes.push({ id, videoFiles: sceneVideoFiles, imageFiles: sceneImageFiles, audioFile, srtFile, duration });
  }

  const draftId = uuid();
  const videoMaterials: object[] = [];
  const videoSegments: object[] = [];
  const audioMaterials: object[] = [];
  const audioSegments: object[] = [];
  const textMaterials: object[] = [];
  const textSegments: object[] = [];
  let offset = 0;

  for (const s of scenes) {
    const sceneStart = offset;

    // ---- Video / image segments ----
    if (s.videoFiles.length > 0) {
      let clipOffset = 0;
      let lastVideoFile = '';
      s.videoFiles.forEach((videoFile) => {
        const rawDuration = getFileDuration(videoFile) || 5_000_000;
        const clipDuration = Math.min(rawDuration, s.duration - clipOffset);
        if (clipDuration <= 0) return;
        const materialId = uuid();
        lastVideoFile = videoFile;
        videoMaterials.push({ id: materialId, type: 'video', path: videoFile, duration: clipDuration });
        videoSegments.push({
          id: uuid(),
          material_id: materialId,
          target_timerange: { start: sceneStart + clipOffset, duration: clipDuration },
          source_timerange: { start: 0, duration: clipDuration },
          speed: 1.0,
          extra_material_refs: [],
        });
        clipOffset += clipDuration;
      });
      // 오디오보다 영상이 짧으면 마지막 프레임을 JPEG로 추출해 photo 세그먼트로 채움
      // (같은 파일 경로나 같은 material_id 재사용 시 CapCut이 세그먼트를 drop함)
      if (clipOffset < s.duration && lastVideoFile) {
        const gap = s.duration - clipOffset;
        const freezeBase = path.basename(lastVideoFile, '.mp4');
        const freezePath = path.join(capcutDir, `${freezeBase}_freeze.jpg`);
        if (extractLastFrame(lastVideoFile, freezePath)) {
          const freezeMaterialId = uuid();
          videoMaterials.push({ id: freezeMaterialId, type: 'photo', path: freezePath, duration: gap });
          videoSegments.push({
            id: uuid(),
            material_id: freezeMaterialId,
            target_timerange: { start: sceneStart + clipOffset, duration: gap },
            source_timerange: { start: 0, duration: gap },
            speed: 1.0,
            extra_material_refs: [],
          });
        }
      }
    } else if (s.imageFiles.length > 0) {
      const perImage = Math.floor(s.duration / s.imageFiles.length);
      let imageOffset = 0;
      s.imageFiles.forEach((imgFile, idx) => {
        const materialId = uuid();
        const isLast = idx === s.imageFiles.length - 1;
        const thisDuration = isLast ? s.duration - imageOffset : perImage;
        videoMaterials.push({ id: materialId, type: 'photo', path: imgFile, duration: thisDuration });
        videoSegments.push({
          id: uuid(),
          material_id: materialId,
          target_timerange: { start: sceneStart + imageOffset, duration: thisDuration },
          source_timerange: { start: 0, duration: thisDuration },
          speed: 1.0,
          extra_material_refs: [],
        });
        imageOffset += thisDuration;
      });
    }

    offset += s.duration;

    // ---- Audio segment ----
    if (s.audioFile) {
      const audioDur = getFileDuration(s.audioFile);
      if (audioDur > 0) {
        const audioMaterialId = uuid();
        audioMaterials.push({
          id: audioMaterialId,
          type: 'extract_music',
          path: s.audioFile,
          duration: audioDur,
          name: path.basename(s.audioFile),
          local_material_id: audioMaterialId,
          music_id: audioMaterialId,
          category_name: 'local',
          category_id: '',
          wave_points: [],
          loop: false,
        });
        audioSegments.push({
          id: uuid(),
          material_id: audioMaterialId,
          target_timerange: { start: sceneStart, duration: audioDur },
          source_timerange: { start: 0, duration: audioDur },
          extra_material_refs: [],
          volume: 1.0,
          speed: 1.0,
          loop: false,
          reverse: false,
          clip: { alpha: 1.0, flip: { horizontal: false, vertical: false }, rotation: 0, scale: { x: 1, y: 1 }, translation: { x: 0, y: 0 } },
          visible: true,
          last_nonzero_volume: 1.0,
        });
      }
    }

    // ---- Text (subtitle) segments ----
    if (s.srtFile && fs.existsSync(s.srtFile)) {
      const entries = parseSrt(fs.readFileSync(s.srtFile, 'utf-8'));
      for (const entry of entries) {
        const textMaterialId = uuid();
        const dur = entry.end - entry.start;
        textMaterials.push({
          id: textMaterialId,
          type: 'text',
          content: makeTextContent(entry.text, 40),
          font_size: 40,
          font_color: '#ffffff',
          background_alpha: 0,
          bold: false,
          italic: false,
          underline: false,
          alignment: 1,
          name: '',
          inner_padding: -1,
          fixed_height: -1,
          fixed_width: -1,
        });
        textSegments.push({
          id: uuid(),
          material_id: textMaterialId,
          target_timerange: { start: sceneStart + entry.start, duration: dur },
          source_timerange: { start: 0, duration: dur },
          extra_material_refs: [],
          clip: { alpha: 1.0, flip: { horizontal: false, vertical: false }, rotation: 0, scale: { x: 1, y: 1 }, translation: { x: 0, y: 0 } },
          visible: true,
        });
      }
    }
  }

  const totalDuration = scenes.reduce((sum, s) => sum + s.duration, 0);
  const nowMs = Date.now();

  const tracks = [
    { id: uuid(), type: 'video', segments: videoSegments, flag: 0, attribute: 0, name: '', is_default_name: true },
  ];
  if (audioSegments.length > 0) {
    tracks.push({ id: uuid(), type: 'audio', segments: audioSegments, flag: 0, attribute: 0, name: '', is_default_name: true });
  }
  if (textSegments.length > 0) {
    tracks.push({ id: uuid(), type: 'text', segments: textSegments, flag: 0, attribute: 0, name: '', is_default_name: true });
  }

  const draftInfo = {
    id: draftId,
    version: 360000,
    new_version: '',
    name: `VideoMaker_${projectId.slice(0, 8)}`,
    duration: totalDuration,
    create_time: Math.floor(nowMs / 1000),
    update_time: Math.floor(nowMs / 1000),
    fps: 30,
    canvas_config: { width: 1920, height: 1080, ratio: 'original' },
    tracks,
    materials: {
      videos: videoMaterials,
      audios: audioMaterials,
      texts: textMaterials,
      beats: [], canvases: [], chromas: [], color_curves: [], effects: [],
      handwrites: [], log_color_wheels: [], loudnesses: [], manual_deformations: [],
      masks: [], placeholders: [], plugin_effects: [], primary_color_wheels: [],
      speeds: [], stickers: [], tail_leaders: [], text_templates: [], transitions: [],
      video_effects: [], video_trackings: [], vocal_beautifys: [], vocaloids: [],
    },
  };

  const draftMeta = {
    id: draftId,
    draft_name: `VideoMaker_${projectId.slice(0, 8)}`,
    tm_draft_create: Math.floor(nowMs / 1000),
    tm_draft_modified: Math.floor(nowMs / 1000),
    draft_root_path: capcutDir,
  };

  fs.writeFileSync(path.join(capcutDir, 'draft_info.json'), JSON.stringify(draftInfo, null, 2));
  fs.writeFileSync(path.join(capcutDir, 'draft_meta_info.json'), JSON.stringify(draftMeta, null, 2));

  emit(projectId, { type: 'log', message: `✅ CapCut 프로젝트 생성 완료 → capcut-project/` });
}
