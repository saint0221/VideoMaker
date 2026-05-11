import { emit } from '../events';
import { writeFile } from '../project';
import { runClaude } from './claude-runner';

const SYSTEM = `당신은 AI 이미지 생성 프롬프트 전문가입니다.
씬 설계서(scene-design.md)의 각 씬 이미지 프롬프트를 FAL Flux Dev API에 최적화된 형태로 정제합니다.

각 씬마다:
1. 씬 번호 추출 (01, 02, 03...)
2. 영문 프롬프트 최적화: 구체적 시각 요소, 스타일, 조명, 분위기를 포함한 150단어 내외
3. 한글 번역 제공
4. 네거티브 프롬프트 추가

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

## SCENE 02-B
...
\`\`\`

규칙:
- 모든 씬 빠짐없이 포함
- 한 씬에 이미지가 여러 장이면 반드시 -A, -B, -C 순서로 구분 (예: SCENE 02-A, SCENE 02-B). "CUT 1" 형식 절대 사용 금지
- 이미지가 1장인 씬은 그냥 SCENE 01 (알파벳 붙이지 않음)
- 프롬프트는 사진 리얼리즘 스타일 기준 (documentary style, cinematic, photorealistic)
- 역사 장면은 "historical", "period accurate", "dramatic lighting" 포함
- 인물이 등장하면 ethnicity/nationality 명시 (Korean, Japanese 등)
- 한국어로 작성 (프롬프트 자체는 영문)`;

export async function runImagePrompter(
  projectId: string,
  topic: string,
  sceneDesignMd: string
): Promise<string> {
  emit(projectId, { type: 'log', message: '[8단계] 이미지 프롬프트 생성 중...' });

  const prompt = `${SYSTEM}

---

토픽: "${topic}"

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
