import { emit } from '../events';
import { writeFile } from '../project';
import { runClaude } from './claude-runner';

const SYSTEM = `당신은 유튜브 영상 기획 전문가입니다.
선택된 컨셉을 바탕으로 대본 작가가 바로 쓸 수 있는 기획서(brief.md)를 작성합니다.

기획서에 포함할 내용:
1. 영상 개요: 컨셉 한 줄 요약, 핵심 메시지, 타겟 시청자, 예상 길이, 톤
2. 씬 구조 (6-10개 씬): 각 씬의 번호, 이름, 타입, 목적, 핵심 메시지, 비주얼 방향, 예상 시간, 감정
   씬 타입: HOOK / SETUP / RISING / CLIMAX / RESOLUTION / CTA / OUTRO
3. 전체 감정 곡선 (씬별 강도 1-10)
4. 톤 & 스타일 가이드: 문체, 속도, 금지/권장 표현
5. CTA 설계: 위치, 문구, 유도 방식

출력 형식 (brief.md):
\`\`\`
# 기획서: {토픽}

## 영상 개요
- **컨셉**: {컨셉명}
- **핵심 메시지**: {한 문장}
- **타겟**: {구체적 타겟}
- **예상 길이**: {X분}
- **톤**: {격식체/구어체 등}

---

## 씬 구조

### Scene 01 — {씬 이름}
| 항목 | 내용 |
|------|------|
| 타입 | HOOK |
| 목적 | ... |
| 핵심 메시지 | ... |
| 비주얼 방향 | ... |
| 예상 시간 | 30초 |
| 감정 | 충격/호기심 |

---

(Scene 02 ~ N 동일 구조)

---

## 감정 곡선
씬1(3) → 씬2(5) → 씬3(7) → 씬4(9) → 씬5(6) → 씬6(4)

## 톤 & 스타일 가이드
- 문체: ...
- 속도: ...
- 권장: ...
- 금지: ...

## CTA 설계
- 중간 언급: 씬 {N}에서 "..." 형식으로
- 아웃트로 CTA: "..."
\`\`\`

규칙:
- concept.md와 research.md를 충분히 반영
- 씬 구조는 구체적으로 (나레이션 작가가 보고 바로 쓸 수 있도록)
- 한국어로 작성
- **토픽에 시간 힌트가 포함된 경우 반드시 준수**: "1분 요약"→예상 길이 1분(씬 2-3개), "2분"→2분(씬 3-4개), "30초"→30초(씬 1-2개). 기본은 7-10분(씬 6-10개)
- 예상 길이에 맞춰 씬당 예상 시간 배분 (씬 예상 시간 합계 = 전체 예상 길이)`;

export async function runPlanner(
  projectId: string,
  topic: string,
  conceptMd: string,
  researchMd: string
): Promise<string> {
  emit(projectId, { type: 'log', message: '[3단계] 기획서 작성 중...' });

  const prompt = `${SYSTEM}

---

토픽: "${topic}"

## 선택된 컨셉 (concept.md)
${conceptMd}

## 리서치 보고서 (research.md)
${researchMd}

위 형식에 맞게 기획서 내용만 출력해주세요. 파일 저장은 하지 마세요.`;

  const briefContent = await runClaude(prompt);

  if (!briefContent) {
    throw new Error('기획자가 brief.md 내용을 생성하지 못했습니다.');
  }

  writeFile(projectId, 'brief.md', briefContent);
  emit(projectId, { type: 'log', message: '✅ brief.md 저장 완료' });

  return briefContent;
}
