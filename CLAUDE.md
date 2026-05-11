@AGENTS.md

# YouTube PD — 세션 컨텍스트

## 프로젝트 개요

유튜브 스토리텔링 채널용 **완전 자동화 영상 제작 파이프라인**.
주제 입력 → 리서치 → 전략 → 기획 → 대본 → 검토 → TTS → 씬설계 → 이미지프롬프트 → 이미지생성 → 영상생성 → 캡컷편집까지 11단계 자동 진행.

- **스택**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Anthropic SDK
- **실행**: `npm run dev` (포트 3000)
- **데이터 저장**: `data/projects/{id}/` 폴더 — 각 프로젝트는 파일시스템에 저장

## 파이프라인 단계

| 순서 | 상태 키 | 설명 | 출력 파일 |
|------|---------|------|-----------|
| 1 | `running:research` → `done:research` | 웹 리서치 | `research.md` |
| 2 | `running:strategy` → `waiting:concept` | 컨셉 전략 (사용자 선택 필요) | `strategy.md` |
| 3 | `running:planning` → `done:planning` | 기획서 작성 | `brief.md` |
| 4 | `running:scripting` → `done:scripting` | 대본 작성 | `script-final.md` |
| 5 | `running:review` → `waiting:confirm` | 대본 검토 (사용자 승인 필요) | `script-review.md` |
| 6 | `running:tts` → `done:tts` | TTS 음성 생성 | `audio/`, `subtitles/` |
| 7 | `running:scene` → `done:scene` | 씬 설계 | `scene-design.md` |
| 8 | `running:prompts` → `done:prompts` | 이미지 프롬프트 생성 | `image-prompts.md` |
| 9a | `done:prompts` → `waiting:reference` | 레퍼런스 이미지 업로드 대기 | `references/` |
| 9b | `running:images` → `waiting:images` | 이미지 생성 (사용자 확인 필요) | `images/` |
| 10 | `running:video` → `done:video` | 영상 클립 생성 | `video/` |
| 11 | `running:capcut` → `completed` | 캡컷 프로젝트 생성 | `capcut-project/` |

**사용자 개입 포인트**: `waiting:concept` (컨셉 선택), `waiting:confirm` (대본 승인), `waiting:reference` (레퍼런스 이미지 업로드), `waiting:images` (이미지 확인)

## 핵심 파일 위치

```
lib/
├── types.ts          # PipelineStatus, Project, SSEEvent 타입 정의
├── project.ts        # 파일시스템 CRUD — loadProject, saveProject, updateStatus, readFile, writeFile
├── events.ts         # SSE 이벤트 버스 — emit(projectId, event)
└── pipeline/
    ├── index.ts      # 파이프라인 오케스트레이터 (runPipeline)
    ├── researcher.ts / strategist.ts / planner.ts / scriptwriter.ts
    ├── reviewer.ts / script-reviser.ts / tts.ts / scene-designer.ts
    ├── image-prompter.ts / image-generator.ts / video-generator.ts
    └── capcut-editor.ts

app/
├── page.tsx                         # 홈 — 프로젝트 목록 + 생성
├── projects/[id]/page.tsx           # 프로젝트 상세 — 파이프라인 진행 UI
└── api/projects/
    ├── route.ts                     # GET (목록), POST (생성)
    └── [id]/
        ├── route.ts                 # GET (조회), DELETE (삭제)
        ├── run/route.ts             # POST — 파이프라인 시작
        ├── stream/route.ts          # GET — SSE 스트림
        ├── concept/route.ts         # POST — 컨셉 선택
        ├── confirm/route.ts         # POST — 대본 승인
        ├── apply-review/route.ts    # POST — 검토 반영 재작성
        ├── start-tts/route.ts       # POST — TTS 시작
        ├── confirm-images/route.ts  # POST — 이미지 확인 후 영상 단계
        ├── start-images/route.ts    # POST — 레퍼런스 업로드 후 이미지 생성 시작
        ├── reference/route.ts       # POST — 레퍼런스 이미지 업로드
        ├── regenerate-images/route.ts # POST — 이미지 재생성
        ├── regenerate-prompts/route.ts # POST — 프롬프트 재생성
        ├── regenerate-concepts/route.ts # POST — 컨셉 재생성 (waiting:concept 상태에서만)
        ├── restore-status/route.ts  # POST — 상태 복구
        ├── files/route.ts           # GET — 프로젝트 산출물 파일 목록
        └── media/route.ts           # GET — 미디어 파일 서빙
```

