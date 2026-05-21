import { emit } from '../events';
import { projectDir, loadProject, saveProject } from '../project';
import { loadSettings } from '../settings';
import { runClaude, MODEL } from './claude-runner';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// UUIDs in CapCut are UPPERCASE
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
    .replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    })
    .toUpperCase();
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

function getVideoSize(filePath: string): { width: number; height: number } {
  try {
    const out = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8' }
    ).trim();
    const [w, h] = out.split(',').map(Number);
    return { width: w || 1280, height: h || 720 };
  } catch {
    return { width: 1280, height: 720 };
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

function extractSlotId(videoFile: string): string | null {
  const m = path.basename(videoFile).match(/^scene_(\d+-[A-Za-z]+)\.mp4$/i);
  return m ? m[1] : null;
}

function parseSlotNarrations(sceneDesignMd: string): Map<string, string> {
  const map = new Map<string, string>();
  const slotPattern = /### 슬롯 (\d+-[A-Za-z]+) \([^)]+\)([\s\S]*?)(?=\n### 슬롯 |\n## |$)/g;
  let m: RegExpExecArray | null;
  while ((m = slotPattern.exec(sceneDesignMd)) !== null) {
    const slotId = m[1];
    const body = m[2];
    const captionMatch = body.match(/- 자막:\s*"([^"]+)"/);
    if (captionMatch) {
      map.set(slotId, captionMatch[1]);
    }
  }
  return map;
}

function parseSlotDescriptions(
  imagePromptsMd: string,
  sceneId: string,
  narrations: Map<string, string>
): Array<{ slotId: string; desc: string }> {
  const results: Array<{ slotId: string; desc: string }> = [];
  const sections = imagePromptsMd.split(/^## SCENE /m);
  for (const section of sections) {
    const idMatch = section.match(/^(\d+-[A-Za-z]+)\n/);
    if (!idMatch) continue;
    const slotId = idMatch[1];
    if (!slotId.startsWith(sceneId + '-')) continue;
    // Prefer narration from scene-design.md — it directly matches SRT content
    const narration = narrations.get(slotId);
    if (narration) {
      results.push({ slotId, desc: narration });
      continue;
    }
    // Fallback: use Korean image prompt description
    const korMatch = section.match(/\*\*프롬프트 \(한글\)\*\*:\n([\s\S]*?)(?:\n\n\*\*네거티브\*\*|\n\*\*텍스트|---)/);
    if (!korMatch) continue;
    let desc = korMatch[1].trim().substring(0, 150);
    const textContentMatch = section.match(/\*\*텍스트 합성\*\*[^\n]*\n내용:\s*"([^"]+)"/);
    if (textContentMatch) {
      desc += ` [텍스트: ${textContentMatch[1].replace(/\\n/g, ' ')}]`;
    }
    results.push({ slotId, desc });
  }
  return results;
}

