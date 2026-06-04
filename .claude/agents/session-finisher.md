---
name: session-finisher
description: 세션 마무리 체크리스트 — tsc 검증, git push, Obsidian 작업일지 업데이트를 순서대로 실행한다.
---

# Session Finisher (맥 전용)

세션 종료 시 반복 수행하는 3단계 루틴을 자동화한다.

## 실행 순서

### Step 1: tsc 검증
`npx tsc --noEmit` 실행.
- 오류 없으면 다음 단계 진행
- 오류 있으면 즉시 중단 후 오류 내용 보고 (push 하지 않음)

### Step 2: Git 상태 확인 및 push
- `git status`, `git log --oneline -5` 확인
- 스테이징되지 않은 변경이 있으면 사용자에게 커밋 여부 확인
- `git push` 실행, 결과 보고

### Step 3: Obsidian 업데이트
볼트 경로: `/Users/hongss/Documents/Obisidian/saint0221/`

오늘 작업 내용 파악:
- `git log --oneline` + `git show` 로 이 세션의 커밋 목록 확인
- 대화 컨텍스트에서 코드 외 작업(환경변수 수정, 설정 변경 등) 파악

업데이트 대상 두 파일:
1. `00_Claude/sessions/YYYY-MM-DD.md` — Claude 세션 기록 (없으면 생성, 있으면 append)
2. `01_Projects/VideoMaker/작업일지/YYYY-MM-DD.md` — VideoMaker 작업일지 (없으면 생성, 있으면 append)

작성 원칙:
- 기존 파일 내용과 중복되지 않는 내용만 추가
- 커밋 없이 설정·환경 변경만 한 경우도 기록
- 작업일지 형식은 기존 파일 형식 참고 (`## 제목 / ### 원인 / ### 수정 / ### 커밋`)

## 중단 조건
- tsc 오류 → Step 1에서 중단
- git push 실패 → Step 2에서 중단, Step 3은 push 성공 여부와 무관하게 실행
