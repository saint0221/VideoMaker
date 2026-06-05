# AI 코딩 하네스 감사 보고서

**생성일**: 2026-06-05  
**감사 방식**: harness-legacy-scan Dynamic Workflow (6-agent: 4×Explore 분석 → Refactor Planner → Adversarial Reviewer)  
**제약**: 읽기 전용 — 파일 수정 없음  
**반론 심사**: 완료 (Planner 권고 10건 뒤집힘)

---

## 1. 전체 요약

| 구분 | 수량 | 예상 절약 |
|------|------|---------|
| 발견 항목 총계 | 39건 | — |
| CRITICAL (즉시 조치) | 1건 | 보안 리스크 제거 |
| HIGH | 1건 | 권한 노출 축소 |
| SHRINK (축약) | 2건 | ~120L 컨텍스트 절약 |
| DELETE (삭제) | 14건 | ~1,700L 절약 |
| CONVERT (전환) | 1건 | 중복 제거 |
| KEEP | 22건 | — |

**절약 예상 합계**: 전역 context injection ~1,820L 감소  
**최우선 조치**: `~/.claude/settings.json` ELEVENLABS_API_KEY 제거 (평문 노출 중)

---

## 2. 개별 발견 항목

### [1] 전역 설정 — settings.json

| 필드 | 내용 |
|------|------|
| **경로** | `~/.claude/settings.json:7` |
| **현재 목적** | Claude Code 전역 환경변수 주입 |
| **발견한 문제** | `ELEVENLABS_API_KEY` 평문 노출 |
| **근거** | settings.json은 버전관리 대상이 아니지만 `Read(//Users/hongss/.claude/**)` 와일드카드 권한으로 모든 에이전트 서브프로세스가 접근 가능. .env.local에 이미 동일 키 존재 → 이중 저장 |
| **추천 조치** | **DELETE** (settings.json 내 항목만) |
| **이동 위치** | `/Users/hongss/VideoMaker/.env.local` (이미 존재) |
| **위험도** | 🔴 CRITICAL — 즉시 조치 필요 |
| **신뢰도** | 95% |
| **harness-diet 자동** | ❌ 사람이 키 로테이션 여부 판단 필요 |

---

### [2] 권한 설정 — settings.local.json (Read 와일드카드)

| 필드 | 내용 |
|------|------|
| **경로** | `/Users/hongss/VideoMaker/.claude/settings.local.json` |
| **현재 목적** | 프로젝트 로컬 도구 허용 목록 |
| **발견한 문제** | `Read(//Users/hongss/.claude/**)` 와일드카드가 ELEVENLABS_API_KEY가 담긴 settings.json 포함 전체 ~/.claude 디렉터리 노출 |
| **근거** | 와일드카드 하나가 60+ 하위 항목을 포섭하는 구조는 정상이지만, 시크릿이 저장된 ~/.claude를 전체 노출하는 건 별도 위험. 필요한 하위 디렉터리만 명시적 허용으로 교체해야 함 |
| **추천 조치** | **SHRINK** — `~/.claude/rules/**`, `~/.claude/agents/**`, `~/.claude/skills/**` 등 구체적 경로로 분리 |
| **이동 위치** | 동일 파일 내 세분화 |
| **위험도** | 🔴 HIGH |
| **신뢰도** | 88% |
| **harness-diet 자동** | ❌ 사람이 실제 필요 경로 목록 확인 필요 |

---

### [3] 권한 설정 — settings.local.json (UUID 일회성 항목)

