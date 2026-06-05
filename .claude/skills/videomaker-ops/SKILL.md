---
name: videomaker-ops
description: VideoMaker 세션 마무리(tsc → git push → Obsidian) 또는 규칙 동기화 감사. "깃 푸시", "세션 마무리", "옵시디언 업데이트", "규칙 감사" 요청 시 사용.
---

# VideoMaker Ops

맥 전용 두 가지 운영 모드.

## 모드 판별

요청 내용에 따라 모드를 선택한다:

| 키워드 | 모드 |
|--------|------|
| 깃 푸시, 세션 마무리, 옵시디언 업데이트 | → 세션 마무리 |
| 규칙 감사, SKILL 감사 | → 규칙 감사 |
| 둘 다 언급 | → 세션 마무리 먼저, 규칙 감사 이어서 |

## 사용하지 말아야 할 때

- "마무리"만 단독으로 언급된 경우 (대화 마무리·코드 마무리 등 맥락 불명확)
- "동기화 확인", "규칙 체크" 등 일반적인 코드 리뷰 맥락
- 이 프로젝트 외 다른 저장소에서 실행 중인 경우

---

## 모드 1: 세션 마무리

다음 절차를 순서대로 실행한다.

### 실행 순서

**Step 1 — tsc 검증**
```bash
cd /Users/hongss/VideoMaker && npx tsc --noEmit
```
오류 있으면 중단하고 오류 내용 보고.

**Step 2 — Git push**
```bash
git status
git log --oneline -5
```
커밋할 변경이 있으면 사용자에게 확인 후 커밋. 이후 `git push`.

**Step 3 — Obsidian 업데이트**

오늘 작업 파악:
- `git log --oneline --since="today"` 로 오늘 커밋 목록
- `git show {hash}` 로 변경 내용 확인
- 대화 컨텍스트에서 코드 외 작업(환경변수·설정 변경 등) 파악

업데이트 파일:
- `00_Claude/sessions/YYYY-MM-DD.md` — 없으면 생성, 있으면 새 섹션 append
- `01_Projects/VideoMaker/작업일지/YYYY-MM-DD.md` — 없으면 생성, 있으면 새 섹션 append

볼트 경로: `/Users/hongss/Documents/Obisidian/saint0221/`

작성 시 기존 파일을 먼저 읽고, 이미 기록된 내용과 중복되지 않는 것만 추가한다.

---

## 모드 2: 규칙 동기화 감사

### 배경

SKILL.md에 규칙을 추가한 후 파이프라인 SYSTEM 프롬프트에 반영하지 않으면 동일 버그가 반복된다. (사례: `image-prompter.ts`의 나레이션 자막 합성 금지 규칙이 SKILL.md에는 있었지만 SYSTEM 프롬프트에 없어서 이미지에 텍스트가 계속 렌더링됐던 문제)

코드를 직접 수정하지 않는다 — 불일치를 보고만 한다.

### 감사 소스

**소스 A (SKILL.md):**
- `/Users/hongss/.claude/plugins/cache/local/image-prompter/1.0.0/skills/image-prompter/SKILL.md`

**소스 B (pipeline SYSTEM 프롬프트):**
- `/Users/hongss/VideoMaker/lib/pipeline/image-prompter.ts` — `SYSTEM`, `ANCHOR_SYSTEM`
- `/Users/hongss/VideoMaker/lib/pipeline/scriptwriter.ts`
- `/Users/hongss/VideoMaker/lib/pipeline/reviewer.ts`
- `/Users/hongss/VideoMaker/lib/pipeline/scene-designer.ts`
- `/Users/hongss/VideoMaker/lib/pipeline/fact-checker.ts`

### 실행 절차

1. 소스 A, B 파일 읽기
2. 규칙성 문장 추출 ("절대", "금지", "반드시", "CRITICAL", "NEVER", "🚫" 등 키워드 기준)
3. 대응 관계 매핑 후 불일치 탐지
4. 결과 보고 (코드 수정 없이 보고만)

### 출력 형식

```
## 규칙 동기화 감사 결과

### ✅ 동기화된 규칙
(항목 없으면 "없음")

### ⚠️ 불일치
| SKILL.md 규칙 | pipeline 파일 | 상태 |
|--------------|--------------|------|

### 📋 감사 범위
(감사한 파일 목록)
```

---

## 맥 전용 경로
- Obsidian 볼트: `/Users/hongss/Documents/Obisidian/saint0221/`
- SKILL.md 캐시: `/Users/hongss/.claude/plugins/cache/local/`
