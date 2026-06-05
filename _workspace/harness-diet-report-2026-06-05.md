# harness-diet 최종 리포트 (2026-06-05)

목표: 하네스를 더 짧고, 더 명확하고, 더 필요한 순간에만 나타나는 구조로 정리.

---

## 1. 변경 파일 목록

| 작업 | 파일 경로 |
|------|-----------|
| 수정 | `/Users/hongss/VideoMaker/CLAUDE.md` |
| 신규 | `/Users/hongss/VideoMaker/docs/PIPELINE.md` |
| 수정 | `/Users/hongss/VideoMaker/.claude/skills/videomaker-ops/SKILL.md` |
| 아카이브 → 이동 | `/Users/hongss/VideoMaker/.claude/agents/session-finisher.md` |
| 아카이브 → 이동 | `/Users/hongss/VideoMaker/.claude/agents/rule-auditor.md` |
| 아카이브 → 이동 | `~/.claude/rules/zh/` (11개 파일 전체) |
| 아카이브 → 이동 | `~/.claude/rules/common/agents.md` |
| 아카이브 → 이동 | `~/.claude/rules/common/code-review.md` |
| 아카이브 → 이동 | `~/.claude/rules/common/development-workflow.md` |
| 아카이브 → 이동 | `~/.claude/rules/common/git-workflow.md` |
| 아카이브 → 이동 | `~/.claude/rules/common/hooks.md` |
| 아카이브 → 이동 | `~/.claude/rules/common/performance.md` |
| 아카이브 → 이동 | `~/.claude/rules/common/testing.md` |

아카이브 위치:
- 전역: `~/.claude/archive/harness-diet-2026-06-05/`
- 프로젝트: `/Users/hongss/VideoMaker/.claude/archive/harness-diet-2026-06-05/`

---

## 2. 파일별 이유

**CLAUDE.md** (165줄 → 58줄)
파이프라인 단계표, API 라우트 트리, 데이터 모델, UI 디자인 시스템 등 참조 문서 성격의 내용이 매 세션 전체 컨텍스트로 주입됐다. 개발 경고(주의사항 15개)와 환경변수만 Claude 행동에 직접 영향을 주므로 나머지는 `docs/PIPELINE.md`로 이동.

**docs/PIPELINE.md** (신규)
CLAUDE.md에서 추출한 참조 문서. Claude가 매 세션 읽을 필요는 없고, 개발자가 수동으로 조회하거나 Claude가 필요 시 직접 Read할 수 있는 위치에 보존.

**SKILL.md**
description에 "마무리", "동기화 확인", "규칙 체크" 등 너무 넓은 트리거가 포함돼 관련 없는 대화에서도 스킬이 발동될 위험이 있었다. description 축소 + "사용하지 말아야 할 때" 섹션 추가로 트리거 범위를 명시적으로 좁혔다. Mode 2에 배경(버그 사례)과 출력 형식을 추가해 감사 결과가 일관된 포맷으로 나오도록 했다.

**session-finisher.md** (아카이브)
SKILL.md Mode 1과 95% 이상 내용이 중복. SKILL.md에 이미 세션 마무리 절차 전체가 포함돼 있으므로 별도 에이전트 불필요.

**rule-auditor.md** (아카이브)
SKILL.md Mode 2와 내용 중복. 감사 소스·절차·출력 형식이 이미 SKILL.md에 통합됐으므로 별도 에이전트 불필요. 핵심 배경(버그 사례)은 SKILL.md Mode 2 배경 섹션으로 이전.

**zh/ 11개 파일** (아카이브)
한국어+영어를 쓰는 사용자에게 중국어 번역본은 불필요하다. 매 세션 common/ 규칙과 함께 주입돼 컨텍스트를 ~2× 낭비.

**common/ 7개 파일** (아카이브)
git-workflow, code-review, development-workflow, hooks, agents, performance, testing — 이 7개는 Claude Code의 기본 동작(커밋 메시지, 테스트 우선 등)과 상당 부분 중복되거나, VideoMaker 특화 내용 없이 일반 지침만 담겨 있다. 실제 프로젝트 행동을 결정하는 CLAUDE.md + SKILL.md + 남은 common 3개(coding-style, security, patterns)로 충분.

---

## 3. Before/After 요약

| 항목 | Before | After |
|------|--------|-------|
| CLAUDE.md 줄 수 | 165줄 | 58줄 (-65%) |
| common/ 파일 수 | 10개 | 3개 (coding-style, security, patterns) |
| zh/ 파일 수 | 11개 | 0개 (아카이브) |
| 세션당 주입 rules 파일 수 | ~23개 (10 common + 11 zh + 2 web 등) | ~5개 이하 |
| SKILL.md 트리거 키워드 수 | 7개 ("마무리" 포함) | 4개 (명시적 키워드만) |
| 프로젝트 .claude/agents/ | session-finisher.md, rule-auditor.md | 비어 있음 |
| API 참조 문서 위치 | CLAUDE.md 인라인 | docs/PIPELINE.md 별도 파일 |

---