| 필드 | 내용 |
|------|------|
| **경로** | `/Users/hongss/VideoMaker/.claude/settings.local.json` |
| **현재 목적** | 과거 특정 작업 중 발급된 일회성 curl/ffprobe 허용 항목 |
| **발견한 문제** | fec13dfc-..., 6b548fbf-... UUID가 포함된 curl 경로와 삭제된 프로젝트용 ffprobe 항목 — 모두 상위 와일드카드에 이미 포섭됨 |
| **근거** | 와일드카드 포섭 확인 완료. 삭제된 프로젝트 경로는 존재하지 않는 디렉터리를 가리킴 |
| **추천 조치** | **DELETE** (해당 일회성 항목만) |
| **이동 위치** | — |
| **위험도** | 🟡 LOW |
| **신뢰도** | 92% |
| **harness-diet 자동** | ✅ 가능 |

---

### [4] 프로젝트 컨텍스트 — VideoMaker/CLAUDE.md

| 필드 | 내용 |
|------|------|
| **경로** | `/Users/hongss/VideoMaker/CLAUDE.md` |
| **현재 목적** | 파이프라인 11단계, API 경로 트리, 개발 주의사항 — 세션마다 자동 주입 |
| **발견한 문제** | 165L 중 파이프라인 테이블(27-50행, 24L)과 API 경로 트리(52-97행, 46L)가 세부 온보딩 정보로, 세션마다 불필요하게 주입됨. 반면 146-165행 버그방지 정보는 핵심 |
| **근거** | 파이프라인 단계 테이블과 경로 트리는 코드를 직접 읽으면 파악 가능한 구조 정보. CLAUDE.md는 "코드를 읽어도 알 수 없는 함정"을 담아야 효율적 |
| **추천 조치** | **SHRINK** — 상세 테이블/트리를 `docs/PIPELINE.md`로 이동, CLAUDE.md는 핵심 경고와 개발 주의사항만 유지 (~30L) |
| **이동 위치** | `docs/PIPELINE.md` (신규 생성) |
| **위험도** | 🟡 MEDIUM |
| **신뢰도** | 82% |
| **harness-diet 자동** | ❌ 내용 판단 필요 |

---

### [5] 프로젝트 컨텍스트 — VideoMaker/AGENTS.md

| 필드 | 내용 |
|------|------|
| **경로** | `/Users/hongss/VideoMaker/AGENTS.md` |
| **현재 목적** | Codex 에이전트용 프로젝트 컨텍스트, Next.js 16 경고 포함 |
| **발견한 문제** | 26-32행, 46-52행, 54-58행이 CLAUDE.md와 내용 중복 |
| **근거** | AGENTS.md의 Next.js 16 경고, pipeline rules, artifact rules, AI/external 항목 일부가 CLAUDE.md 개발 주의사항과 겹침 |
| **추천 조치** | **KEEP** — Next.js 16 post-cutoff 경고는 유효하고 필수. Codex 에이전트와 Claude 에이전트가 모두 읽음 |
| **이동 위치** | — |
| **위험도** | — |
| **신뢰도** | 90% |
| **harness-diet 자동** | — |

---

### [6] 전역 규칙 — ~/.claude/CLAUDE.md

| 필드 | 내용 |
|------|------|
| **경로** | `~/.claude/CLAUDE.md` |
| **현재 목적** | 전역 언어 설정(한국어), Karpathy 원칙, 전역 행동 지침 |
| **발견한 문제** | 해당 없음 |
| **근거** | 핵심 원칙과 사용자 특화 지침만 담고 있으며, 중복 없이 명확함 |
| **추천 조치** | **KEEP** |
| **이동 위치** | — |
| **위험도** | — |
| **신뢰도** | 95% |
| **harness-diet 자동** | — |

---

### [7] 스킬 — videomaker-ops/SKILL.md

