import fs from 'fs';
import path from 'path';
import { emit } from '../events';
import { writeFile, projectFile } from '../project';
import { runClaude, MODEL } from './claude-runner';
import { extractTargetSeconds } from './utils';

const SYSTEM = `당신은 유튜브 영상 씬 설계 전문가입니다.
대본(script-final.md)과 기획서(brief.md)를 바탕으로 각 씬의 시각적 연출 방향을 상세히 설계합니다.

각 씬마다 다음 항목을 반드시 포함하세요:
- 씬 번호, 제목, 길이
- 비주얼 컨셉 (구체적인 이미지 연출 방향)
- 이미지 프롬프트 힌트 (영문, FAL Flux용)
- 카메라/편집 스타일
- 자막 텍스트 (해당 슬롯의 나레이션 원문 — 아래 규칙 참조)
- 사운드 방향

출력 형식 (scene-design.md):
\`\`\`
# 씬 설계서: {토픽}

## 전체 비주얼 컨셉
{채널 전체 무드, 컬러 팔레트, 편집 스타일}

---

## SCENE 01: {씬 제목}

**길이**: {예상 초}초
**나레이션 요약**: {핵심 내용 1-2줄}

### 이미지 슬롯 01-A ({시작초}~{종료초}초)

#### 비주얼
- 구도: {예: 클로즈업, 와이드샷 등}
- 소재: {예: 흑백 사진, 아카이브 영상 느낌, 드라마틱 조명}
- 분위기: {예: 긴장감, 슬픔, 웅장함}

#### 이미지 프롬프트
**영문**: {Flux Dev용 영문 프롬프트, 구체적이고 시각적으로}
**한글**: {위 프롬프트의 한글 번역}

#### 편집
- 전환: {예: 페이드인, 컷, 줌}
- 자막: "{해당 슬롯이 커버하는 대본 나레이션 원문을 그대로 복사. 요약·paraphrase 절대 금지}"

#### 사운드
- BGM: {예: 긴장감 있는 오케스트라, 피아노 단음}
- 효과음: {있다면}

### 이미지 슬롯 01-B ({시작초}~{종료초}초)

(동일한 구조로 반복...)

---

## SCENE 02: {씬 제목}

(동일한 구조로 반복...)
\`\`\`

⚠️ 슬롯 헤더 형식 규칙 (반드시 준수):
- 슬롯 헤더는 반드시 \`### 이미지 슬롯 NN-X (시작~종료초)\` 형식으로 작성
  - NN은 씬 번호 2자리 (01, 02, ...)
  - X는 해당 씬 내 순서 알파벳 (A, B, C, ...)
  - 예: \`### 이미지 슬롯 01-A (0~5초)\`, \`### 이미지 슬롯 02-B (18~23초)\`
- 슬롯 내부 소제목은 \`####\` (4단계 헤더) 사용
- 이 형식 외의 변형(예: [SCENE 01-A], 슬롯 1-A 등) 절대 사용 금지

규칙:
- 모든 씬 빠짐없이 설계
- 이미지 프롬프트는 영문과 한글 모두 작성
- 역사적/사실적 씬은 다큐멘터리 스타일 명시
- 한국어로 작성 (프롬프트만 영문)
- **클립 수 제한**: Kling 영상 API 최소 클립 길이 = 5초. 각 씬의 이미지 슬롯 수 = ceil(해당 씬 TTS 오디오 초 / 5). 아래 "TTS 실측 오디오 길이" 섹션에 씬별 계산값이 있으면 그 값을 반드시 사용할 것. 해당 섹션이 없으면 목표 시간 기준 floor(목표초 / 5)를 총 슬롯 수 상한으로 사용
- **자막 원칙**: 프롬프트 하단에 "TTS 문장 목록"이 있으면 그 문장을 우선 사용:
  1. 해당 씬의 TTS 문장을 슬롯 수만큼 균등 배분 (앞 슬롯부터 채움)
  2. 각 슬롯의 "자막:" 필드에 배정된 문장을 원문 그대로 공백으로 이어 붙임 — 절대 요약·수정 금지
  3. 슬롯 수 > 문장 수이면 남는 슬롯의 자막은 빈 문자열("")
  TTS 문장 목록이 없으면 script-final.md 나레이션을 슬롯 수만큼 균등 분할하여 원문 그대로 입력.`;


function parseSrtEndSeconds(content: string): number {
  const matches = [...content.matchAll(/\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/g)];
  if (matches.length === 0) return 0;
  const last = matches[matches.length - 1];
  return parseInt(last[1]) * 3600 + parseInt(last[2]) * 60 + parseInt(last[3]) + parseInt(last[4]) / 1000;
}

