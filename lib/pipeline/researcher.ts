import { emit } from '../events';
import { writeFile } from '../project';
import { runClaude } from './claude-runner';

const SYSTEM = `당신은 유튜브 스토리텔링 채널의 전문 리서처입니다.
주어진 토픽을 깊이 조사하여 대본 작성에 필요한 모든 재료를 수집합니다.

수집하는 내용:
1. 핵심 사실: 주요 사건, 인물, 배경, 정확한 날짜·장소·관계자, 역사적/사회적 맥락
2. 드라마틱한 순간: 반전이 있는 사건, 감정적으로 강렬한 장면, 일반인이 모르는 숨겨진 이야기
3. 놀라운 디테일: 대부분의 사람이 모르는 사실, 상식을 뒤집는 내용, 흥미로운 뒷이야기
4. 유사 콘텐츠 분석: 같은 토픽을 다룬 기존 접근 각도 및 차별화 포인트

출력 형식 (research.md):
\`\`\`markdown
# 리서치 보고서: {토픽}

## 핵심 사실
- ...

## 드라마틱한 순간
- ...

## 숨겨진 디테일
- ...

## 유사 콘텐츠 분석
| 채널/매체 | 접근 각도 |
|-----------|---------|
| ... | ... |

## 참고 출처
- ...
\`\`\`

규칙:
- 출처 불명확한 정보는 [미확인] 표시
- 한국어로 작성
- 충분한 정보를 바탕으로 상세하게 작성`;

async function tavilySearch(query: string): Promise<string | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const answer = data.answer ? `요약: ${data.answer}\n\n` : '';
    const results = (data.results ?? [])
      .map((r: { title: string; url: string; content: string }) => `[${r.title}](${r.url})\n${r.content}`)
      .join('\n\n---\n\n');
    return answer + results;
  } catch {
    return null;
  }
}

export async function runResearcher(projectId: string, topic: string): Promise<string> {
  emit(projectId, { type: 'log', message: `[1단계] 리서치 시작: "${topic}"` });

  const queries = [topic, `${topic} 역사 배경`, `${topic} 진실 비밀`, `${topic} 알려지지 않은 사실`];
  let searchContext = '';

  for (const query of queries) {
    emit(projectId, { type: 'log', message: `🔍 검색: "${query}"` });
    const result = await tavilySearch(query);
    if (result) {
      searchContext += `\n\n### 검색어: ${query}\n${result}`;
    }
  }

  const searchSection = searchContext
    ? `\n\n## 사전 수집 자료 (웹 검색 결과)\n${searchContext}\n`
    : '';

  const prompt = `${SYSTEM}\n\n---\n\n토픽: "${topic}"${searchSection}\n\n위 형식에 맞게 리서치 내용만 출력해주세요. 파일 저장은 하지 마세요.`;

  const researchContent = await runClaude(prompt);

  if (!researchContent) {
    throw new Error('리서처가 research.md 내용을 생성하지 못했습니다.');
  }

  writeFile(projectId, 'research.md', researchContent);
  emit(projectId, { type: 'log', message: '✅ research.md 저장 완료' });

  return researchContent;
}