| 필드 | 내용 |
|------|------|
| **경로** | `/Users/hongss/VideoMaker/.claude/skills/videomaker-ops/SKILL.md` (85L) |
| **현재 목적** | 세션 마무리(tsc→git push→Obsidian) + 규칙 동기화 감사 — 7개 트리거 키워드 |
| **발견한 문제** | 7개 트리거 키워드("깃 푸시", "세션 마무리", "규칙 감사" 등)가 광범위해 의도치 않은 활성화 가능. CLAUDE.md 7행에서 `videomaker-ops` 스킬 하드코딩으로 참조됨 |
| **근거** | Refactor Planner는 SPLIT 권고 → Adversarial Reviewer가 KEEP으로 뒤집음: CLAUDE.md 하드코딩으로 분리 시 참조 깨짐, 트리거 타이트닝으로 충분 |
| **추천 조치** | **KEEP** — description의 트리거 키워드를 더 명확하게 좁힘 (예: "세션 마무리" → "세션 마무리 체크리스트 실행") |
| **이동 위치** | — |
| **위험도** | — |
| **신뢰도** | 85% |
| **harness-diet 자동** | — |

---

### [8] 에이전트 — session-finisher.md

| 필드 | 내용 |
|------|------|
| **경로** | `/Users/hongss/VideoMaker/.claude/agents/session-finisher.md` (40L) |
| **현재 목적** | tsc 검증 → git push → Obsidian 작업일지 업데이트 |
| **발견한 문제** | videomaker-ops SKILL.md 모드 1과 95% 내용 중복. 동일한 3단계 루틴 |
| **근거** | SKILL.md와 비교 시 실질적 차이 없음. 스킬이 이미 이 에이전트의 기능을 완전히 포함 |
| **추천 조치** | **DELETE** |
| **이동 위치** | — |
| **위험도** | 🟢 LOW — 스킬이 기능 완전 대체 |
| **신뢰도** | 90% |
| **harness-diet 자동** | ✅ 가능 |

---

### [9] 에이전트 — rule-auditor.md

| 필드 | 내용 |
|------|------|
| **경로** | `/Users/hongss/VideoMaker/.claude/agents/rule-auditor.md` (55L) |
| **현재 목적** | SKILL.md와 파이프라인 코드 간 규칙 동기화 감사 |
| **발견한 문제** | videomaker-ops SKILL.md 모드 2보다 세부 내용이 풍부하지만 기능이 중복됨 |
| **근거** | 에이전트의 상세 감사 로직은 SKILL.md에 병합하고, 에이전트는 경량 래퍼로 유지하거나 제거 가능 |
| **추천 조치** | **CONVERT** — 세부 로직을 SKILL.md로 병합, 에이전트 파일 제거 |
| **이동 위치** | videomaker-ops SKILL.md (규칙 감사 모드 확장) |
| **위험도** | 🟡 MEDIUM — SKILL.md 수정 수반 |
| **신뢰도** | 80% |
| **harness-diet 자동** | ❌ SKILL.md 병합 내용 검토 필요 |

---

### [10-12] 비활성 아티팩트 — hooks.json, mcp-servers.json

| 필드 | hooks.json | mcp-servers.json |
|------|-----------|-----------------|
| **경로** | `~/.claude/hooks/hooks.json` (330L) | `~/.claude/mcp-configs/mcp-servers.json` (176L) |
| **현재 목적** | PostToolUse 포매터/린터 훅 정의 | MCP 서버 템플릿 |
| **발견한 문제** | settings.json에 `hooks` 키 없음. ECC 플러그인 비활성화. 실제로 실행되지 않음 | `YOUR_*_HERE` 플레이스홀더만 존재. `~/.claude.json`의 mcpServers가 비어 있음 |
| **근거** | 워크플로우 에이전트가 `enabledPlugins`와 settings.json 구조를 직접 확인 — 둘 다 어떠한 경로로도 활성화되지 않음 | 한 번도 실제 값으로 채워진 적 없는 설정 템플릿 |
| **추천 조치** | **DELETE** | **DELETE** |
| **위험도** | 🟢 LOW | 🟢 LOW |
| **신뢰도** | 93% | 95% |
| **harness-diet 자동** | ✅ 가능 | ✅ 가능 |

---

### [13] 전역 규칙 — ~/.claude/rules/zh/ (중국어 번역본)

