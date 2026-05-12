import { emit } from '../events';
import { writeFile } from '../project';
import { runClaude } from './claude-runner';

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

export async function runYoutubeAnalyzer(projectId: string, topic: string): Promise<string> {
  emit(projectId, { type: 'log', message: `[1.5단계] 유튜브 레퍼런스 분석 중...` });

  const queries = [
    `${topic} 유튜브 인기 영상 제목`,
    `${topic} youtube 조회수 높은 영상`,
  ];

  let searchContext = '';
  for (const query of queries) {
    emit(projectId, { type: 'log', message: `🔍 유튜브 검색: "${query}"` });
    const result = await tavilySearch(query);
    if (result) {
      searchContext += `\n\n### 검색어: ${query}\n${result}`;
    }
  }

  const searchSection = searchContext
    ? `## 수집된 유튜브 콘텐츠 정보\n${searchContext}\n`
    : '(검색 결과 없음 — TAVILY_API_KEY 미설정 가능성)';

  const prompt = `당신은 유튜브 콘텐츠 분석 전문가입니다.
수집된 유튜브 정보를 바탕으로 해당 토픽에서 성공하는 영상의 패턴을 분석합니다.

---

토픽: "${topic}"

${searchSection}

---

아래 형식으로 분석 결과만 출력하세요. 파일 저장은 하지 마세요.

# 유튜브 레퍼런스 분석: ${topic}

## 인기 제목 패턴
- 공통 키워드: ...
- 감정 자극 방식: ...
- 숫자/리스트 활용: ...
- 제목 길이/구조: ...

## 훅 & 썸네일 전략
- 자주 쓰이는 훅 유형: ...
- 썸네일 텍스트 패턴: ...
- 클릭 유도 감정: ...

## 성공 요인 분석
- 상위 영상 공통점: ...
- 차별화 기회: ...

## 피해야 할 패턴
- 과포화된 접근: ...
- 저성과 패턴: ...

## 전략 추천
- 최적 접근 각도: ...
- 제목 방향성: ...`;

  const analysisContent = await runClaude(prompt);

  if (!analysisContent) {
    const fallback = `# 유튜브 레퍼런스 분석: ${topic}\n\n(분석 결과 없음 — 검색 데이터 부족)`;
    writeFile(projectId, 'youtube-analysis.md', fallback);
    emit(projectId, { type: 'log', message: '⚠️ 유튜브 분석 결과 없음 — 건너뜀' });
    return fallback;
  }

  writeFile(projectId, 'youtube-analysis.md', analysisContent);
  emit(projectId, { type: 'log', message: '✅ youtube-analysis.md 저장 완료' });

  return analysisContent;
}
