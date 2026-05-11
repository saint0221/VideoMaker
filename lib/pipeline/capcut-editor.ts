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

interface SceneAsset {
  id: string;
  videoFile?: string;
  imageFiles: string[];
  duration: number;      // microseconds (video-driven)
  videoDuration: number; // actual video clip length
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
    const videoSrc = path.join(videosDir, `scene_${id}.mp4`);
    const audioSrc = path.join(audioDir, `scene_${id}.mp3`);
    const srtSrc = path.join(subsDir, `scene_${id}.srt`);

    const videoFile = copyAsset(videoSrc, capcutDir);

    // 오디오·자막 파일도 복사 (수동 배치용)
    copyAsset(audioSrc, capcutDir);
    copyAsset(srtSrc, capcutDir);

    let sceneImageFiles: string[] = [];
    if (!videoFile && fs.existsSync(imagesDir)) {
      const pattern = new RegExp(`^scene_${id}(?:-[A-Za-z])?\\.jpg$`);
      sceneImageFiles = fs.readdirSync(imagesDir)
        .filter((f) => pattern.test(f))
        .sort()
        .map((f) => copyAsset(path.join(imagesDir, f), capcutDir))
        .filter(Boolean) as string[];
    }

    const videoDuration = videoFile
      ? (getFileDuration(videoFile) || 5_000_000)
      : 4_000_000;

    const audioDuration = fs.existsSync(audioSrc) ? getFileDuration(audioSrc) : 0;
    const duration = videoFile ? videoDuration : (audioDuration > 0 ? audioDuration : 4_000_000);

    scenes.push({ id, videoFile, imageFiles: sceneImageFiles, duration, videoDuration });
  }

  // ---- Video track ----
  const draftId = uuid();
  const videoMaterials: object[] = [];
  const videoSegments: object[] = [];
  let offset = 0;

  for (const s of scenes) {
    if (s.videoFile) {
      const materialId = uuid();
      videoMaterials.push({
        id: materialId,
        type: 'video',
        path: s.videoFile,
        duration: s.videoDuration,
      });
      let filled = 0;
      let partNum = 1;
      while (filled < s.duration) {
        const remaining = s.duration - filled;
        const clipLen = Math.min(s.videoDuration, remaining);
        videoSegments.push({
          id: `seg_${s.id}_part_${partNum++}`,
          material_id: materialId,
          target_timerange: { start: offset + filled, duration: clipLen },
          source_timerange: { start: 0, duration: clipLen },
          extra_material_refs: [],
        });
        filled += clipLen;
      }
    } else if (s.imageFiles.length > 0) {
      const perImage = Math.floor(s.duration / s.imageFiles.length);
      let imageOffset = 0;
      s.imageFiles.forEach((imgFile, idx) => {
        const materialId = uuid();
        const isLast = idx === s.imageFiles.length - 1;
        const thisDuration = isLast ? s.duration - imageOffset : perImage;
        videoMaterials.push({
          id: materialId,
          type: 'photo',
          path: imgFile,
          duration: thisDuration,
        });
        videoSegments.push({
          id: `seg_${s.id}_part_${idx + 1}`,
          material_id: materialId,
          target_timerange: { start: offset + imageOffset, duration: thisDuration },
          source_timerange: { start: 0, duration: thisDuration },
          extra_material_refs: [],
        });
        imageOffset += thisDuration;
      });
    }

    offset += s.duration;
  }

  const totalDuration = scenes.reduce((sum, s) => sum + s.duration, 0);
  const nowMs = Date.now();

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
    tracks: [{ id: uuid(), type: 'video', segments: videoSegments, flag: 0, attribute: 0, name: '', is_default_name: true }],
    materials: { videos: videoMaterials, audios: [], texts: [] },
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