| 필드 | 내용 |
|------|------|
| **경로** | `~/.claude/rules/zh/` (총 572L, 10개 파일) |
| **현재 목적** | common/ 규칙의 중국어 번역 미러 |
| **발견한 문제** | common/(534L)의 완전 번역본. 한국어+영어 사용자에게 중국어 번역본은 실질적 가치 없음 |
| **근거** | Planner는 "AGENTS.md @import로 무조건 로드"라고 주장 → Adversarial이 오류 정정 (AGENTS.md는 rules/를 import하지 않음). 그러나 DELETE 결론은 동일: 이 사용자의 언어 환경에서 중국어 번역본은 불필요한 중복 |
| **추천 조치** | **DELETE** |
| **이동 위치** | — |
| **위험도** | 🟢 LOW — 다른 규칙에 영향 없음 |
| **신뢰도** | 88% |
| **harness-diet 자동** | ✅ 가능 |

---

### [14-20] 전역 규칙 — ~/.claude/rules/common/ (비활성 중복 규칙)

> **중요**: common/ 규칙들은 세션마다 자동 주입되지 않음. Read 권한 요청 시 pull-on-demand 방식으로만 접근 가능 — DORMANT 상태

| 경로 | 현재 목적 | 문제 | 추천 | 위험도 | 신뢰도 | 자동 |
|------|----------|------|------|--------|--------|------|
| `common/git-workflow.md` | git 커밋 메시지 형식 | Claude Code 내장 git 기능과 중복. DORMANT | DELETE | 🟢 LOW | 87% | ✅ |
| `common/code-review.md` | 코드 리뷰 체크리스트 | code-reviewer 에이전트와 중복. DORMANT | DELETE | 🟢 LOW | 85% | ✅ |
| `common/development-workflow.md` | 기능 개발 파이프라인 | planner/tdd-guide 에이전트와 중복. DORMANT | DELETE | 🟢 LOW | 83% | ✅ |
| `common/hooks.md` | PostToolUse 훅 예시 | 실제 hooks.json도 비활성. DORMANT | DELETE | 🟢 LOW | 82% | ✅ |
| `common/agents.md` | 에이전트 목록 및 사용 시점 | Claude Code 에이전트 시스템 내장 기능과 중복. DORMANT | DELETE | 🟢 LOW | 80% | ✅ |
| `common/performance.md` | 모델 선택 전략 | ~/.claude/CLAUDE.md에 이미 포함된 내용과 부분 중복. DORMANT | DELETE | 🟢 LOW | 78% | ✅ |
| `common/testing.md` | 80% 커버리지, TDD 요구사항 | tdd-guide 에이전트와 중복. DORMANT | DELETE | 🟢 LOW | 80% | ✅ |

---

### [21] 전역 규칙 — ~/.claude/rules/common/coding-style.md

| 필드 | 내용 |
|------|------|
| **경로** | `~/.claude/rules/common/coding-style.md` |
| **현재 목적** | 불변성, DRY, YAGNI, 파일 조직 원칙 |
| **발견한 문제** | ~/.claude/CLAUDE.md의 Karpathy 원칙과 상당 부분 중복. DORMANT |
| **근거** | Karpathy 원칙이 이미 "단순함 우선", "외과적 변경" 등 핵심 내용 포함. 그러나 불변성, 네이밍 컨벤션 등 일부 고유 내용 존재 |
| **추천 조치** | **SHRINK** — CLAUDE.md와 중복되는 섹션 제거, 고유 내용(불변성, 네이밍 컨벤션, 파일 조직)만 유지 |
| **이동 위치** | 동일 파일 내 축약 |
| **위험도** | 🟢 LOW |
| **신뢰도** | 75% |
| **harness-diet 자동** | ❌ 내용 판단 필요 |

---

### [22-31] 언어별 규칙 디렉터리 — 전체 KEEP (반론 심사 결과 유지)

