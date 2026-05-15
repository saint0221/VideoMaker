import { emit } from '../events';
import { writeFile } from '../project';
import { runClaude } from './claude-runner';
import { extractTargetSeconds } from './utils';

const SYSTEM = `당신은 AI 이미지 생성 프롬프트 전문가입니다.
씬 설계서(scene-design.md)의 각 씬 이미지 프롬프트를 FAL Flux Dev API에 최적화된 형태로 정제합니다.

각 씬마다:
1. 씬 번호 추출 (01, 02, 03...)
2. 영문 프롬프트 최적화: 구체적 시각 요소, 스타일, 조명, 분위기를 포함한 150단어 내외
3. 한글 번역 제공
4. 네거티브 프롬프트 추가
5. 씬에 특정 텍스트가 표시되어야 하면 **텍스트 합성** 블록 추가 (아래 규칙 참조)

⚠️ CRITICAL — AI 이미지 모델의 한국어 텍스트 렌더링 불가:
FAL Flux Dev(및 모든 AI 이미지 생성 모델)는 한국어, 중국어, 일본어 등 비라틴 문자를 정확하게 렌더링하지 못합니다.
프롬프트에 한국어 문자열을 넣으면 완전히 다른 글자나 의미 없는 기호로 출력됩니다.
씬 설계서에 특정 한국어 텍스트가 명시되어 있으면 반드시 아래 **텍스트 합성** 블록을 사용하고,
프롬프트 자체에는 해당 텍스트를 절대 넣지 마세요. 대신 배경 비주얼만 묘사하세요.

📌 텍스트 합성 블록 사용 규칙:
- 씬 설계서에 화면에 표시할 특정 텍스트(한국어 포함)가 있으면 반드시 사용
- 순수 타이포그래피 씬(텍스트가 주인공인 씬)은 배경만 프롬프트로 생성하고 텍스트는 합성으로 처리
- 텍스트 없는 순수 비주얼 씬은 블록 생략 가능

📌 텍스트 합성 블록 형식 (각 필드는 선택):
\`\`\`
**텍스트 합성**:
내용: "화면에 표시할 텍스트"
크기: 120px
위치: x=0.5, y=0.5
색상: #FFFFFF
테두리: #000000 4px
폰트: sans-serif
\`\`\`
- 내용: 따옴표 필수. 실제로 이미지에 렌더링될 텍스트 (한국어 가능)
- 크기: 기본 60px. 화면 크기(1920×1080)에 맞게 조정
- 위치: x/y 각각 0~1 비율 (0.5=중앙). 기본 x=0.5, y=0.85
- 색상: 기본 #FFFFFF (텍스트 색)
- 테두리: "색상 두께px" 형식. 기본 #000000 2px
- 폰트: 기본 sans-serif (한국어 폰트 자동 적용됨)

출력 형식 (image-prompts.md):
\`\`\`
# 이미지 생성 프롬프트: {토픽}

## SCENE 01
**프롬프트 (영문)**:
{최적화된 영문 프롬프트}

**프롬프트 (한글)**:
{위의 한글 번역}

**네거티브**:
blurry, low quality, watermark, text, nsfw, cartoon, anime

---

## SCENE 02-A
...

## SCENE 02-B (텍스트 합성 예시 — 순수 타이포그래피 씬)
**프롬프트 (영문)**:
Pure deep black background, absolute darkness, cinematic negative space, 4K

**프롬프트 (한글)**:
순수 검정 배경, 절대적 어둠, 시네마틱 네거티브 스페이스, 4K

**네거티브**:
blurry, low quality, watermark, text, nsfw, bright background, any elements

**텍스트 합성**:
내용: "5분 → 새벽 3시"
크기: 140px
위치: x=0.5, y=0.5
색상: #FFFFFF
테두리: #000000 4px

---
\`\`\`

규칙:
- 모든 씬 빠짐없이 포함
- 한 씬에 이미지가 여러 장이면 반드시 -A, -B, -C 순서로 구분 (예: SCENE 02-A, SCENE 02-B). "CUT 1" 형식 절대 사용 금지
- 이미지가 1장인 씬은 그냥 SCENE 01 (알파벳 붙이지 않음)
- **클립 수 제한**: 총 이미지 슬롯 수(A/B 포함) ≤ floor(목표초 / 5). 씬 설계서에 이미 슬롯이 제한돼 있으면 그대로 따를 것
- 프롬프트는 사진 리얼리즘 스타일 기준 (documentary style, cinematic, photorealistic)
- 역사 장면은 "historical", "period accurate", "dramatic lighting" 포함
- 인물이 등장하면 ethnicity/nationality 명시 (Korean, Japanese 등)
- 한국어로 작성 (프롬프트 자체는 영문)
- 프롬프트에 한국어 문자열 절대 포함 금지 — 텍스트가 필요하면 **텍스트 합성** 블록 사용`;


export async function runImagePrompter(
  projectId: string,
  topic: string,
  sceneDesignMd: string
): Promise<string> {
  emit(projectId, { type: 'log', message: '[8단계] 이미지 프롬프트 생성 중...' });

  const targetSecs = extractTargetSeconds(topic);
  const maxClips = targetSecs ? Math.floor(targetSecs / 5) : null;
  const durationConstraint = maxClips
    ? `\n⚠️ 목표 길이 ${targetSecs}초 → 총 이미지 슬롯(A/B 합산) 최대 ${maxClips}개. 이를 초과하지 말 것.`
    : '';

  const prompt = `${SYSTEM}

---

토픽: "${topic}"${durationConstraint}

## 씬 설계서 (scene-design.md)
${sceneDesignMd}

아래 형식에 따라 image-prompts.md의 마크다운 내용만 출력하세요. 파일 저장이나 도구 사용 없이 텍스트만 출력합니다.`;

  const content = await runClaude(prompt);

  if (!content) {
    throw new Error('이미지 프롬프터가 image-prompts.md 내용을 생성하지 못했습니다.');
  }

  writeFile(projectId, 'image-prompts.md', content);
  emit(projectId, { type: 'log', message: '✅ image-prompts.md 저장 완료' });

  return content;
}