## 4. Diff 요약

**CLAUDE.md**
- 제거: 파이프라인 단계표 (23행), 핵심 파일 위치 트리 (38행), 데이터 모델 섹션 (20행), 실시간 통신 섹션 (4행), UI 디자인 시스템 섹션 (5행)
- 이동: 위 내용 전체 → `docs/PIPELINE.md`
- 유지: @AGENTS.md import, 하네스 섹션, 프로젝트 개요 (스택/실행/데이터 한 줄씩), 환경변수 섹션, 개발 시 주의사항 15개 전체 (버그 방지 핵심)
- 추가: `docs/PIPELINE.md 참조` 링크

**SKILL.md**
- description: 7 트리거 → 4 트리거, "반드시" 제거
- 모드 판별 테이블: "push", "마무리" 키워드 제거
- 추가: `## 사용하지 말아야 할 때` 섹션 (3개 명시적 비-트리거 조건)
- 모드 1 헤더: `session-finisher 에이전트 역할을 수행한다` → `다음 절차를 순서대로 실행한다`
- 모드 2 헤더: `rule-auditor 에이전트 역할을 수행한다` 제거
- 모드 2 추가: `### 배경` 섹션 (버그 사례 포함) + `### 출력 형식` 섹션

---

## 5. Claude 행동 변화 예측

**긍정적 변화**

- `videomaker-ops` 스킬이 "이 작업 마무리해줘", "코드 정리 마무리" 같은 무관한 문장에서 발동되지 않는다.
- 매 세션 zh/ 11개 파일이 컨텍스트에 주입되지 않아 약 15,000 토큰 절약 예상.
- common/ 7개 dormant 파일이 제거돼 중복 규칙 충돌(예: hooks.md의 "format on save" 훅이 VideoMaker 프로젝트에서 의미 없이 적용될 뻔한 상황)이 사라진다.
- CLAUDE.md가 짧아져 프로젝트 컨텍스트 처리 시간이 단축된다.

**주의할 변화**

- 파이프라인 상세(API 라우트 목록, 상태 키 등)가 자동 주입되지 않으므로, Claude가 스스로 `docs/PIPELINE.md`를 Read해야 한다. Claude Code는 필요 시 파일을 직접 읽으므로 문제없지만, 첫 세션에서 "파이프라인 API 경로가 뭐야?" 같은 질문엔 한 번의 Read 작업이 추가될 수 있다.
- common/ testing.md, code-review.md 등이 없어졌으나, CLAUDE.md의 개발 주의사항 15개와 coding-style.md, security.md가 여전히 핵심 동작을 커버한다.

---

## 6. 수동 승인 필요 항목

아래 항목은 이번 harness-diet에서 변경하지 않았습니다. 사용자가 직접 판단 후 처리하세요.

| 항목 | 파일 | 이유 |
|------|------|------|
| ELEVENLABS_API_KEY 빈 줄 제거 | `~/.claude/settings.json` line 7 | 현재 값 `""` (보안 위협 없음), 줄 제거는 미적 정리 — 수동 OK |
| UUID별 curl 항목 정리 | `.claude/settings.local.json` lines 14-21 | 특정 UUID 경로 `curl` 허용 항목 — 현재 프로젝트에 유효한지 확인 후 정리 권장 |
| hooks.json 검토 | 해당 파일 | hooks 수정 금지 규칙으로 이번에 제외. hooks 내용이 여전히 유효한지 수동 확인 |
| mcp-servers.json 검토 | 해당 파일 | MCP 설정 수정 금지 규칙으로 제외. `disabledMcpServers: "supabase,railway,vercel"` 설정이 최신 상태인지 확인 |

---

## 7. 스모크 테스트 5개 프롬프트

아래 프롬프트로 harness-diet 변경이 올바르게 작동하는지 확인하세요.

**테스트 1 — 스킬 비-트리거 확인 (negative)**
```
이 코드 작업 마무리해줘
```
기대: `videomaker-ops` 스킬이 발동되지 않고, 일반 응답.

**테스트 2 — 스킬 트리거 확인 (positive)**
```
세션 마무리해줘
```
기대: `videomaker-ops` 스킬 발동 → tsc → git push → Obsidian 순서 실행.

**테스트 3 — 규칙 감사 트리거 (positive)**
```
규칙 감사 실행해줘
```
기대: `videomaker-ops` Mode 2 발동 → SKILL.md와 pipeline SYSTEM 프롬프트 비교 → `## 규칙 동기화 감사 결과` 포맷 출력.

**테스트 4 — 파이프라인 참조 확인**
```
파이프라인 단계별 상태 키 전체 목록 알려줘
```
기대: Claude가 `docs/PIPELINE.md`를 Read한 후 파이프라인 단계표를 정확히 응답.

**테스트 5 — 컨텍스트 주입 확인**
```
현재 세션에서 어떤 규칙 파일이 로드됐어?
```
기대: zh/ 파일이 더 이상 언급되지 않고, common/ 파일은 coding-style.md, security.md, patterns.md 3개만 언급.