> **Adversarial Reviewer 정정**: Planner가 "paths: 선언 없다", "DORMANT 디스크 클러터"로 DELETE 권고 → 전부 오류. 실제로는 **모든 디렉터리에 `paths:` frontmatter 존재** → 해당 파일 타입이 프로젝트에 없으면 자동 비주입 (조건부 로딩). 전 세계 프로젝트에서 활용 가능한 전역 규칙이므로 DELETE 부적절

| 경로 | paths: 조건 | 추천 |
|------|-----------|------|
| `~/.claude/rules/typescript/` | `.ts`, `.tsx` 파일 존재 시 | **KEEP** |
| `~/.claude/rules/python/` | `.py` 파일 존재 시 | **KEEP** |
| `~/.claude/rules/golang/` | `.go` 파일 존재 시 | **KEEP** |
| `~/.claude/rules/cpp/` | `.cpp`, `.cc`, `.h` 존재 시 | **KEEP** |
| `~/.claude/rules/dart/` | `.dart` 파일 존재 시 | **KEEP** |
| `~/.claude/rules/java/` | `.java` 파일 존재 시 | **KEEP** |
| `~/.claude/rules/kotlin/` | `.kt` 파일 존재 시 | **KEEP** |
| `~/.claude/rules/rust/` | `.rs` 파일 존재 시 | **KEEP** |
| `~/.claude/rules/php/` | `.php` 파일 존재 시 | **KEEP** |
| `~/.claude/rules/csharp/` | `.cs` 파일 존재 시 | **KEEP** |

**세션당 컨텍스트 비용**: TypeScript 프로젝트에서는 typescript/ 만 주입, 나머지 9개는 비주입. **사실상 zero overhead.**

---

### [32-39] 전역 규칙 — 웹/언어 확장 규칙 (web/, common 나머지)

| 경로 | 추천 | 근거 |
|------|------|------|
| `~/.claude/rules/web/coding-style.md` | **KEEP** | CSS 변수, 컴포넌트 조직 등 web 특화 내용. VideoMaker가 Next.js 프로젝트이므로 유효 |
| `~/.claude/rules/web/testing.md` | **KEEP** | 시각 회귀, 접근성 테스트 등 web 특화 내용 |
| `~/.claude/rules/web/performance.md` | **KEEP** | Core Web Vitals, 번들 예산 등 유효 |
| `~/.claude/rules/web/patterns.md` | **KEEP** | 컴파운드 컴포넌트, 상태 관리 분리 등 유효 |
| `~/.claude/rules/web/hooks.md` | **KEEP** | PostToolUse 훅 설정 가이드 (비록 hooks.json이 비활성이지만 참고용) |
| `~/.claude/rules/web/security.md` | **KEEP** | CSP, XSS 방어, HTTPS 헤더 등 유효 |
| `~/.claude/rules/web/design-quality.md` | **KEEP** | 안티 템플릿 정책, UI 디자인 기준 — 고유 내용 |
| `~/.claude/rules/common/security.md` | **KEEP** | 하드코딩 시크릿 방지 등 핵심 체크리스트 — 고유 가치 |

---

## 3. KEEP 항목 (변경 불필요)

| 경로 | 근거 |
|------|------|
| `~/.claude/CLAUDE.md` | 전역 언어 설정·Karpathy 원칙 — 핵심 |
| `~/.claude/rules/web/**` (7개) | VideoMaker가 Next.js 프로젝트. 조건부 로딩 |
| `~/.claude/rules/common/security.md` | 핵심 보안 체크리스트, 다른 곳에서 중복 안 됨 |
| `~/.claude/rules/typescript/` | VideoMaker TypeScript 프로젝트. paths: 조건부 로딩 |
| `~/.claude/rules/{cpp,dart,java,kotlin,rust,php,csharp,golang,python}/` | paths: 조건부 로딩 → 세션 컨텍스트 비용 0 |
| `/Users/hongss/VideoMaker/AGENTS.md` | Next.js 16 post-cutoff 경고 필수 |
| `/Users/hongss/VideoMaker/.claude/skills/videomaker-ops/SKILL.md` | 트리거 타이트닝 후 유지 |

