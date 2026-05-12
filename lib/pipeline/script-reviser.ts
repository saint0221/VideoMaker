import { emit } from '../events';
import { writeFile } from '../project';
import { runClaude } from './claude-runner';


export async function runScriptReviser(
  projectId: string,
  scriptMd: string,
  reviewMd: string
): Promise<string> {
  emit(projectId, { type: 'log', message: '[수정] 검수 권장사항 적용 중...' });

  const prompt = `당신은 한국어 유튜브 대본 편집 전문가입니다.
검수 리포트의 수정 사항을 원본 대본에 반영하여 개선된 대본을 작성합니다.

---

## 원본 대본
${scriptMd}

---

## 검수 리포트
${reviewMd}

---

## 작업 순서 (반드시 이 순서대로 출력)

### 1단계: 필수 수정 항목 체크리스트
검수 리포트의 "🔴 필수 수정" 항목을 아래 형식으로 하나씩 나열하고, 각각 어떻게 반영할지 명시하세요.

\`\`\`
[필수 수정 체크리스트]
1. (항목 원문) → 반영 방법: (구체적으로 무엇을 어떻게 바꿀지)
2. (항목 원문) → 반영 방법: (구체적으로 무엇을 어떻게 바꿀지)
...
\`\`\`

### 2단계: 권장 수정 항목 체크리스트
검수 리포트의 "🟡 권장 수정" 항목도 동일하게 나열하세요.

\`\`\`
[권장 수정 체크리스트]
1. (항목 원문) → 반영 방법: (구체적으로 무엇을 어떻게 바꿀지)
...
\`\`\`

### 3단계: 수정된 대본
위 체크리스트의 모든 항목을 반영한 완전한 대본을 아래 마커 사이에 출력하세요.

===대본 시작===
(수정된 대본 전체 내용)
===대본 끝===

규칙:
- 잘된 점(🟢)은 유지하세요
- 대본의 전체 구조(씬 구성, 형식)는 그대로 유지하세요
- 파일 저장이나 도구 사용 없이 텍스트만 출력합니다`;

  const revised = await runClaude(prompt);

  if (!revised) {
    throw new Error('대본 수정 내용을 생성하지 못했습니다.');
  }

  const sentinelMatch = revised.match(/===대본 시작===\r?\n([\s\S]+?)\r?\n===대본 끝===/);
  if (!sentinelMatch) {
    throw new Error('대본 마커(===대본 시작===)를 찾을 수 없습니다. LLM 출력 형식을 확인하세요.');
  }
  const cleanScript = sentinelMatch[1].trim();

  writeFile(projectId, 'script-final.md', cleanScript);
  emit(projectId, { type: 'log', message: '✅ 수정된 script-final.md 저장 완료' });

  return cleanScript;
}
