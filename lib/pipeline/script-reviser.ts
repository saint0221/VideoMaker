import { emit } from '../events';
import { writeFile } from '../project';
import { runClaude, MODEL } from './claude-runner';

function extractFinalScript(output: string): string {
  const sentinelMatch = output.match(/===대본 시작===\r?\n([\s\S]+?)\r?\n===대본 끝===/);
  let script = sentinelMatch ? sentinelMatch[1].trim() : output.trim();

  const titleIndex = script.indexOf('# 대본:');
  if (titleIndex > 0) {
    script = script.slice(titleIndex).trim();
  }

  script = script.replace(/\r\n/g, '\n').trim();

  if (!script.startsWith('# 대본:')) {
    throw new Error('수정된 대본이 "# 대본:"으로 시작하지 않습니다. LLM 출력 형식을 확인하세요.');
  }

  const forbiddenMarkers = [
    '[필수 수정 체크리스트]',
    '[권장 수정 체크리스트]',
    '## 1단계',
    '## 2단계',
    '## 3단계',
    '===대본 시작===',
    '===대본 끝===',
  ];

  const foundMarker = forbiddenMarkers.find((marker) => script.includes(marker));
  if (foundMarker) {
    throw new Error(`수정 메모가 script-final.md에 섞였습니다: ${foundMarker}`);
  }

  return script;
}

export async function runScriptReviser(
  projectId: string,
  scriptMd: string,
  reviewMd: string
): Promise<string> {
  emit(projectId, { type: 'log', message: '[수정] 검수 권장사항 적용 중...' });

  const prompt = `당신은 한국어 유튜브 대본 편집 전문가입니다.
검수 리포트의 수정 사항을 원본 대본에 반영하여 개선된 최종 대본만 작성합니다.

---

## 원본 대본
${scriptMd}

---

## 검수 리포트
${reviewMd}

---

## 수정 원칙

- 검수 리포트의 "🔴 필수 수정"은 모두 반영합니다.
- "🟡 권장 수정"은 대본 품질을 높이는 항목만 반영합니다.
- "🟢 잘된 점"은 유지합니다.
- 대본의 전체 형식과 씬 구성은 유지하되, 문장 품질·흐름·TTS 친화성은 적극적으로 개선합니다.
- 필수 수정이 시간 초과를 만들면 기존 문장을 줄여 총 길이를 맞춥니다.
- 나레이션에 중점(·), 슬래시(/), 화살표(→), 긴 괄호 설명, TTS 발음 메모를 넣지 않습니다.
- 수정 체크리스트, 해설, 변경 요약, 검수 메모는 출력하지 않습니다.

## 출력 형식

반드시 아래 마커 사이에 수정된 script-final.md 본문만 출력하세요.
마커 밖에는 아무것도 쓰지 마세요.

===대본 시작===
# 대본: ...

...
===대본 끝===
`;

  const revised = await runClaude(prompt, { model: MODEL.OPUS });

  if (!revised) {
    throw new Error('대본 수정 내용을 생성하지 못했습니다.');
  }

  const cleanScript = extractFinalScript(revised);

  writeFile(projectId, 'script-final.md', cleanScript);
  emit(projectId, { type: 'log', message: '✅ 수정된 script-final.md 저장 완료' });

  return cleanScript;
}
