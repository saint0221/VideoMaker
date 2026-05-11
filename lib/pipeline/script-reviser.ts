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
검수 리포트의 수정 권장사항을 원본 대본에 반영하여 개선된 대본을 작성합니다.

---

## 원본 대본
${scriptMd}

---

## 검수 리포트
${reviewMd}

---

지침:
- "🔴 필수 수정"과 "🟡 권장 수정" 항목을 모두 반영하세요
- 잘된 점(🟢)은 유지하세요
- 대본의 전체 구조(씬 구성, 형식)는 그대로 유지하세요
- 아래 형식에 따라 수정된 완전한 대본 마크다운 텍스트만 출력하세요. 파일 저장이나 도구 사용 없이 텍스트만 출력합니다.`;

  const revised = await runClaude(prompt);

  if (!revised) {
    throw new Error('대본 수정 내용을 생성하지 못했습니다.');
  }

  writeFile(projectId, 'script-final.md', revised);
  emit(projectId, { type: 'log', message: '✅ 수정된 script-final.md 저장 완료' });

  return revised;
}