---

## 4. SHRINK 항목 (축약 권고)

### 4-1. VideoMaker/CLAUDE.md (165L → ~30L)

**축약 방법:**
1. 파이프라인 단계 테이블 (24행) → `docs/PIPELINE.md` 이동
2. API 경로 트리 (46행) → `docs/PIPELINE.md` 이동  
3. 데이터 모델 섹션 → `docs/PIPELINE.md` 이동
4. **보존 필수**: 146-165행 (버그방지 정보: `runPostScript`, `start-images` 복구 패턴, `parseConcepts` 위치, `done:strategy` 주의사항)
5. **보존 필수**: 환경변수 섹션 (짧고 명확)
6. **보존 필수**: 개발 주의사항 전체

```
# 목표 구조 (CLAUDE.md ~30L)
## 핵심 경로
[5-6줄: 핵심 파일만]

## 개발 주의사항
[기존 그대로]

## 버그방지 패턴
[기존 146-165행 그대로]
```

### 4-2. ~/.claude/rules/common/coding-style.md

**축약 방법:**
- CLAUDE.md Karpathy 원칙과 중복되는 "KISS/DRY/YAGNI" 설명 제거
- 불변성(CRITICAL), 네이밍 컨벤션, 파일 조직 기준은 유지

---

## 5. 전역 규칙 → Skill 이동 권고 (MOVE)

현재 common/ 규칙들 중 "실제로 쓰일 때 읽는" 성격의 항목들은 항상 주입되는 규칙보다 demand-loaded 스킬이 더 적합:

| 현재 위치 | 이동 제안 | 사유 |
|----------|----------|------|
| `common/development-workflow.md` | 이미 planner/tdd-guide 에이전트로 구현됨 → DELETE | 스킬 이동 불필요, 에이전트가 담당 |
| `common/hooks.md` | videomaker-ops SKILL.md 모드로 흡수 가능 | 훅 설정 가이드는 스킬 컨텍스트에서 더 유효 |

**결론**: common/ 규칙을 스킬로 이동하는 것보다 DELETE가 더 적절. 이미 에이전트/스킬 레이어에서 담당하고 있음.

---

## 6. Reference 분리 권고

현재 CLAUDE.md 내 레퍼런스 정보(파일 위치, API 경로 목록 등)는 세션마다 주입되어 불필요한 컨텍스트 소비를 유발:

| 항목 | 현재 위치 | 분리 제안 |
|------|----------|----------|
| 파이프라인 단계 상세 테이블 | CLAUDE.md 27-50행 | `docs/PIPELINE.md` |
| API 경로 트리 (38개 라우트) | CLAUDE.md 52-97행 | `docs/PIPELINE.md` |
| 데이터 모델 섹션 | CLAUDE.md 중간 | `docs/PIPELINE.md` |

**분리 후**: 에이전트가 파이프라인 세부 정보가 필요할 때만 `docs/PIPELINE.md`를 Read — on-demand 접근.

---

## 7. 삭제 후보 (DELETE)