function readSceneAudioDurations(projectId: string): string {
  const subtitlesDir = projectFile(projectId, 'subtitles');
  if (!fs.existsSync(subtitlesDir)) return '';

  const files = fs.readdirSync(subtitlesDir)
    .filter(f => /^scene_\d+\.srt$/.test(f))
    .sort();

  if (files.length === 0) return '';

  const lines: string[] = ['## TTS 실측 오디오 길이 (씬별 슬롯 수 계산 시 반드시 사용)', '각 씬의 이미지 슬롯 수 = ceil(TTS 오디오 길이 / 5)'];
  for (const file of files) {
    const m = file.match(/^scene_(\d+)\.srt$/);
    if (!m) continue;
    const sceneNum = m[1];
    const content = fs.readFileSync(path.join(subtitlesDir, file), 'utf-8');
    const duration = parseSrtEndSeconds(content);
    const slots = Math.ceil(duration / 5);
    lines.push(`씬 ${sceneNum}: ${duration.toFixed(2)}초 → 슬롯 ${slots}개 필요`);
  }

  return lines.join('\n');
}

function readSrtSentences(projectId: string): string {
  const subtitlesDir = projectFile(projectId, 'subtitles');
  if (!fs.existsSync(subtitlesDir)) return '';

  const files = fs.readdirSync(subtitlesDir)
    .filter(f => /^scene_\d+_sentences\.srt$/.test(f))
    .sort();

  if (files.length === 0) return '';

  const lines: string[] = ['## TTS 문장 목록 (자막 필드에 원문 그대로 사용할 것)'];
  for (const file of files) {
    const m = file.match(/^scene_(\d+)_sentences\.srt$/);
    if (!m) continue;
    const sceneNum = m[1];
    const content = fs.readFileSync(path.join(subtitlesDir, file), 'utf-8');
    const sentences = content
      .split(/\n\n+/)
      .map(block => block.trim().split('\n').slice(2).join(' ').trim())
      .filter(s => s.length > 0);
    lines.push(`\n씬 ${sceneNum}:`);
    sentences.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  }

  return lines.join('\n');
}

export async function runSceneDesigner(
  projectId: string,
  topic: string,
  scriptMd: string,
  briefMd: string,
  loraTriggerWord?: string,
): Promise<string> {
  emit(projectId, { type: 'log', message: '[7단계] 씬 설계 중...' });

  const targetSecs = extractTargetSeconds(topic);
  const maxClips = targetSecs ? Math.floor(targetSecs / 5) : null;
  const durationConstraint = maxClips
    ? `\n⚠️ 목표 길이 ${targetSecs}초 → 최대 ${maxClips}개 이미지 슬롯(A/B컷 합산). 이를 초과하면 안 됩니다.`
    : '';

  const srtSentences = readSrtSentences(projectId);
  const srtSection = srtSentences ? `\n\n${srtSentences}` : '';

  const audioDurations = readSceneAudioDurations(projectId);
  const audioSection = audioDurations ? `\n\n${audioDurations}` : '';

  const loraNote = loraTriggerWord?.trim()
    ? `\n\n⚠️ LoRA 스타일 적용: 이 영상은 "${loraTriggerWord.trim()}" LoRA 스타일로 이미지를 생성합니다. 씬 설계 시 포토리얼리스틱/다큐멘터리 스타일 대신 "${loraTriggerWord.trim()}"에 맞는 시각 언어로 비주얼 컨셉과 이미지 프롬프트 힌트를 작성하세요. 전체 비주얼 컨셉의 스타일 방향도 이 LoRA 스타일을 기준으로 정의하세요.`
    : '';

  const prompt = `${SYSTEM}

---

토픽: "${topic}"${durationConstraint}${loraNote}

## 대본 (script-final.md)
${scriptMd}

## 기획서 (brief.md)
${briefMd}${audioSection}${srtSection}

아래 형식에 따라 scene-design.md의 마크다운 내용만 출력하세요. 파일 저장이나 도구 사용 없이 텍스트만 출력합니다.`;

  const content = await runClaude(prompt, { model: MODEL.SONNET, projectId });

  if (!content) {
    throw new Error('씬 설계자가 scene-design.md 내용을 생성하지 못했습니다.');
  }

  writeFile(projectId, 'scene-design.md', content);
  emit(projectId, { type: 'log', message: '✅ scene-design.md 저장 완료' });

  return content;
}
