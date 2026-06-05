@AGENTS.md

## 하네스: VideoMaker 맥 운영 자동화

**목표:** 세션 마무리 루틴(tsc → git push → Obsidian)과 규칙 동기화 감사 자동화

**트리거:** "깃 푸시", "옵시디언 업데이트", "세션 마무리", "규칙 감사" 등 운영 작업 요청 시 `videomaker-ops` 스킬을 사용하라.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-06-02 | 초기 구성 | 전체 | 세션 마무리·규칙 감사 자동화 |

---

# YouTube PD — 세션 컨텍스트

## 프로젝트 개요

유튜브 스토리텔링 채널용 **완전 자동화 영상 제작 파이프라인** (11단계).

- **스택**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4
- **실행**: `npm run dev` (포트 3000)
- **데이터**: `data/projects/{id}/` 폴더 (파일시스템 저장)
- **파이프라인·API·데이터 구조 상세**: `docs/PIPELINE.md` 참조

## 환경 변수

```env
ELEVENLABS_API_KEY=      # TTS 단계 (없으면 건너뜀)
FAL_API_KEY=             # 이미지/영상 생성 (없으면 건너뜀)
KLING_API_KEY=           # 영상 생성 폴백
```

> **AI 인증**: `ANTHROPIC_API_KEY`는 **선택적** — 설정 시 Anthropic SDK 직접 호출, 미설정 시 `claude CLI` spawn (CLI 자체 인증). `lib/pipeline/claude-runner.ts` 참조.

## 개발 시 주의사항

- **타입 체크**: `npx tsc --noEmit`
- Next.js 16 — App Router 전용, `node_modules/next/dist/docs/`에서 API 확인 필수
- `lib/project.ts`의 모든 파일 I/O 함수는 동기(sync) 방식
- 파이프라인은 `app/api/projects/[id]/run/route.ts`에서 백그라운드로 실행 (`runPipeline()` 호출 후 즉시 응답)
- 새 파이프라인 단계 추가 시 `lib/types.ts`의 `PipelineStatus`와 `lib/pipeline/index.ts` 오케스트레이터 모두 수정 필요
- **AI 호출**: 파이프라인 단계들은 Anthropic SDK가 아닌 `lib/pipeline/claude-runner.ts`를 통해 `claude CLI`를 자식 프로세스로 spawn — `ANTHROPIC_API_KEY`를 env에서 제거하고 CLI 자체 인증 사용
- `CLAUDE_BIN` 환경변수로 claude 바이너리 경로 지정 가능 (기본값: `/Users/hongss/.local/bin/claude`)
- 파이프라인 오케스트레이터는 6개 함수로 분리:
  - `runPipeline` — 리서치 → `waiting:youtube-urls` 게이트까지
  - `runPipelineFromYoutube` — 유튜브 분석 → 전략 → `waiting:concept` (youtube-urls/route.ts에서 호출)
  - `runPipelineFromPlanning` — 기획 → 검토 (concept/route.ts에서 호출)
  - `runPostScript` — TTS → 씬 → 이미지 프롬프트 → `waiting:cost-images`
  - `continueFromImages` — 영상 → 캡컷 (confirm-images/route.ts에서 호출)
  - `resumePipeline` — 파일 존재 여부로 재개 지점 판단 후 적절한 함수로 분기 (run/route.ts 재시작 시 호출)
- **에러 복구 패턴**: `project.lastStatus`에 에러 발생 직전 상태가 기록됨 — 복구 API/UI 로직은 이를 기반으로 단계 판단
- **`start-images`**: `error` 상태 + `image-prompts.md` 존재 시 자동 복구 후 이미지 생성 시작 (409 반환 안 함)
- **시간 힌트**: planner가 토픽에서 "1분"/"30초"/"2분" 키워드 감지 → 씬 수·예상 길이 자동 조정; scriptwriter는 narration을 brief.md 길이에 비례 생성 (1분=300자)
- **`parseConcepts`**: `lib/project.ts`에 위치 (pipeline 폴더 아님)
- **`done:strategy`**: `lib/types.ts`와 `page.tsx` UI에만 선언 — index.ts에서 실제로 set되지 않음 (strategy 후 바로 `waiting:concept`으로 전환)
- **`runImagesBackground`**: `lib/pipeline/index.ts`에서 export — image 관련 route에서 직접 호출