| 우선순위 | 경로 | 크기 | 근거 |
|---------|------|------|------|
| 🔴 CRITICAL | `~/.claude/settings.json` 내 ELEVENLABS_API_KEY 항목 | 1행 | 평문 시크릿 노출 |
| 🟡 MEDIUM | `~/.claude/rules/zh/` | 572L, 10개 파일 | 한국어+영어 사용자에게 중국어 번역본 불필요 |
| 🟡 MEDIUM | `~/.claude/rules/common/git-workflow.md` | ~30L | Claude Code 내장 기능 중복 |
| 🟡 MEDIUM | `~/.claude/rules/common/code-review.md` | ~60L | code-reviewer 에이전트 중복 |
| 🟡 MEDIUM | `~/.claude/rules/common/development-workflow.md` | ~60L | planner/tdd-guide 에이전트 중복 |
| 🟡 MEDIUM | `~/.claude/rules/common/hooks.md` | ~30L | hooks.json 비활성. 실사용 없음 |
| 🟡 MEDIUM | `~/.claude/rules/common/agents.md` | ~30L | Claude Code 에이전트 시스템 중복 |
| 🟡 MEDIUM | `~/.claude/rules/common/performance.md` | ~40L | CLAUDE.md Karpathy 원칙과 중복 |
| 🟡 MEDIUM | `~/.claude/rules/common/testing.md` | ~40L | tdd-guide 에이전트 중복 |
| 🟢 LOW | `~/.claude/hooks/hooks.json` | 330L | settings.json에 hooks 키 없음 — 비활성 |
| 🟢 LOW | `~/.claude/mcp-configs/mcp-servers.json` | 176L | YOUR_*_HERE 플레이스홀더만, 한 번도 활성화 안 됨 |
| 🟢 LOW | VideoMaker `.claude/agents/session-finisher.md` | 40L | videomaker-ops SKILL.md와 95% 중복 |
| 🟢 LOW | settings.local.json UUID/path 일회성 항목 | ~10행 | 상위 와일드카드에 포섭, 일부는 존재하지 않는 경로 |

**총 삭제 시 절약**: ~1,508L + 시크릿 보안 리스크 제거

---

## 8. 사람 승인 필요 항목

아래 항목들은 자동 처리 전 반드시 사람이 확인해야 함:

| 항목 | 이유 | 필요한 판단 |
|------|------|------------|
| **ELEVENLABS_API_KEY 제거** | 키 로테이션 필요 여부 불명 — .env.local에 이미 동일 키 존재하면 안전, 아니면 키 재발급 후 제거 | .env.local 키 유효성 확인 후 제거 |
| **settings.local.json Read 와일드카드 축소** | 실제로 필요한 ~/.claude 하위 디렉터리 목록이 불명확 | 필요한 경로 목록 확정 후 세분화 |
| **CLAUDE.md SHRINK** | 어떤 내용이 "일상 코딩에 필수"인지 사용자만 알 수 있음 | 축약 범위 직접 검토 |
| **rule-auditor.md CONVERT** | SKILL.md에 병합할 세부 내용 검토 필요 | 병합 내용 승인 |
| **common/coding-style.md SHRINK** | CLAUDE.md와 중복 범위 판단 필요 | 삭제 섹션 확인 |

---

## 9. /harness-diet 자동 처리 가능 항목 (Low-Risk)

아래 항목들은 `/harness-diet` 실행 시 사람 확인 없이 자동 처리 가능:

| 항목 | 경로 | 예상 절약 |
|------|------|---------|
| zh/ 규칙 전체 삭제 | `~/.claude/rules/zh/` | 572L |
| common/git-workflow.md 삭제 | `~/.claude/rules/common/git-workflow.md` | ~30L |
| common/code-review.md 삭제 | `~/.claude/rules/common/code-review.md` | ~60L |
| common/development-workflow.md 삭제 | `~/.claude/rules/common/development-workflow.md` | ~60L |
| common/hooks.md 삭제 | `~/.claude/rules/common/hooks.md` | ~30L |
| common/agents.md 삭제 | `~/.claude/rules/common/agents.md` | ~30L |
| common/performance.md 삭제 | `~/.claude/rules/common/performance.md` | ~40L |
| common/testing.md 삭제 | `~/.claude/rules/common/testing.md` | ~40L |
| hooks.json 삭제 | `~/.claude/hooks/hooks.json` | 330L |
| mcp-servers.json 삭제 | `~/.claude/mcp-configs/mcp-servers.json` | 176L |
| session-finisher.md 삭제 | `VideoMaker/.claude/agents/session-finisher.md` | 40L |
| settings.local.json UUID 항목 삭제 | settings.local.json 내 일회성 항목 | ~10행 |

