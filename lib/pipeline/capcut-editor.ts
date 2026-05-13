import { emit } from '../events';
import { projectDir } from '../project';
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

function makeTextContent(text: string): string {
  return JSON.stringify({
    styles: [{
      fill: { content: { solid: { color: [1, 1, 1] }, render_type: 'solid' } },
      range: [0, text.length],
      size: 5,
      font: {
        path: '/Applications/CapCut.app/Contents/Resources/Font/SystemFont/en.ttf',
        id: '',
      },
    }],
    text,
  });
}

function makeVideoMaterial(id: string, filePath: string, duration: number, isPhoto = false): object {
  const size = isPhoto ? { width: 1920, height: 1080 } : getVideoSize(filePath);
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
    font_size: 5.0,
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
    text_size: 30,
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
    line_max_width: 0.82,
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
      transform: { x: 0.0, y: -0.8 },
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
  duration: number;  // microseconds, audio-driven
}

export async function runCapcutEditor(projectId: string): Promise<void> {
  emit(projectId, { type: 'log', message: '[11단계] CapCut 프로젝트 생성 중...' });

  const pDir = projectDir(projectId);
  const capcutDir = path.join(pDir, 'capcut-project');
  if (!fs.existsSync(capcutDir)) fs.mkdirSync(capcutDir, { recursive: true });

  const videosDir = path.join(pDir, 'videos');
  const audioDir = path.join(pDir, 'audio');
  const subsDir = path.join(pDir, 'subtitles');

  const videoFiles = fs.existsSync(videosDir)
    ? fs.readdirSync(videosDir).filter((f) => f.endsWith('.mp4')).sort()
    : [];

  const sceneIds = new Set<string>();
  for (const f of videoFiles) {
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

    const audioFile = fs.existsSync(audioSrc) ? audioSrc : undefined;
    const srtFile = fs.existsSync(srtSrc) ? srtSrc : undefined;

    const videoPattern = new RegExp(`^scene_${id}(?:-[A-Za-z])?\\.mp4$`);
    const sceneVideoFiles = fs.existsSync(videosDir)
      ? fs.readdirSync(videosDir)
          .filter((f) => videoPattern.test(f))
          .sort()
          .map((f) => path.join(videosDir, f))
      : [];

    const audioDuration = audioFile ? getFileDuration(audioFile) : 0;
    const totalVideoDuration = sceneVideoFiles.reduce(
      (sum, f) => sum + (getFileDuration(f) || 5_000_000), 0
    );
    // Scene duration is audio-driven; fall back to video total if no audio
    const duration = audioDuration > 0 ? audioDuration : (totalVideoDuration || 5_000_000);

    scenes.push({ id, videoFiles: sceneVideoFiles, audioFile, srtFile, duration });
  }

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

  for (const s of scenes) {
    const sceneStart = timelineOffset;

    // ---- Video segments (trimmed to scene duration = audio duration) ----
    let clipOffset = 0;
    let lastVideoFile = '';

    for (const videoFile of s.videoFiles) {
      if (clipOffset >= s.duration) break;
      const rawDur = getFileDuration(videoFile) || 5_000_000;
      const available = s.duration - clipOffset;
      const clipDur = Math.min(rawDur, available);
      if (clipDur <= 0) break;

      const materialId = uuid();
      lastVideoFile = videoFile;
      videoMaterials.push(makeVideoMaterial(materialId, videoFile, rawDur));
      videoSegments.push(makeVideoSegment(
        uuid(), materialId,
        sceneStart + clipOffset, clipDur,
        0, clipDur,
        VIDEO_TRACK_IDX
      ));
      clipOffset += clipDur;
    }

    // Fill gap with freeze frame if video shorter than audio
    if (clipOffset < s.duration && lastVideoFile) {
      const gap = s.duration - clipOffset;
      const freezeName = path.basename(lastVideoFile, '.mp4') + '_freeze.jpg';
      const freezePath = path.join(capcutDir, freezeName);
      if (extractLastFrame(lastVideoFile, freezePath)) {
        const freezeId = uuid();
        videoMaterials.push(makeVideoMaterial(freezeId, freezePath, gap, true));
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
  const draftId = uuid();
  const timelineId = uuid();
  const draftName = `VideoMaker_${projectId.slice(0, 8)}`;

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

  // Full timeline content (draft_content.json format)
  const timelineContent = {
    id: draftId,
    version: 360000,
    new_version: '167.0.0',
    name: draftName,
    duration: totalDuration,
    create_time: nowSec,
    update_time: nowSec,
    fps: 30.0,
    is_drop_frame_timecode: false,
    color_space: 0,
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
    canvas_config: { ratio: 'original', width: 1920, height: 1080, background: null },
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
    extra_info: '',
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

  // Minimal project info (draft_info.json)
  const draftInfo = {
    id: draftId,
    name: draftName,
    draft_type: 'video',
    fps: 30.0,
    canvas_config: { ratio: 'original', width: 1920, height: 1080, background: null },
    create_time: nowSec,
    update_time: nowSec,
    duration: totalDuration,
    path: capcutDir,
  };

  // CapCut project registry entry (draft_meta_info.json)
  const draftMeta = {
    cloud_draft_cover: false,
    cloud_draft_sync: false,
    draft_cloud_last_action_download: false,
    draft_cloud_purchase_info: '',
    draft_cloud_template_id: '',
    draft_cloud_tutorial_info: '',
    draft_cloud_videocut_purchase_info: '',
    draft_cover: '',
    draft_fold_path: capcutDir,
    draft_id: draftId,
    draft_is_ai_shorts: false,
    draft_is_cloud_temp_draft: false,
    draft_is_invisible: false,
    draft_is_web_article_video: false,
    draft_json_file: path.join(capcutDir, 'draft_content.json'),
    draft_name: draftName,
    draft_new_version: '',
    draft_root_path: '/Users/hongss/Movies/CapCut/User Data/Projects/com.lveditor.draft',
    draft_timeline_materials_size: 0,
    draft_type: '',
    draft_web_article_video_enter_from: '',
    streaming_edit_draft_ready: true,
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
    path.join(capcutDir, 'draft_content.json'),
    JSON.stringify(timelineContent, null, 2)
  );
  fs.writeFileSync(
    path.join(capcutDir, 'draft_info.json'),
    JSON.stringify(draftInfo, null, 2)
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

  // Register in CapCut's root_meta_info.json
  const rootMetaPath = '/Users/hongss/Movies/CapCut/User Data/Projects/com.lveditor.draft/root_meta_info.json';
  if (fs.existsSync(rootMetaPath)) {
    try {
      const rootMeta = JSON.parse(fs.readFileSync(rootMetaPath, 'utf-8'));
      const store: object[] = Array.isArray(rootMeta.all_draft_store)
        ? rootMeta.all_draft_store
        : [];

      // Remove any previous entry for this project (same fold_path or id)
      const filtered = store.filter((e: unknown) => {
        const entry = e as Record<string, unknown>;
        return entry.draft_fold_path !== capcutDir && entry.draft_id !== draftId;
      });

      const newEntry = {
        cloud_draft_cover: false,
        cloud_draft_sync: false,
        draft_cloud_last_action_download: false,
        draft_cloud_purchase_info: '',
        draft_cloud_template_id: '',
        draft_cloud_tutorial_info: '',
        draft_cloud_videocut_purchase_info: '',
        draft_cover: '',
        draft_fold_path: capcutDir,
        draft_id: draftId,
        draft_is_ai_shorts: false,
        draft_is_cloud_temp_draft: false,
        draft_is_invisible: false,
        draft_is_web_article_video: false,
        draft_json_file: path.join(capcutDir, 'draft_content.json'),
        draft_name: draftName,
        draft_new_version: '',
        draft_root_path: '/Users/hongss/Movies/CapCut/User Data/Projects/com.lveditor.draft',
        draft_timeline_materials_size: 0,
        draft_type: '',
        draft_web_article_video_enter_from: '',
        streaming_edit_draft_ready: true,
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

      filtered.push(newEntry);
      rootMeta.all_draft_store = filtered;
      rootMeta.draft_ids = typeof rootMeta.draft_ids === 'number'
        ? rootMeta.draft_ids + 1
        : filtered.length;

      fs.writeFileSync(rootMetaPath, JSON.stringify(rootMeta, null, 2));
      emit(projectId, { type: 'log', message: '✅ root_meta_info.json 등록 완료' });
    } catch (e) {
      emit(projectId, { type: 'log', message: `⚠️ root_meta_info.json 업데이트 실패: ${e}` });
    }
  }

  emit(projectId, {
    type: 'log',
    message: `✅ CapCut 프로젝트 생성 완료 → capcut-project/ (총 ${(totalDuration / 1_000_000).toFixed(1)}초)`,
  });
}
