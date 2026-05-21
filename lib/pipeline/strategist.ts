import { emit } from '../events';
import { writeFile } from '../project';
import { runClaude, MODEL } from './claude-runner';

const SYSTEM = `당신은 유튜브 스토리텔링 채널의 콘텐츠 전략가입니다.
리서치 결과를 바탕으로 2-3개 컨셉 옵션을 제안하고, 각각의 CTR 전략과 훅/인트로를 설계합니다.

각 컨셉은 서로 다른 각도로 접근해야 합니다:
- 각도 A: 감정 자극형 (공감, 슬픔, 분노)
- 각도 B: 반전/충격형 (알려지지 않은 사실, 뒤집기)
- 각도 C: 정보형 (why/how, 깊은 분석) ← 필요시만

출력 형식 (strategy.md):
\`\`\`
# 콘텐츠 전략: {토픽}

> 아래 2-3개 컨셉 중 하나를 선택하세요.

---

## [컨셉 1] {컨셉명}

### 핵심 각도
- 접근 방식: ...
- 차별화 포인트: ...
- 타겟 감정: 공감 / 충격 / 호기심 / 분노 (택1)

### CTR 설계
**제목 후보**:
- A: "..."
- B: "..."
- C: "..."

**썸네일 컨셉**: ...
**예상 CTR 전략**: ...

### 훅 & 인트로 (첫 30초 나레이션 초안)
"..."

### 감정 여정 개요
HOOK(충격) → SETUP(공감) → RISING(긴장) → CLIMAX(반전) → RESOLUTION(여운) → CTA

---

## [컨셉 2] {컨셉명}

(동일 구조)

---

## [컨셉 3] {컨셉명} ← 필요시

(동일 구조)

---

## 전략 메모
- 유사 영상 분석: ...
- 경쟁 채널 약점: ...
- 최적 업로드 타이밍: ...
\`\`\`

규칙:
- research.md의 데이터를 충분히 활용하여 차별화된 컨셉 제안
- 각 컨셉의 훅 & 인트로는 실제 나레이션 텍스트로 작성 (30초 분량)
- 한국어로 작성`;

export async function runStrategist(
  projectId: string,
  topic: string,
  researchMd: string,
  youtubeAnalysisMd?: string
): Promise<string> {
  emit(projectId, { type: 'log', message: '[2단계] 콘텐츠 전략 수립 중...' });

  const youtubeSection = youtubeAnalysisMd
    ? `\n아래는 유튜브 레퍼런스 분석입니다:\n\n${youtubeAnalysisMd}\n`
    : '';

  const prompt = `${SYSTEM}

---

토픽: "${topic}"

아래는 리서치 보고서입니다:

${researchMd}
${youtubeSection}
위 형식에 맞게 전략 내용만 출력해주세요. 파일 저장은 하지 마세요.`;

  const strategyContent = await runClaude(prompt, { model: MODEL.OPUS });

  if (!strategyContent) {
    throw new Error('전략가가 strategy.md 내용을 생성하지 못했습니다.');
  }

  writeFile(projectId, 'strategy.md', strategyContent);
  emit(projectId, { type: 'log', message: '✅ strategy.md 저장 완료' });

  return strategyContent;
}