**자동 처리 총 절약**: ~1,408L

---

## 10. /harness-diet 실행용 추천 프롬프트

```
/harness-diet 다음 항목들을 순서대로 처리해줘:

## Phase 1 — CRITICAL 보안 (즉시)
1. ~/.claude/settings.json에서 ELEVENLABS_API_KEY 항목 제거
   - 제거 전: VideoMaker/.env.local에 동일 키가 있는지 확인
   - 있으면 제거. 없으면 사용자에게 먼저 .env.local에 추가하도록 알림

## Phase 2 — 자동 DELETE (확인 불필요)
2. ~/.claude/rules/zh/ 디렉터리 전체 삭제 (572L)
3. ~/.claude/rules/common/ 에서 다음 7개 파일 삭제:
   - git-workflow.md, code-review.md, development-workflow.md
   - hooks.md, agents.md, performance.md, testing.md
4. ~/.claude/hooks/hooks.json 삭제 (330L)
5. ~/.claude/mcp-configs/mcp-servers.json 삭제 (176L)
6. VideoMaker/.claude/agents/session-finisher.md 삭제 (40L)
7. VideoMaker/.claude/settings.local.json 에서 UUID 포함된 curl 항목 및
   존재하지 않는 프로젝트 경로 ffprobe 항목 삭제

## Phase 3 — 사람 검토 후 진행
8. VideoMaker/CLAUDE.md를 ~30L로 축약:
   - 파이프라인 단계 테이블(27-50행) → docs/PIPELINE.md 이동
   - API 경로 트리(52-97행) → docs/PIPELINE.md 이동
   - 146-165행 버그방지 정보 반드시 보존
   - 개발 주의사항 섹션 반드시 보존

## Phase 4 — 검토 권고 (선택)
9. VideoMaker/.claude/settings.local.json의 Read(//Users/hongss/.claude/**)를
   구체적 하위 경로로 분리 (rules/**, agents/**, skills/** 등)
10. VideoMaker/.claude/agents/rule-auditor.md 세부 내용을
    videomaker-ops/SKILL.md 규칙 감사 모드로 병합 후 파일 삭제

각 단계 완료 후 결과를 보고해줘.
```

---

## 부록: 반론 심사에서 뒤집힌 항목

> Adversarial Reviewer가 Refactor Planner의 오류 10건을 정정:

| 항목 | Planner 원래 권고 | 정정 후 | 오류 근거 |
|------|-----------------|---------|----------|
| `~/.claude/rules/typescript/` | DELETE (dormant) | **KEEP** | paths: frontmatter 존재 — 조건부 로딩 |
| `~/.claude/rules/python/` | DELETE | **KEEP** | 동일 |
| `~/.claude/rules/golang/` | DELETE | **KEEP** | 동일 |
| `~/.claude/rules/cpp/` | DELETE | **KEEP** | 동일 |
| `~/.claude/rules/dart/` | DELETE | **KEEP** | 동일 |
| `~/.claude/rules/java/` | DELETE | **KEEP** | 동일 |
| `~/.claude/rules/kotlin/` | DELETE | **KEEP** | 동일 |
| `~/.claude/rules/rust/` | DELETE | **KEEP** | 동일 |
| `~/.claude/rules/php/` | DELETE | **KEEP** | 동일 |
| `~/.claude/rules/csharp/` | DELETE | **KEEP** | 동일 |
| zh/ DELETE 근거 | "AGENTS.md @import로 무조건 로드" | DELETE 유지 (근거 수정) | AGENTS.md는 rules/를 import하지 않음. 올바른 근거: 이 사용자에게 불필요한 중국어 번역본 |
| videomaker-ops SPLIT | SPLIT → 두 스킬 분리 | **KEEP** (트리트닝만) | CLAUDE.md 7행 하드코딩 참조가 있어 분리 시 참조 깨짐 |
