import { emit } from '../events';
import { writeFile } from '../project';
import { runClaude, MODEL } from './claude-runner';

const SYSTEM = `당신은 유튜브 대본 팩트 체커입니다.
대본의 사실 주장을 리서치 자료와 대조하여 정확성을 검증합니다.`;

export async function runFactChecker(
  projectId: string,
  topic: string,
  scriptMd: string,
  researchMd: string
): Promise<string> {
  emit(projectId, { type: 'log', message: '[4.5단계] 팩트 체크 중...' });

  const cachedPrefix = `## 리서치 자료 (research.md)\n${researchMd}`;
  const prompt = `## 대본 (script-final.md)
${scriptMd}

---

아래 형식으로 팩트 체크 결과만 출력하세요. 파일 저장은 하지 마세요.

# 팩트 체크 결과: ${topic}

## 검증 항목

| # | 대본 주장 | 리서치 근거 | 판정 |
|---|-----------|-------------|------|
| 1 | "..." | ... | ✅ 확인 / ⚠️ 불확실 / ❌ 불일치 |
| 2 | ... | ... | ... |

## 수정 필요 항목

### ❌ 사실 오류 (필수 수정)
- ...

### ⚠️ 불확실 주장 (검토 권장)
- ...

### ✅ 확인된 주장
- ...

## 팩트 체크 요약
- 총 검증 항목: N개
- 확인: N개 / 불확실: N개 / 오류: N개
- 종합 의견: ...`;

  const factCheckContent = await runClaude(prompt, { model: MODEL.SONNET, projectId, systemPrompt: SYSTEM, cachedPrefix });

  if (!factCheckContent) {
    throw new Error('팩트 체커가 결과를 생성하지 못했습니다.');
  }

  writeFile(projectId, 'fact-check.md', factCheckContent);
  emit(projectId, { type: 'log', message: '✅ fact-check.md 저장 완료' });

  return factCheckContent;
}