function computeSlotTimingsDeterministic(
  slots: Array<{ slotId: string; desc: string }>,
  srtEntries: SrtEntry[],
  totalDuration: number,
): Map<string, { start: number; end: number }> | null {
  if (slots.length === 0 || srtEntries.length === 0) return null;

  const normalize = (s: string) =>
    s.replace(/["""''「」『』（）()]/g, '')
      .replace(/[.!?。！？,，、]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  // Assign each SRT entry to a slot by substring containment
  const assignments: number[] = new Array(srtEntries.length).fill(-1);
  for (let ei = 0; ei < srtEntries.length; ei++) {
    const entryNorm = normalize(srtEntries[ei].text);
    for (let si = 0; si < slots.length; si++) {
      if (normalize(slots[si].desc).includes(entryNorm)) {
        assignments[ei] = si;
        break;
      }
    }
    if (assignments[ei] === -1) return null; // unmatched entry → fall back
  }

  // Verify monotone (no backtracking between slots)
  let prev = -1;
  for (const si of assignments) {
    if (si < prev) return null;
    prev = si;
  }

  // Build per-slot entry groups; slots with no entries get null (filled in pass 2)
  const slotEntries = slots.map((_, si) => srtEntries.filter((_, ei) => assignments[ei] === si));

  const rawTimings: Array<{ start: number; end: number } | null> = slotEntries.map((matching, si) => {
    if (matching.length === 0) return null;
    return {
      start: si === 0 ? 0 : matching[0].start,
      end: si === slots.length - 1 ? totalDuration : matching[matching.length - 1].end,
    };
  });

  // Pass 2: equal-split the gap between neighboring filled slots for empty slots
  const result = new Map<string, { start: number; end: number }>();
  let i = 0;
  while (i < slots.length) {
    if (rawTimings[i] !== null) {
      result.set(slots[i].slotId, rawTimings[i]!);
      i++;
      continue;
    }
    const runStart = i;
    while (i < slots.length && rawTimings[i] === null) i++;
    const runEnd = i;
    const gapStart = runStart === 0 ? 0 : rawTimings[runStart - 1]!.end;
    const gapEnd = runEnd >= slots.length ? totalDuration : rawTimings[runEnd]!.start;
    const each = (gapEnd - gapStart) / (runEnd - runStart);
    for (let j = 0; j < runEnd - runStart; j++) {
      result.set(slots[runStart + j].slotId, {
        start: gapStart + j * each,
        end: gapStart + (j + 1) * each,
      });
    }
  }
  return result;
}

async function computeSlotTimings(
  slots: Array<{ slotId: string; desc: string }>,
  srtEntries: SrtEntry[],
  totalDuration: number,
  projectId?: string
): Promise<Map<string, { start: number; end: number }> | null> {
  if (slots.length === 0 || srtEntries.length === 0) return null;

  const srtText = srtEntries
    .map((e, i) => `[${i + 1}] ${e.text.replace(/\n/g, ' ')}`)
    .join('\n');
  const slotText = slots.map((s, i) => `${i + 1}. ${s.slotId}: ${s.desc}`).join('\n');

  const prompt = `다음은 나레이션 자막 항목과 영상 슬롯 설명입니다.
각 슬롯이 나레이션의 어느 자막 항목을 커버하는지 연속 범위로 매핑하세요.

## 자막 항목 (번호: 내용)
${srtText}

## 영상 슬롯 (번호. 슬롯ID: 설명)
${slotText}

규칙:
- 모든 자막 항목은 정확히 한 슬롯에 속해야 합니다
- 슬롯 순서는 유지해야 합니다 (앞 슬롯이 나중 자막을 커버할 수 없음)
- 각 슬롯은 최소 1개의 자막 항목을 가져야 합니다
- 첫 슬롯은 항목 1부터 시작, 마지막 슬롯은 마지막 항목으로 끝나야 합니다

JSON 형식으로만 응답 (다른 텍스트 없이):
{"슬롯ID": [시작번호, 끝번호], ...}
예: {"02-A": [1, 6], "02-B": [7, 8], "02-C": [9, 10]}`;

  let raw: string;
  try {
    raw = await runClaude(prompt, { timeoutMs: 60_000, model: MODEL.SONNET, projectId });
  } catch {
    return null;
  }

  let mapping: Record<string, [number, number]>;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    mapping = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }

  // Validate
  const n = srtEntries.length;
  const covered = new Array(n + 1).fill(false);
  let prevEnd = 0;
  for (const slot of slots) {
    const range = mapping[slot.slotId];
    if (!Array.isArray(range) || range.length !== 2) return null;
    const [s, e] = range;
    if (s < 1 || e > n || s > e) return null;
    if (s <= prevEnd) return null; // not monotone
    for (let i = s; i <= e; i++) covered[i] = true;
    prevEnd = e;
  }
  for (let i = 1; i <= n; i++) {
    if (!covered[i]) return null;
  }

  // Convert to microsecond time ranges
  const result = new Map<string, { start: number; end: number }>();
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const [startIdx, endIdx] = mapping[slot.slotId];
    const start = i === 0 ? 0 : srtEntries[startIdx - 1].start;
    const end = i === slots.length - 1 ? totalDuration : srtEntries[endIdx].start;
    result.set(slot.slotId, { start, end });
  }
  return result;
}

function makeTextContent(text: string): string {
  return JSON.stringify({
    styles: [{
      fill: { content: { solid: { color: [1, 1, 1] }, render_type: 'solid' } },
      range: [0, text.length],
      size: 10,
      font: {
        path: '/Applications/CapCut.app/Contents/Resources/Font/SystemFont/en.ttf',
        id: '',
      },
    }],
    text,
  });
}

function makeVideoMaterial(id: string, filePath: string, duration: number, isPhoto = false, photoSize = { width: 1920, height: 1080 }): object {
  const size = isPhoto ? photoSize : getVideoSize(filePath);
  const name = path.basename(filePath);
  return {
    id,
    unique_id: '',
    type: isPhoto ? 'photo' : 'video',
    duration,
    path: filePath,
    media_path: '',
    local_id: '',
    has_audio: !isPhoto,
    reverse_path: '',
    intensifies_path: '',
    reverse_intensifies_path: '',
    intensifies_audio_path: '',
    cartoon_path: '',
    width: size.width,
    height: size.height,
    category_id: '',
    category_name: 'local',
    material_id: '',
    material_name: name,
    material_url: '',
    crop: {
      upper_left_x: 0.0, upper_left_y: 0.0,
      upper_right_x: 1.0, upper_right_y: 0.0,
      lower_left_x: 0.0, lower_left_y: 1.0,
      lower_right_x: 1.0, lower_right_y: 1.0,
    },
    crop_ratio: 'free',
    audio_fade: null,
    crop_scale: 1.0,
    extra_type_option: 0,
    stable: { stable_level: 0, matrix_path: '', time_range: { start: 0, duration: 0 } },
    matting: {
      flag: 0, path: '', interactiveTime: [], has_use_quick_brush: false, strokes: [],
      has_use_quick_eraser: false, expansion: 0, feather: 0, reverse: false,
      custom_matting_id: '', enable_matting_stroke: false,
    },
    source: 0,
    source_platform: 0,
    formula_id: '',
    check_flag: 62978047,
    video_algorithm: {
      algorithms: [], time_range: null, path: '', gameplay_configs: [],
      ai_in_painting_config: [], complement_frame_config: null, motion_blur_config: null,
      deflicker: null, noise_reduction: null, quality_enhance: null, super_resolution: null,
      ai_background_configs: [], smart_complement_frame: null, aigc_generate: null,
      aigc_generate_list: [], mouth_shape_driver: null, ai_expression_driven: null,
      ai_motion_driven: null, image_interpretation: null,
      story_video_modify_video_config: { task_id: '', is_overwrite_last_video: false, tracker_task_id: '' },
      skip_algorithm_index: [],
    },
    is_unified_beauty_mode: false,
    object_locked: null,
    smart_motion: null,
    multi_camera_info: null,
    freeze: null,
    picture_from: 'none',
    picture_set_category_id: '',
    picture_set_category_name: '',
    team_id: '',
    local_material_id: uuid(),
    origin_material_id: '',
    request_id: '',
    has_sound_separated: false,
    is_text_edit_overdub: false,
    is_ai_generate_content: false,
    aigc_type: 'none',
    is_copyright: true,
    aigc_history_id: '',
    aigc_item_id: '',
    local_material_from: '',
    smart_match_info: null,
    beauty_face_preset_infos: [],
    beauty_body_preset_id: '',
    beauty_face_auto_preset: { preset_id: '', name: '', rate_map: '', scene: '' },
    beauty_face_auto_preset_infos: [],
    beauty_body_auto_preset: null,
    live_photo_timestamp: -1,
    live_photo_cover_path: '',
    content_feature_info: null,
    corner_pin: null,
    surface_trackings: [],
    video_mask_stroke: {
      resource_id: '', path: '', type: '', color: '', size: 0.0,
      alpha: 0.0, distance: 0.0, texture: 0.0, horizontal_shift: 0.0, vertical_shift: 0.0,
    },
    video_mask_shadow: {
      resource_id: '', path: '', color: '', alpha: 0.0, blur: 0.0, distance: 0.0, angle: 0.0,
    },
  };
}

function makeAudioMaterial(id: string, filePath: string, duration: number): object {
  const name = path.basename(filePath);
  return {
    id,
    unique_id: '',
    type: 'extract_music',
    name,
    duration,
    path: filePath,
    category_name: 'local',
    wave_points: [],
    music_id: uuid().toLowerCase(),
    app_id: 0,
    text_id: '',
    tone_type: '',
    source_platform: 0,
    video_id: '',
    effect_id: '',
    resource_id: '',
    third_resource_id: '',
    category_id: '',
    intensifies_path: '',
    formula_id: '',
    check_flag: 1,
    team_id: '',
    local_material_id: uuid().toLowerCase(),
    tone_speaker: '',
    mock_tone_speaker: '',
    tone_effect_id: '',
    tone_effect_name: '',
    tone_platform: '',
    cloned_model_type: '',
    tone_category_id: '',
    tone_category_name: '',
    tone_second_category_id: '',
    tone_second_category_name: '',
    tone_emotion_name_key: '',
    tone_emotion_style: '',
    tone_emotion_role: '',
    tone_emotion_selection: '',
    tone_emotion_scale: 0.0,
    moyin_emotion: '',
    request_id: '',
    query: '',
    search_id: '',
    sound_separate_type: '',
    is_text_edit_overdub: false,
    is_ugc: false,
    is_ai_clone_tone: false,
    is_ai_clone_tone_post: false,
    source_from: '',
    copyright_limit_type: 'none',
    aigc_history_id: '',
    aigc_item_id: '',
    music_source: '',
    pgc_id: '',
    pgc_name: '',
    similiar_music_info: { original_song_id: '', original_song_name: '' },
    ai_music_type: 0,
    ai_music_enter_from: '',
    lyric_type: 0,
    tts_task_id: '',
    tts_generate_scene: '',
    ai_music_generate_scene: 0,
    tts_benefit_info: {
      benefit_type: 'none', benefit_log_id: '', benefit_log_extra: '', benefit_amount: -1,
    },
  };
}

function makeTextMaterial(id: string, text: string): object {
  const groupTs = Date.now();
  return {
    recognize_task_id: '',
    id,
    name: '',
    recognize_text: '',
    recognize_model: '',
    punc_model: '',
    type: 'subtitle',
    content: makeTextContent(text),
    base_content: '',
    words: { start_time: [], end_time: [], text: [] },
    current_words: { start_time: [], end_time: [], text: [] },
    global_alpha: 1.0,
    combo_info: { text_templates: [] },
    caption_template_info: {
      resource_id: '', third_resource_id: '', resource_name: '', category_id: '',
      category_name: '', effect_id: '', request_id: '', path: '', is_new: false, source_platform: 0,
    },
    layer_weight: 1,
    letter_spacing: 0.0,
    text_curve: null,
    text_loop_on_path: false,
    offset_on_path: 0.0,
    enable_path_typesetting: false,
    text_exceeds_path_process_type: 0,
    text_typesetting_paths: null,
    text_typesetting_paths_file: '',
    text_typesetting_path_index: 0,
    line_spacing: 0.02,
    has_shadow: false,
    shadow_color: '',
    shadow_alpha: 0.9,
    shadow_smoothing: 0.45,
    shadow_distance: 5.0,
    shadow_point: { x: 0.6363961030678928, y: -0.6363961030678927 },
    shadow_angle: -45.0,
    shadow_thickness_projection_enable: false,
    shadow_thickness_projection_angle: 0.0,
    shadow_thickness_projection_distance: 0.0,
    border_alpha: 1.0,
    border_color: '',
    border_width: 0.08,
    border_mode: 0,
    style_name: '',
    text_color: '#FFFFFF',
    text_alpha: 1.0,
    font_name: '',
    font_title: 'none',
    font_size: 8.0,
    font_path: '/Applications/CapCut.app/Contents/Resources/Font/SystemFont/en.ttf',
    font_id: '',
    font_resource_id: '',
    initial_scale: 1.0,
    font_url: '',
    typesetting: 0,
    alignment: 1,
    line_feed: 1,
    use_effect_default_color: true,
    is_rich_text: false,
    shape_clip_x: false,
    shape_clip_y: false,
    ktv_color: '',
    text_to_audio_ids: [],
    bold_width: 0.0,
    italic_degree: 0,
    underline: false,
    underline_width: 0.05,
    underline_offset: 0.22,
    sub_type: 0,
    check_flag: 7,
    text_size: 48,
    font_category_name: '',
    font_source_platform: 0,
    font_third_resource_id: '',
    font_category_id: '',
    add_type: 2,
    operation_type: 0,
    recognize_type: 0,
    fonts: [],
    background_color: '',
    background_alpha: 1.0,
    background_style: 0,
    background_round_radius: 0.0,
    background_width: 0.14,
    background_height: 0.14,
    background_vertical_offset: 0.0,
    background_horizontal_offset: 0.0,
    background_fill: '',
    single_char_bg_enable: false,
    single_char_bg_color: '',
    single_char_bg_alpha: 1.0,
    single_char_bg_round_radius: 0.3,
    single_char_bg_width: 0.0,
    single_char_bg_height: 0.0,
    single_char_bg_vertical_offset: 0.0,
    single_char_bg_horizontal_offset: 0.0,
    font_team_id: '',
    tts_auto_update: false,
    text_preset_resource_id: '',
    group_id: `import_GROUP_${groupTs}`,
    preset_id: '',
    preset_name: '',
    preset_category: '',
    preset_category_id: '',
    preset_index: 0,
    preset_has_set_alignment: false,
    force_apply_line_max_width: false,
    language: '',
    relevance_segment: [],
    original_size: [],
    fixed_width: -1.0,
    fixed_height: -1.0,
    line_max_width: 0.78,
    oneline_cutoff: false,
    cutoff_postfix: '',
    subtitle_template_original_fontsize: 0.0,
    subtitle_keywords: null,
    inner_padding: -1.0,
    multi_language_current: 'none',
    source_from: '',
    is_lyric_effect: false,
    lyric_group_id: '',
    lyrics_template: {
      resource_id: '', resource_name: '', panel: '', effect_id: '',
      path: '', category_id: '', category_name: '', request_id: '',
    },
    is_batch_replace: false,
    is_words_linear: false,
    ssml_content: '',
    subtitle_keywords_config: null,
    sub_template_id: -1,
    translate_original_text: '',
  };
}

function makeSegmentBase(segId: string, materialId: string, targetStart: number, targetDur: number) {
  return {
    id: segId,
    render_timerange: { start: 0, duration: 0 },
    desc: '',
    state: 0,
    speed: 1.0,
    is_loop: false,
    is_tone_modify: false,
    reverse: false,
    intensifies_audio: false,
    cartoon: false,
    volume: 1.0,
    last_nonzero_volume: 1.0,
    material_id: materialId,
    extra_material_refs: [],
    render_index: 0,
    keyframe_refs: [],
    enable_lut: false,
    enable_adjust: false,
    enable_hsl: false,
    visible: true,
    group_id: '',
    enable_color_curves: true,
    enable_hsl_curves: true,
    hdr_settings: null,
    enable_color_wheels: true,
    track_attribute: 0,
    is_placeholder: false,
    template_id: '',
    enable_smart_color_adjust: false,
    template_scene: 'default',
    common_keyframes: [],
    caption_info: null,
    responsive_layout: {
      enable: false, target_follow: '', size_layout: 0,
      horizontal_pos_layout: 0, vertical_pos_layout: 0,
    },
    enable_color_match_adjust: false,
    enable_color_correct_adjust: false,
    enable_adjust_mask: false,
    raw_segment_id: '',
    lyric_keyframes: null,
    enable_video_mask: true,
    digital_human_template_group_id: '',
    color_correct_alg_result: '',
    source: 'segmentsourcenormal',
    enable_mask_stroke: false,
    enable_mask_shadow: false,
    enable_color_adjust_pro: false,
    target_timerange: { start: targetStart, duration: targetDur },
  };
}

function makeVideoSegment(
  segId: string, materialId: string,
  targetStart: number, targetDur: number, sourceStart: number, sourceDur: number,
  trackRenderIndex: number
): object {
  return {
    ...makeSegmentBase(segId, materialId, targetStart, targetDur),
    source_timerange: { start: sourceStart, duration: sourceDur },
    clip: {
      scale: { x: 1.0, y: 1.0 },
      rotation: 0.0,
      transform: { x: 0.0, y: 0.0 },
      flip: { vertical: false, horizontal: false },
      alpha: 1.0,
    },
    uniform_scale: { on: true, value: 1.0 },
    enable_lut: true,
    hdr_settings: { mode: 1, intensity: 1.0, nits: 1000 },
    track_render_index: trackRenderIndex,
  };
}

function makeAudioSegment(
  segId: string, materialId: string,
  targetStart: number, targetDur: number,
  trackRenderIndex: number
): object {
  return {
    ...makeSegmentBase(segId, materialId, targetStart, targetDur),
    source_timerange: { start: 0, duration: targetDur },
    clip: null,
    uniform_scale: null,
    hdr_settings: null,
    track_render_index: trackRenderIndex,
  };
}

function makeTextSegment(
  segId: string, materialId: string,
  targetStart: number, targetDur: number,
  trackRenderIndex: number
): object {
  return {
    ...makeSegmentBase(segId, materialId, targetStart, targetDur),
    source_timerange: null,
    clip: {
      scale: { x: 1.0, y: 1.0 },
      rotation: 0.0,
      transform: { x: 0.0, y: -0.70 },
      flip: { vertical: false, horizontal: false },
      alpha: 1.0,
    },
    uniform_scale: { on: true, value: 1.0 },
    hdr_settings: null,
    track_render_index: trackRenderIndex,
  };
}

function makeEmptyMaterials(
  videoMats: object[], audioMats: object[], textMats: object[]
): object {
  return {
    ai_translates: [],
    audio_balances: [],
    audio_effects: [],
    audio_fades: [],
    audio_pannings: [],
    audio_pitch_shifts: [],
    audio_track_indexes: [],
    audios: audioMats,
    beats: [],
    canvases: [],
    chromas: [],
    color_curves: [],
    common_mask: [],
    digital_human_model_dressing: [],
    digital_humans: [],
    drafts: [],
    effects: [],
    flowers: [],
    green_screens: [],
    handwrites: [],
    hsl: [],
    hsl_curves: [],
    images: [],
    log_color_wheels: [],
    loudnesses: [],
    manual_beautys: [],
    manual_deformations: [],
    material_animations: [],
    material_colors: [],
    multi_language_refs: [],
    placeholder_infos: [],
    placeholders: [],
    plugin_effects: [],
    primary_color_wheels: [],
    realtime_denoises: [],
    shapes: [],
    smart_crops: [],
    smart_relights: [],
    sound_channel_mappings: [],
    speeds: [],
    stickers: [],
    tail_leaders: [],
    text_templates: [],
    texts: textMats,
    time_marks: [],
    transitions: [],
    video_effects: [],
    video_radius: [],
    video_shadows: [],
    video_strokes: [],
    video_trackings: [],
    videos: videoMats,
    vocal_beautifys: [],
    vocal_separations: [],
  };
}

interface SceneAsset {
  id: string;
  videoFiles: string[];
  audioFile?: string;
  srtFile?: string;
  sentenceSrtFile?: string;
  duration: number;  // microseconds, audio-driven
}

export async function runCapcutEditor(projectId: string): Promise<void> {
  emit(projectId, { type: 'log', message: '[11단계] CapCut 프로젝트 생성 중...' });

  const CAPCUT_ROOT = loadSettings().capcutRoot;
  const CAPCUT_ROOT_META = path.join(CAPCUT_ROOT, 'root_meta_info.json');

  const pDir = projectDir(projectId);

  // Reuse stable IDs so re-runs update the existing CapCut entry instead of adding duplicates
  const existingProject = loadProject(projectId);
  const photoSize = existingProject?.aspectRatio === '9:16'
    ? { width: 1080, height: 1920 }
    : { width: 1920, height: 1080 };
  const draftId = existingProject?.capcutDraftId ?? uuid();
  const timelineId = existingProject?.capcutTimelineId ?? uuid();
  const draftName = `VideoMaker_${projectId.replace(/[^\w가-힣]/g, '-').slice(0, 20)}`;
  const capcutDir = path.join(CAPCUT_ROOT, draftName);
  fs.mkdirSync(capcutDir, { recursive: true });

  const videosDir = path.join(pDir, 'videos');
  const audioDir = path.join(pDir, 'audio');
  const subsDir = path.join(pDir, 'subtitles');

  // Bundle media under Resources/ to match CapCut's expected folder structure
  const resourcesDir = path.join(capcutDir, 'Resources');
  const bundledVideosDir = path.join(resourcesDir, 'videos');
  const bundledAudioDir = path.join(resourcesDir, 'audio');
  const bundledSubsDir = path.join(resourcesDir, 'subtitles');
  fs.mkdirSync(bundledVideosDir, { recursive: true });
  fs.mkdirSync(bundledAudioDir, { recursive: true });
  fs.mkdirSync(bundledSubsDir, { recursive: true });

  const videoFiles = fs.existsSync(videosDir)
    ? fs.readdirSync(videosDir).filter((f) => f.endsWith('.mp4')).sort()
    : [];

  const sceneIds = new Set<string>();
  for (const f of videoFiles) {
    const m = f.match(/scene_(\d+)/);
    if (m) sceneIds.add(m[1]);
  }

  if (sceneIds.size === 0) {
    const msg = '영상 클립(.mp4)이 없어 CapCut 프로젝트를 생성할 수 없습니다. 이미지/영상 생성을 먼저 실행하세요.';
    emit(projectId, { type: 'log', message: `❌ ${msg}` });
    throw new Error(msg);
  }

  const scenes: SceneAsset[] = [];

  for (const id of [...sceneIds].sort()) {
    const audioSrc = path.join(audioDir, `scene_${id}.mp3`);
    const srtSrc = path.join(subsDir, `scene_${id}.srt`);

    // Bundle audio into capcut-project/audio/
    let audioFile: string | undefined;
    if (fs.existsSync(audioSrc)) {
      const audioDest = path.join(bundledAudioDir, `scene_${id}.mp3`);
      fs.copyFileSync(audioSrc, audioDest);
      audioFile = audioDest;
    }

    // Bundle subtitle into capcut-project/subtitles/
    let srtFile: string | undefined;
    if (fs.existsSync(srtSrc)) {
      const srtDest = path.join(bundledSubsDir, `scene_${id}.srt`);
      fs.copyFileSync(srtSrc, srtDest);
      srtFile = srtDest;
    }

    // Bundle sentence-level SRT (for deterministic slot timing)
    const sentenceSrtSrc = path.join(subsDir, `scene_${id}_sentences.srt`);
    let sentenceSrtFile: string | undefined;
    if (fs.existsSync(sentenceSrtSrc)) {
      const sentenceSrtDest = path.join(bundledSubsDir, `scene_${id}_sentences.srt`);
      fs.copyFileSync(sentenceSrtSrc, sentenceSrtDest);
      sentenceSrtFile = sentenceSrtDest;
    }

    const videoPattern = new RegExp(`^scene_${id}(?:-[A-Za-z])?\\.mp4$`);
    // Bundle videos into capcut-project/videos/
    const sceneVideoFiles = fs.existsSync(videosDir)
      ? fs.readdirSync(videosDir)
          .filter((f) => videoPattern.test(f))
          .sort()
          .map((f) => {
            const srcPath = path.join(videosDir, f);
            const destPath = path.join(bundledVideosDir, f);
            fs.copyFileSync(srcPath, destPath);
            return destPath;
          })
      : [];

    const audioDuration = audioFile ? getFileDuration(audioFile) : 0;
    const totalVideoDuration = sceneVideoFiles.reduce(
      (sum, f) => sum + (getFileDuration(f) || 5_000_000), 0
    );
    // Scene duration is audio-driven; fall back to video total if no audio
    const duration = audioDuration > 0 ? audioDuration : (totalVideoDuration || 5_000_000);

    scenes.push({ id, videoFiles: sceneVideoFiles, audioFile, srtFile, sentenceSrtFile, duration });
  }

  // ---- Precompute slot timings for all scenes in parallel ----
  const imagePromptsPath = path.join(pDir, 'image-prompts.md');
  const imagePromptsMd = fs.existsSync(imagePromptsPath)
    ? fs.readFileSync(imagePromptsPath, 'utf-8')
    : '';

  const sceneDesignPath = path.join(pDir, 'scene-design.md');
  const slotNarrations = fs.existsSync(sceneDesignPath)
    ? parseSlotNarrations(fs.readFileSync(sceneDesignPath, 'utf-8'))
    : new Map<string, string>();

  emit(projectId, { type: 'log', message: '🧠 나레이션-영상 싱크 매핑 계산 중...' });

  // Planned slots per scene: intersect image-prompts.md slots with actual video files
  const sceneSlotSets = scenes.map((s) => {
    const videoSlotIds = new Set(
      s.videoFiles.map(extractSlotId).filter((id): id is string => id !== null)
    );
    const slots = parseSlotDescriptions(imagePromptsMd, s.id, slotNarrations).filter((sl) =>
      videoSlotIds.has(sl.slotId)
    );
    return { slots, plannedIds: new Set(slots.map((sl) => sl.slotId)) };
  });

  const sceneTimingMaps = await Promise.all(
    scenes.map(async (s, si) => {
      const { slots } = sceneSlotSets[si];
      if (slots.length <= 1) return null;

      // Prefer sentence-level SRT for deterministic matching (no cross-slot spans)
      if (s.sentenceSrtFile) {
        const sentContent = fs.readFileSync(s.sentenceSrtFile, 'utf-8');
        const sentEntries = parseSrt(sentContent);
        if (sentEntries.length > 0) {
          const deterministic = computeSlotTimingsDeterministic(slots, sentEntries, s.duration);
          if (deterministic) return deterministic;
          // Deterministic failed → fall back to LLM with sentence-level SRT (cleaner input)
          emit(projectId, { type: 'log', message: `  ⚠️ 씬 ${s.id} 결정론적 매핑 실패 — LLM 매핑 시도` });
          return computeSlotTimings(slots, sentEntries, s.duration, projectId);
        }
      }

      // Legacy: word-level SRT with LLM
      if (!s.srtFile) return null;
      const srtContent = fs.readFileSync(s.srtFile, 'utf-8');
      const srtEntries = parseSrt(srtContent);
      if (srtEntries.length === 0) return null;
      return computeSlotTimings(slots, srtEntries, s.duration, projectId);
    })
  );

  // ---- Build track content ----
  const videoMaterials: object[] = [];
  const videoSegments: object[] = [];
  const audioMaterials: object[] = [];
  const audioSegments: object[] = [];
  const textMaterials: object[] = [];
  const textSegments: object[] = [];

  // Track render indices: video=0, text=1, audio=2
  const VIDEO_TRACK_IDX = 0;
  const TEXT_TRACK_IDX = 1;
  const AUDIO_TRACK_IDX = 2;

  let timelineOffset = 0;

  for (let si = 0; si < scenes.length; si++) {
    const s = scenes[si];
    const timingMap = sceneTimingMaps[si];
    const { plannedIds } = sceneSlotSets[si];
    const sceneStart = timelineOffset;

    // ---- Video segments ----
    // Only place planned clips; skip extra generated clips beyond planned slots
    const plannedVideoFiles =
      plannedIds.size > 0
        ? s.videoFiles.filter((f) => {
            const id = extractSlotId(f);
            return !id || plannedIds.has(id);
          })
        : s.videoFiles;
    const numPlanned = plannedVideoFiles.length;
    const uniformDur = numPlanned > 0 ? Math.floor(s.duration / numPlanned) : s.duration;
    let clipOffset = 0;
    let lastVideoFile = '';

    for (let i = 0; i < plannedVideoFiles.length; i++) {
      const videoFile = plannedVideoFiles[i];
      if (clipOffset >= s.duration) break;

      const rawDur = getFileDuration(videoFile) || 5_000_000;
      const available = s.duration - clipOffset;

      // Determine target duration for this slot
      const slotId = extractSlotId(videoFile);
      const slotTiming = slotId && timingMap ? timingMap.get(slotId) : null;
      const isLast = i === numPlanned - 1;

      let targetDur: number;
      if (slotTiming) {
        targetDur = slotTiming.end - slotTiming.start;
      } else {
        targetDur = isLast ? available : uniformDur;
      }
      targetDur = Math.max(targetDur, 1);

      const materialId = uuid();
      lastVideoFile = videoFile;
      videoMaterials.push(makeVideoMaterial(materialId, videoFile, rawDur));

      if (targetDur <= rawDur) {
        // Clip covers its slot entirely — play from beginning, trim to targetDur
        const clipDur = Math.min(targetDur, available);
        if (clipDur <= 0) break;
        videoSegments.push(makeVideoSegment(
          uuid(), materialId,
          sceneStart + clipOffset, clipDur,
          0, clipDur,
          VIDEO_TRACK_IDX
        ));
        clipOffset += clipDur;
      } else {
        // Slot is longer than clip — play clip then freeze frame
        const clipDur = Math.min(rawDur, available);
        if (clipDur <= 0) break;
        videoSegments.push(makeVideoSegment(
          uuid(), materialId,
          sceneStart + clipOffset, clipDur,
          0, clipDur,
          VIDEO_TRACK_IDX
        ));
        clipOffset += clipDur;

        const freezeDur = Math.min(targetDur - rawDur, s.duration - clipOffset);
        if (freezeDur > 0) {
          const freezeName = path.basename(videoFile, '.mp4') + '_freeze.jpg';
          const freezePath = path.join(resourcesDir, freezeName);
          if (extractLastFrame(videoFile, freezePath)) {
            const freezeId = uuid();
            videoMaterials.push(makeVideoMaterial(freezeId, freezePath, freezeDur, true, photoSize));
            videoSegments.push(makeVideoSegment(
              uuid(), freezeId,
              sceneStart + clipOffset, freezeDur,
              0, freezeDur,
              VIDEO_TRACK_IDX
            ));
            clipOffset += freezeDur;
          }
        }
      }
    }

    // Fill remaining gap with freeze frame if any
    if (clipOffset < s.duration && lastVideoFile) {
      const gap = s.duration - clipOffset;
      const freezeName = path.basename(lastVideoFile, '.mp4') + '_freeze.jpg';
      const freezePath = path.join(resourcesDir, freezeName);
      if (extractLastFrame(lastVideoFile, freezePath)) {
        const freezeId = uuid();
        videoMaterials.push(makeVideoMaterial(freezeId, freezePath, gap, true, photoSize));
        videoSegments.push(makeVideoSegment(
          uuid(), freezeId,
          sceneStart + clipOffset, gap,
          0, gap,
          VIDEO_TRACK_IDX
        ));
      }
    }

    timelineOffset += s.duration;

    // ---- Audio segment ----
    if (s.audioFile) {
      const audioDur = getFileDuration(s.audioFile);
      if (audioDur > 0) {
        const audioMaterialId = uuid();
        audioMaterials.push(makeAudioMaterial(audioMaterialId, s.audioFile, audioDur));
        audioSegments.push(makeAudioSegment(
          uuid(), audioMaterialId,
          sceneStart, audioDur,
          AUDIO_TRACK_IDX
        ));
      }
    }

    // ---- Text (subtitle) segments ----
    if (s.srtFile) {
      const entries = parseSrt(fs.readFileSync(s.srtFile, 'utf-8'));
      for (const entry of entries) {
        const textMaterialId = uuid();
        const dur = entry.end - entry.start;
        textMaterials.push(makeTextMaterial(textMaterialId, entry.text));
        textSegments.push(makeTextSegment(
          uuid(), textMaterialId,
          sceneStart + entry.start, dur,
          TEXT_TRACK_IDX
        ));
      }
    }
  }

  const totalDuration = timelineOffset;
  const nowUs = Date.now() * 1000;
  const nowSec = Math.floor(Date.now() / 1000);

  const tracks: object[] = [
    {
      id: uuid(), type: 'video', flag: 0, attribute: 0,
      name: '', is_default_name: true,
      segments: videoSegments,
    },
  ];
  if (textSegments.length > 0) {
    tracks.push({
      id: uuid(), type: 'text', flag: 1, attribute: 0,
      name: '', is_default_name: true,
      segments: textSegments,
    });
  }
  if (audioSegments.length > 0) {
    tracks.push({
      id: uuid(), type: 'audio', flag: 0, attribute: 0,
      name: '', is_default_name: true,
      segments: audioSegments,
    });
  }

  // Full timeline content (draft_info.json)
  // id must match timelineId so CapCut can resolve Timelines/{timelineId}/draft_info.json
  const timelineContent = {
    id: timelineId,
    version: 360000,
    new_version: '167.0.0',
    name: draftName,
    duration: totalDuration,
    create_time: nowSec,
    update_time: nowSec,
    fps: 30.0,
    is_drop_frame_timecode: false,
    color_space: -1,
    config: {
      video_mute: false,
      record_audio_last_index: 1,
      extract_audio_last_index: 1,
      original_sound_last_index: 1,
      subtitle_recognition_id: '',
      subtitle_taskinfo: [],
      lyrics_recognition_id: '',
      lyrics_taskinfo: [],
      subtitle_sync: true,
      lyrics_sync: true,
      voice_change_sync: false,
      sticker_max_index: 1,
      adjust_max_index: 1,
      material_save_mode: 0,
      export_range: null,
      maintrack_adsorb: true,
      combination_max_index: 1,
      attachment_info: [],
      zoom_info_params: null,
      system_font_list: [],
      multi_language_mode: 'none',
      multi_language_main: 'none',
      multi_language_current: 'none',
      multi_language_list: [],
      subtitle_keywords_config: null,
      use_float_render: false,
    },
    canvas_config: { ratio: 'original', width: photoSize.width, height: photoSize.height, background: null },
    tracks,
    group_container: null,
    materials: makeEmptyMaterials(videoMaterials, audioMaterials, textMaterials),
    keyframes: {
      videos: [], audios: [], texts: [], stickers: [],
      filters: [], adjusts: [], handwrites: [], effects: [],
    },
    keyframe_graph_list: [],
    platform: {
      os: 'mac',
      os_version: '15.7.3',
      app_id: 359289,
      app_version: '8.5.0',
      app_source: 'cc',
      device_id: 'dcc1089857e61cf134c7fa4d4c141402',
      hard_disk_id: '3e51f875d224354772abca5898e08446',
      mac_address: 'effe792c62cfad28084acd4722cc7c23',
    },
    last_modified_platform: {
      os: 'mac',
      os_version: '15.7.3',
      app_id: 359289,
      app_version: '8.5.0',
      app_source: 'cc',
      device_id: 'dcc1089857e61cf134c7fa4d4c141402',
      hard_disk_id: '3e51f875d224354772abca5898e08446',
      mac_address: 'effe792c62cfad28084acd4722cc7c23',
    },
    mutable_config: null,
    cover: null,
    retouch_cover: null,
    extra_info: null,
    relationships: [],
    render_index_track_mode_on: true,
    free_render_index_mode_on: false,
    static_cover_image_path: '',
    source: 'default',
    time_marks: null,
    path: '',
    lyrics_effects: [],
    uneven_animation_template_info: {
      composition: '', content: '', order: '', sub_template_info_list: [],
    },
    draft_type: 'video',
    smart_ads_info: { page_from: '', routine: '', draft_url: '' },
    function_assistant_info: {
      smart_rec_applied: false, fixed_rec_applied: false, auto_adjust: false,
      auto_adjust_segid_list: [], color_correction: false, color_correction_segid_list: [],
      enhance_quality: false, smooth_slow_motion: false, deflicker_segid_list: [],
      video_noise_segid_list: [], enhance_quality_segid_list: [], smart_segid_list: [],
      retouch: false, retouch_segid_list: [], enhande_voice: false,
      enhance_voice_segid_list: [], audio_noise_segid_list: [], auto_caption: false,
      auto_caption_segid_list: [], auto_caption_template_id: '', caption_opt: false,
      caption_opt_segid_list: [], eye_correction: false, eye_correction_segid_list: [],
      normalize_loudness: false, normalize_loudness_segid_list: [],
      normalize_loudness_audio_denoise_segid_list: [], auto_adjust_fixed: false,
      auto_adjust_fixed_value: 50.0, color_correction_fixed: false,
      color_correction_fixed_value: 50.0, normalize_loudness_fixed: false,
      enhande_voice_fixed: false, retouch_fixed: false, enhance_quality_fixed: false,
      smooth_slow_motion_fixed: false, fps: { num: 0, den: 1 },
    },
  };

  // CapCut project registry entry (draft_meta_info.json)
  const draftMeta = {
    cloud_draft_cover: false,
    cloud_draft_sync: false,
    cloud_package_completed_time: '',
    draft_cloud_capcut_purchase_info: '',
    draft_cloud_last_action_download: false,
    draft_cloud_package_type: '',
    draft_cloud_purchase_info: '',
    draft_cloud_template_id: '',
    draft_cloud_tutorial_info: '',
    draft_cloud_videocut_purchase_info: '',
    draft_cover: 'draft_cover.jpg',
    draft_deeplink_url: '',
    draft_enterprise_info: {
      draft_enterprise_extra: '',
      draft_enterprise_id: '',
      draft_enterprise_name: '',
      enterprise_material: [],
    },
    draft_fold_path: capcutDir,
    draft_id: draftId,
    draft_is_ae_produce: false,
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    draft_is_cloud_temp_draft: false,
    draft_is_from_deeplink: 'false',
    draft_is_invisible: false,
    draft_is_web_article_video: false,
    draft_materials: [
      { type: 0, value: [] },
      { type: 1, value: [] },
      { type: 2, value: [] },
      { type: 3, value: [] },
      { type: 6, value: [] },
      { type: 7, value: [] },
      { type: 8, value: [] },
    ],
    draft_materials_copied_info: [],
    draft_name: draftName,
    draft_need_rename_folder: false,
    draft_new_version: '',
    draft_removable_storage_device: '',
    draft_root_path: CAPCUT_ROOT,
    draft_segment_extra_info: [],
    draft_timeline_materials_size_: 0,
    draft_type: '',
    draft_web_article_video_enter_from: '',
    tm_draft_cloud_completed: '',
    tm_draft_cloud_entry_id: -1,
    tm_draft_cloud_modified: 0,
    tm_draft_cloud_parent_entry_id: -1,
    tm_draft_cloud_space_id: -1,
    tm_draft_cloud_user_id: -1,
    tm_draft_create: nowUs,
    tm_draft_modified: nowUs,
    tm_draft_removed: 0,
    tm_duration: totalDuration,
  };

  // Timelines/project.json
  const timelinesProject = {
    config: { color_space: -1, render_index_track_mode_on: false, use_float_render: false },
    create_time: nowUs,
    id: uuid(),
    main_timeline_id: timelineId,
    timelines: [{
      create_time: nowUs,
      id: timelineId,
      is_marked_delete: false,
      name: '타임라인 01',
      update_time: nowUs,
    }],
    update_time: nowUs,
    version: 0,
  };

  // Write all project files
  fs.writeFileSync(
    path.join(capcutDir, 'draft_info.json'),
    JSON.stringify(timelineContent, null, 2)
  );
  fs.writeFileSync(
    path.join(capcutDir, 'draft_meta_info.json'),
    JSON.stringify(draftMeta, null, 2)
  );

  const timelinesDir = path.join(capcutDir, 'Timelines');
  fs.mkdirSync(timelinesDir, { recursive: true });
  fs.writeFileSync(
    path.join(timelinesDir, 'project.json'),
    JSON.stringify(timelinesProject, null, 2)
  );

  const timelineSubDir = path.join(timelinesDir, timelineId);
  fs.mkdirSync(timelineSubDir, { recursive: true });
  fs.writeFileSync(
    path.join(timelineSubDir, 'draft_info.json'),
    JSON.stringify(timelineContent, null, 2)
  );

  // ---- Boilerplate files matching CapCut's expected project structure ----

  const ATTACHMENT_EDITING = JSON.stringify({ editing_draft: { ai_remove_filter_words: { enter_source: '', right_id: '' }, ai_shorts_info: { report_params: '', type: 0 }, cover_extra_info: { draft_id: '', position: 0, select_segment_id: '', select_segment_source_start: 0, select_segment_target_start: 0, type: 1 }, crop_info_extra: { crop_mirror_type: 0, crop_rotate: 0.0, crop_rotate_total: 0.0 }, digital_human_template_to_video_info: { has_upload_material: false, template_type: 0 }, draft_used_recommend_function: '', edit_type: 0, eye_correct_enabled_multi_face_time: 0, has_adjusted_render_layer: false, image_ai_chat_info: { before_chat_edit: false, draft_modify_time: 0, keyword_content: '', keyword_type: '', message_id: '', model_name: '', need_restore: false, picture_id: '', prompt_content: '', prompt_from: '', sugs_info: [] }, is_open_expand_player: false, is_template_text_ai_generate: false, is_use_adjust: false, is_use_ai_expand: false, is_use_ai_remove: false, is_use_ai_video: false, is_use_audio_separation: false, is_use_chroma_key: false, is_use_curve_speed: false, is_use_digital_human: false, is_use_edit_multi_camera: false, is_use_lip_sync: false, is_use_lock_object: false, is_use_loudness_unify: false, is_use_noise_reduction: false, is_use_one_click_beauty: false, is_use_one_click_ultra_hd: false, is_use_retouch_face: false, is_use_smart_adjust_color: false, is_use_smart_body_beautify: false, is_use_smart_motion: false, is_use_subtitle_recognition: false, is_use_text_to_audio: false, material_edit_session: { material_edit_info: [], session_id: '', session_time: 0 }, paste_segment_list: [], profile_entrance_type: '', publish_enter_from: '', publish_type: '', single_function_type: 0, text_convert_case_types: [], version: '1.0.0', video_recording_create_draft: '' } });

  const ATTACHMENT_PC_COMMON = JSON.stringify({ ai_packaging_infos: [], ai_packaging_report_info: { caption_id_list: [], commercial_material: '', material_source: '', method: '', page_from: '', style: '', task_id: '', text_style: '', tos_id: '', video_category: '' }, broll: { ai_packaging_infos: [], ai_packaging_report_info: { caption_id_list: [], commercial_material: '', material_source: '', method: '', page_from: '', style: '', task_id: '', text_style: '', tos_id: '', video_category: '' } }, commercial_music_category_ids: [], pc_feature_flag: 0, recognize_tasks: [], reference_lines_config: { horizontal_lines: [], is_lock: false, is_visible: false, vertical_lines: [] }, safe_area_type: 0, template_item_infos: [], unlock_template_ids: [] });

  const commonAttachmentFiles: Record<string, string> = {
    'attachment_action_scene.json': JSON.stringify({ action_scene: { removed_segments: [], segment_infos: [] } }),
    'attachment_gen_ai_info.json': JSON.stringify({ gen_ai: { ai_func_config: { ai_common_configs: [], ai_effect_configs: [], ai_func_list: [], aigc_generation_configs: [] }, cc_agent_info: { agent_stringent_section_id_list: [], agent_stringent_used_tool_list: [], is_agent_stringent_used: false, is_agent_used: false, tool_list: [] }, id: '', scene: '', version: '1.0.0' } }),
    'attachment_pc_timeline.json': JSON.stringify({ reference_lines_config: { horizontal_lines: [], is_lock: false, is_visible: false, vertical_lines: [] }, safe_area_type: 0 }),
    'attachment_plugin_draft.json': JSON.stringify({ plugin_draft: { plugin_segments: [], version: '1.0.0' } }),
    'attachment_script_video.json': JSON.stringify({ script_video: { attachment_valid: false, language: '', overdub_recover: [], overdub_sentence_ids: [], parts: [], sync_subtitle: false, translate_segments: [], translate_type: '', version: '1.0.0' } }),
  };

  // Root-level boilerplate files
  fs.writeFileSync(path.join(capcutDir, 'draft_agency_config.json'), JSON.stringify({ is_auto_agency_enabled: false, is_auto_agency_popup: false, is_single_agency_mode: false, marterials: null, use_converter: false, video_resolution: 720 }));
  fs.writeFileSync(path.join(capcutDir, 'draft_biz_config.json'), '');
  fs.writeFileSync(path.join(capcutDir, 'draft_virtual_store.json'), JSON.stringify({ draft_materials: [], draft_virtual_store: [] }));
  fs.writeFileSync(path.join(capcutDir, 'key_value.json'), JSON.stringify({}));
  fs.writeFileSync(path.join(capcutDir, 'timeline_layout.json'), JSON.stringify({ dockItems: [{ dockIndex: 0, ratio: 1, timelineIds: [timelineId], timelineNames: ['타임라인 01'] }], layoutOrientation: 1 }));
  fs.writeFileSync(path.join(capcutDir, 'performance_opt_info.json'), JSON.stringify({ manual_cancle_precombine_segs: null, need_auto_precombine_segs: null }));
  fs.writeFileSync(path.join(capcutDir, 'attachment_editing.json'), ATTACHMENT_EDITING);
  fs.writeFileSync(path.join(capcutDir, 'attachment_pc_common.json'), ATTACHMENT_PC_COMMON);

  // Root-level common_attachment/
  const rootCommonAttachDir = path.join(capcutDir, 'common_attachment');
  fs.mkdirSync(rootCommonAttachDir, { recursive: true });
  for (const [name, content] of Object.entries(commonAttachmentFiles)) {
    fs.writeFileSync(path.join(rootCommonAttachDir, name), content);
  }

  // Timeline-level boilerplate files
  fs.writeFileSync(path.join(timelineSubDir, 'attachment_editing.json'), ATTACHMENT_EDITING);
  fs.writeFileSync(path.join(timelineSubDir, 'attachment_pc_common.json'), ATTACHMENT_PC_COMMON);

  // Timeline-level common_attachment/
  const timelineCommonAttachDir = path.join(timelineSubDir, 'common_attachment');
  fs.mkdirSync(timelineCommonAttachDir, { recursive: true });
  for (const [name, content] of Object.entries(commonAttachmentFiles)) {
    fs.writeFileSync(path.join(timelineCommonAttachDir, name), content);
  }

  // Empty directories CapCut expects
  for (const emptyDir of ['adjust_mask', 'smart_crop', 'matting', 'qr_upload', 'subdraft', 'draft_settings']) {
    fs.mkdirSync(path.join(capcutDir, emptyDir), { recursive: true });
  }

  // Register in CapCut's root_meta_info.json
  let rootMeta: { all_draft_store: unknown[]; draft_ids: number; root_path: string } = {
    all_draft_store: [],
    draft_ids: 1,
    root_path: CAPCUT_ROOT,
  };
  if (fs.existsSync(CAPCUT_ROOT_META)) {
    try {
      rootMeta = JSON.parse(fs.readFileSync(CAPCUT_ROOT_META, 'utf-8'));
    } catch {
      // keep default if parse fails
    }
  }

  const entries = rootMeta.all_draft_store as Record<string, unknown>[];
  const existingIdx = entries.findIndex((e) => e.draft_id === draftId);
  const registryEntry: Record<string, unknown> = {
    draft_cloud_capcut_purchase_info: '',
    draft_cloud_last_action_download: false,
    draft_cloud_package_type: '',
    draft_cloud_purchase_info: '',
    draft_cloud_template_id: '',
    draft_cloud_tutorial_info: '',
    draft_cloud_videocut_purchase_info: '',
    draft_cover: 'draft_cover.jpg',
    draft_fold_path: capcutDir,
    draft_id: draftId,
    draft_is_ai_shorts: false,
    draft_is_invisible: false,
    draft_json_file: path.join(capcutDir, 'draft_info.json'),
    draft_name: draftName,
    draft_new_version: '',
    draft_removable_storage_device: '',
    draft_root_path: CAPCUT_ROOT,
    draft_timeline_materials_size: 0,
    draft_type: '',
    streaming_edit_draft_ready: false,
    tm_draft_cloud_completed: '',
    tm_draft_cloud_entry_id: -1,
    tm_draft_cloud_modified: 0,
    tm_draft_cloud_parent_entry_id: -1,
    tm_draft_cloud_space_id: -1,
    tm_draft_cloud_user_id: -1,
    tm_draft_create: nowUs,
    tm_draft_modified: nowUs,
    tm_draft_removed: 0,
    tm_duration: totalDuration,
  };

  if (existingIdx >= 0) {
    entries[existingIdx] = registryEntry;
  } else {
    entries.unshift(registryEntry);
    rootMeta.draft_ids = (rootMeta.draft_ids as number) + 1;
  }

  fs.writeFileSync(CAPCUT_ROOT_META, JSON.stringify(rootMeta, null, 2));

  // Save CapCut project path and stable IDs so re-runs reuse the same entry
  const project = loadProject(projectId);
  if (project) {
    saveProject({ ...project, capcutPath: capcutDir, capcutDraftId: draftId, capcutTimelineId: timelineId });
  }

  emit(projectId, {
    type: 'log',
    message: `✅ CapCut 프로젝트 생성 완료 (총 ${(totalDuration / 1_000_000).toFixed(1)}초) — CapCut을 재시작하면 목록에 자동 등록됩니다`,
  });
}
