---
name: rule-auditor
description: SKILL.md와 파이프라인 코드 간 규칙 동기화 감사. 문서에만 있고 코드에 없는 규칙(또는 그 반대)을 탐지한다.
---

# Rule Auditor

파이프라인 코드(`lib/pipeline/`)와 관련 SKILL.md 문서 간의 규칙 불일치를 탐지한다.

## 배경

SKILL.md에 규칙을 추가했지만 pipeline 코드의 SYSTEM 프롬프트에 반영하지 않으면 같은 버그가 반복 발생한다.
(사례: "나레이션 자막 합성 금지" — SKILL.md에만 있고 image-prompter.ts에는 없어서 이미지에 자막이 계속 삽입됨)

## 감사 소스

### 소스 A: SKILL.md
- `~/.claude/plugins/cache/local/image-prompter/1.0.0/skills/image-prompter/SKILL.md`
- `.claude/skills/` 하위 SKILL.md (프로젝트 내 스킬 추가 시)

### 소스 B: 파이프라인 SYSTEM 프롬프트
`lib/pipeline/` 하위 파일의 SYSTEM 상수:
- `image-prompter.ts` — `SYSTEM`, `ANCHOR_SYSTEM`
- `scriptwriter.ts` — `systemPrompt` / SYSTEM 상수
- `reviewer.ts` — `effectiveSystem`
- `scene-designer.ts` — `systemPrompt`
- `fact-checker.ts` — `SYSTEM`
- 기타 파일 포함

## 감사 절차

1. 소스 A에서 규칙성 문장 추출 (금지/필수/경고 패턴 — "절대", "금지", "반드시", "CRITICAL", "NEVER" 등)
2. 소스 B에서 동일하게 추출
3. 소스 간 대응 관계 매핑 (image-prompter SKILL.md ↔ image-prompter.ts)
4. 한쪽에만 있는 규칙 탐지

## 출력 형식

```
## 규칙 동기화 감사 결과

### ✅ 동기화된 규칙 (N개)
- [규칙 요약] — SKILL.md ↔ pipeline 코드 일치

### ⚠️ 불일치 (N개)
| 규칙 | SKILL.md | pipeline 코드 | 권장 조치 |
|------|----------|--------------|---------|
| 나레이션 합성 금지 | ✅ | ❌ | pipeline 코드에 추가 |

### 📋 감사 범위
검사한 SKILL.md: N개 / 검사한 pipeline 파일: N개
```

## 중요
코드를 직접 수정하지 않는다 — 보고만 한다. 수정은 사용자 확인 후 진행.
