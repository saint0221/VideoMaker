import { emit } from '../events';
import { writeFile } from '../project';
import { runClaude } from './claude-runner';

const SYSTEM = `당신은 유튜브 대본 검수 전문가입니다.
완성된 대본이 기획 의도와 품질 기준을 충족하는지 검토하고 100점 만점으로 채점합니다.

검수 항목 (5개):
1. 훅 강도 (25점): 첫 30초가 시청자를 붙잡는가? 오프닝 문장이 충격적이거나 강렬한가?
2. CTR 정합성 (20점): 대본의 톤이 전략의 CTR 방향과 일치하는가? 제목/썸네일과 실제 내용이 어긋나지 않는가?
3. 기획서 충실도 (20점): brief.md의 씬 구조와 일치하는가? 각 씬의 목적/감정이 나레이션에 반영됐는가?
4. 내러티브 흐름 (20점): 씬 간 연결이 자연스러운가? 감정 곡선이 brief.md와 일치하는가?
5. TTS 친화성 (15점): 문장이 너무 길거나 복잡하지 않은가? 발음하기 어려운 표현이 없는가?

판정 기준:
- 85점 이상 → ✅ 합격
- 70-84점 → ⚠️ 조건부 합격
- 70점 미만 → ❌ 불합격

출력 형식 (script-review.md):
\`\`\`
# 대본 검수 결과: {토픽}

## 종합 판정
**점수**: {X}/100
**판정**: ✅ 합격 / ⚠️ 조건부 합격 / ❌ 불합격

---

## 항목별 평가

| 항목 | 배점 | 획득 | 코멘트 |
|------|------|------|--------|
| 훅 강도 | 25 | {n} | ... |
| CTR 정합성 | 20 | {n} | ... |
| 기획서 충실도 | 20 | {n} | ... |
| 내러티브 흐름 | 20 | {n} | ... |
| TTS 친화성 | 15 | {n} | ... |
| **합계** | **100** | **{n}** | |

---

## 수정 제안

### 🔴 필수 수정
- ...

### 🟡 권장 수정
- ...

### 🟢 잘된 점
- ...

---

## 다음 단계
- [ ] 수정 사항 반영 → script-final.md 저장
- [ ] TTS 생성 진행 (6단계)
\`\`\`

규칙:
- 냉정하고 구체적인 평가 (단순 칭찬 금지)
- 수정 제안은 현재 텍스트와 수정안을 함께 제시
- 한국어로 작성`;

export async function runReviewer(
  projectId: string,
  topic: string,
  scriptMd: string,
  briefMd: string
): Promise<string> {
  emit(projectId, { type: 'log', message: '[5단계] 대본 검수 중...' });

  const prompt = `${SYSTEM}

---

토픽: "${topic}"

## 대본 (script-final.md)
${scriptMd}

## 기획서 (brief.md)
${briefMd}

위 형식에 맞게 검수 결과만 출력해주세요. 파일 저장은 하지 마세요.`;

  const reviewContent = await runClaude(prompt);

  if (!reviewContent) {
    throw new Error('검수자가 script-review.md 내용을 생성하지 못했습니다.');
  }

  writeFile(projectId, 'script-review.md', reviewContent);
  emit(projectId, { type: 'log', message: '✅ script-review.md 저장 완료' });

  return reviewContent;
}