## 데이터 모델

```
data/projects/{project-id}/
├── state.json          # Project 객체 (status, topic, concepts, reviewScore 등)
├── research.md
├── strategy.md
├── brief.md / concept.md
├── script-final.md
├── script-review.md
├── scene-design.md
├── image-prompts.md
├── audio/              # TTS 오디오
├── images/             # 생성된 이미지
├── video/              # 생성된 영상 클립
└── capcut-project/     # 캡컷 프로젝트 JSON
```

프로젝트 ID는 토픽을 슬러그화한 폴더명 (예: `조선시대-왕들의-충격적인-죽음`).

## 실시간 통신

- **SSE** (`/api/projects/[id]/stream`): 파이프라인 진행 로그를 클라이언트에 스트리밍
- `lib/events.ts`의 `emit(projectId, SSEEvent)` 사용
- 프론트엔드 `app/projects/[id]/page.tsx`에서 `EventSource`로 수신

## 환경 변수

```env
ANTHROPIC_API_KEY=       # 필수 — Claude 모델 호출
ELEVENLABS_API_KEY=      # TTS 단계 (없으면 건너뜀)
FAL_API_KEY=             # 이미지/영상 생성 (없으면 건너뜀)
KLING_API_KEY=           # 영상 생성 폴백
```

## UI 디자인 시스템

다크모드 전용. CSS 변수는 `app/globals.css`에 정의:
- `--bg` `--surface` `--surface-2` `--border` `--text` `--text-muted`
- `--accent` (#7c6fff) `--success` `--warning` `--error`
- 컴포넌트 클래스: `.card` `.btn` `.btn-primary` `.btn-outline` `.badge` `.stage-node-*`

## 개발 시 주의사항

- **타입 체크**: `npx tsc --noEmit`
- Next.js 16 — App Router 전용, `node_modules/next/dist/docs/`에서 API 확인 필수
- `lib/project.ts`의 모든 파일 I/O 함수는 동기(sync) 방식
- 파이프라인은 `app/api/projects/[id]/run/route.ts`에서 백그라운드로 실행 (`runPipeline()` 호출 후 즉시 응답)
- 새 파이프라인 단계 추가 시 `lib/types.ts`의 `PipelineStatus`와 `lib/pipeline/index.ts` 오케스트레이터 모두 수정 필요
- **AI 호출**: 파이프라인 단계들은 Anthropic SDK가 아닌 `lib/pipeline/claude-runner.ts`를 통해 `claude CLI`를 자식 프로세스로 spawn — `ANTHROPIC_API_KEY`를 env에서 제거하고 CLI 자체 인증 사용
- `CLAUDE_BIN` 환경변수로 claude 바이너리 경로 지정 가능 (기본값: `/Users/hongss/.local/bin/claude`)
- 파이프라인 오케스트레이터는 4개 함수로 분리: `runPipeline` (리서치~컨셉), `runPipelineFromPlanning` (기획~검토), `runPostScript` (TTS~이미지), `continueFromImages` (영상~캡컷)
- **에러 복구 패턴**: `project.lastStatus`에 에러 발생 직전 상태가 기록됨 — 복구 API/UI 로직은 이를 기반으로 단계 판단
- **`start-images`**: `error` 상태 + `image-prompts.md` 존재 시 `waiting:reference`로 자동 복구 후 이미지 생성 시작 (409 반환 안 함)
- **시간 힌트**: planner가 토픽에서 "1분"/"30초"/"2분" 키워드 감지 → 씬 수·예상 길이 자동 조정; scriptwriter는 narration을 brief.md 길이에 비례 생성 (1분=300자)
- **`parseConcepts`**: `lib/project.ts`에 위치 (pipeline 폴더 아님)
- **`runImagesBackground`**: `lib/pipeline/index.ts`에서 export — image 관련 route에서 직접 호출
