---
title: VideoMaker (YouTube PD) 프로젝트 분석
type: 코드 리뷰 / 교육 발표 자료
created: 2026-05-29
tags: [코드리뷰, 아키텍처, nextjs, ai-pipeline, youtube]
---

# VideoMaker (YouTube PD) 프로젝트 분석

> [!abstract] 한 줄 요약
> **주제 한 줄을 입력하면 → 리서치 → 전략 → 기획 → 대본 → 검수 → TTS → 씬 설계 → 이미지/영상 생성 → CapCut 편집 프로젝트 생성까지** 영상 제작 전 과정을 자동화하는 Next.js 기반 AI 오케스트레이션 애플리케이션. 11개의 AI "에이전트(스킬)"가 파일시스템을 매개로 순차 협업하고, 진행 상황은 SSE로 실시간 스트리밍된다.

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| 정식 명칭 | **YouTube PD** (패키지명 `videomaker-app`) |
| 목적 | 유튜브 스토리텔링 채널용 **완전 자동화 영상 제작 파이프라인** |
| 핵심 가치 | 한 사람이 PD·작가·성우·편집자 역할을 모두 AI에게 위임 |
| 입력 | 영상 주제 한 줄 (예: "노시보 효과 1분 영상") |
| 최종 산출물 | CapCut(캡컷)에서 바로 열리는 편집 프로젝트 + 모든 중간 산출물(대본·오디오·자막·이미지·영상 클립) |
| 실행 방식 | 로컬 웹앱 (`npm run dev`, 포트 3000) — 사용자 PC의 CapCut 폴더에 직접 프로젝트를 생성 |
| 현재 규모 | 소스 약 5,500줄(lib) + 2,100줄(app), 데이터 폴더에 13개 실제 프로젝트 존재 |

---

## 2. 기술 스택

### 2.1 언어 / 프레임워크

전체가 **TypeScript** 단일 언어로 작성되어 있다. 프론트엔드(React 컴포넌트)와 백엔드(API Route, 파이프라인 로직)가 하나의 언어·하나의 코드베이스로 통합된 **풀스택 TypeScript** 구조다.

| 분류 | 기술 | 버전 |
|------|------|------|
| 언어 | TypeScript | 5.9.3 |
| 프레임워크 | Next.js (App Router 전용) | 16.2.4 |
| UI 라이브러리 | React / React DOM | 19.2.4 |
| 스타일 | Tailwind CSS (v4, PostCSS 플러그인 방식) | ^4 |
| 린트 | ESLint + eslint-config-next | ^9 |
| 런타임 | Node.js (Next.js 서버 런타임) | — |

> [!note] "이건 당신이 알던 Next.js가 아닙니다"
> `AGENTS.md` 첫머리에 명시된 경고. Next.js 16은 App Router 전용이며 기존 버전과 API·관례·파일 구조가 다르다. 프레임워크 동작 확인 시 `node_modules/next/dist/docs/`를 직접 참조하도록 규칙화되어 있다.

### 2.2 주요 의존성

| 패키지 | 용도 |
|--------|------|
| `@anthropic-ai/sdk` (^0.92.0) | Claude API 직접 호출(SDK 모드) |
| `@aws-sdk/client-s3` (^3.x) | 프로젝트 산출물 S3 백업/복원 (선택적) |
| `@fal-ai/client` (^1.10.1) | fal.ai 이미지/영상 생성 |
| `marked` (^18) | 클라이언트에서 마크다운 산출물 렌더링 |
| `uuid` (^14) | 식별자 생성 |
| `sharp` (동적 import) | 이미지 위에 텍스트 합성(자막/타이틀) |

### 2.3 외부 서비스 통합

| 서비스 | 역할 | 인증/엔드포인트 | 미설정 시 |
|--------|------|------------------|-----------|
| **Claude** (Anthropic) | 모든 텍스트 생성 단계의 두뇌 | SDK(`ANTHROPIC_API_KEY`) 또는 `claude` CLI | CLI 자체 인증 사용 |
| **Tavily** | 리서치 단계 웹 검색 | `TAVILY_API_KEY`, `api.tavily.com/search` | 검색 생략, LLM 지식만 사용 |
| **ElevenLabs** | TTS 음성 생성 + 문자 단위 정렬(자막) | `ELEVENLABS_API_KEY`, `api.elevenlabs.io/v1/text-to-speech` | TTS 단계 건너뜀 |
| **fal.ai** | 이미지 생성(FLUX/SDXL 계열) | `FAL_API_KEY`, `fal.run`, `rest.fal.ai` | 이미지 단계 건너뜀 |
| **Kling** (fal.ai 경유) | 이미지 → 영상 클립 생성 | `queue.fal.run/fal-ai/kling-video/v2.1` | 영상 단계 건너뜀 |
| **CapCut / CapCut** | 최종 편집 프로젝트 출력 대상 | 로컬 드래프트 폴더에 직접 JSON 기록 | — |
| **AWS S3** | 산출물 원격 백업·복원 | `S3_BUCKET`, `AWS_REGION` | 로컬 파일시스템만 사용 |
| **ffmpeg / ffprobe** | 영상 길이·해상도 조회, 마지막 프레임 추출 | 시스템 바이너리(`execSync`) | — |

> [!tip] 설계 철학 — "있으면 쓰고, 없으면 우아하게 건너뛴다"
> 거의 모든 외부 의존성이 **선택적(optional)**이다. API 키가 없으면 해당 단계를 건너뛰거나 대체 경로(degrade)로 동작한다. 데모/개발 환경과 운영 환경을 같은 코드로 커버하기 위한 의도된 설계.

---

## 3. 전체 폴더 구조

```
VideoMaker/
├── app/                          # Next.js App Router (프론트 + API)
│   ├── layout.tsx                # 루트 레이아웃
│   ├── page.tsx                  # 홈 — 프로젝트 목록/생성, 설정(656줄)
│   ├── globals.css               # 다크모드 디자인 시스템(CSS 변수)
│   ├── projects/[id]/page.tsx    # 프로젝트 상세 — 파이프라인 진행 UI(1,457줄)
│   └── api/                      # 백엔드 엔드포인트 (REST + SSE)
│       ├── projects/route.ts             # GET 목록 / POST 생성
│       ├── projects/[id]/route.ts        # GET 조회 / DELETE 삭제
│       ├── projects/[id]/run/route.ts    # 파이프라인 시작/재개
│       ├── projects/[id]/stream/route.ts # SSE 실시간 스트림
│       ├── projects/[id]/concept|confirm|apply-review/...   # 사용자 게이트 처리
│       ├── projects/[id]/start-tts|start-images|confirm-images/...
│       ├── projects/[id]/regenerate-*    # 각 단계 재생성(이미지/프롬프트/씬/TTS/캡컷/컨셉)
│       ├── projects/[id]/files|media|images/route.ts        # 산출물 서빙
│       ├── cost-log/route.ts             # 비용 로그 조회
│       └── settings/...                  # CapCut 경로·음성(보이스) 설정
│
├── lib/                          # 핵심 비즈니스 로직 (프레임워크 비의존)
│   ├── types.ts                  # PipelineStatus, Project, SSEEvent 등 타입 단일 정의처
│   ├── project.ts                # 파일시스템 CRUD + 슬러그·비용·복구 헬퍼(240줄)
│   ├── events.ts                 # 인메모리 SSE 이벤트 버스(EventEmitter)
│   ├── settings.ts               # CapCut 경로/보이스 설정 영속화
│   ├── s3.ts                     # S3 백업/복원 (선택적)
│   └── pipeline/                 # ★ AI 파이프라인 단계들(=스킬) + 오케스트레이터
│       ├── index.ts              # 오케스트레이터: 상태 머신 + 6개 진입 함수(563줄)
│       ├── claude-runner.ts      # Claude 호출 추상화(SDK/CLI 이중 모드, 264줄)
│       ├── researcher.ts         # ① 리서치 (Tavily + Sonnet)
│       ├── youtube-analyzer.ts   # ② 유튜브 채널 분석
│       ├── strategist.ts         # ③ 컨셉 전략 (Opus)
│       ├── planner.ts            # ④ 기획서 (Sonnet)
│       ├── scriptwriter.ts       # ⑤ 대본 (Opus)
│       ├── fact-checker.ts       # ⑥ 팩트 체크 (Sonnet)
│       ├── reviewer.ts           # ⑦ 대본 검수 (Sonnet)
│       ├── script-reviser.ts     # ⑦' 자동 수정 (Opus)
│       ├── tts.ts                # ⑧ TTS + SRT 자막 (ElevenLabs)
│       ├── scene-designer.ts     # ⑨ 씬 설계 (Sonnet)
│       ├── image-prompter.ts     # ⑩ 이미지 프롬프트 (Haiku/Sonnet)
│       ├── image-generator.ts    # ⑪ 이미지 생성 (fal.ai, 455줄)
│       ├── video-generator.ts    # ⑫ 영상 클립 생성 (Kling, 267줄)
│       ├── capcut-editor.ts      # ⑬ CapCut 프로젝트 빌더 (1,430줄 — 최대 모듈)
│       └── utils.ts              # fal 업로드 등 공용 유틸
│
├── data/                         # 런타임 데이터 (git 무시 대상)
│   ├── projects/{slug}/          # 프로젝트별 산출물 폴더 (13개 존재)
│   ├── settings.json             # 전역 설정
│   └── cost-log.json             # 비용 로그
│
├── docs/                         # 설계 문서·스크린샷
├── public/                       # 정적 에셋(SVG 아이콘)
├── redo-*.ts                     # 단발성 재처리 스크립트(capcut/tts/images)
├── CLAUDE.md / AGENTS.md         # AI 에이전트 운영 컨텍스트
├── README.md / EC2_DEPLOYMENT_GUIDE.md
├── deploy.sh / start.sh          # 배포·기동 스크립트
└── (설정) package.json, tsconfig.json, next.config.ts, eslint.config.mjs, postcss.config.mjs
```

> [!info] 레이어 분리
> `lib/`는 Next.js에 거의 의존하지 않는 **순수 도메인 로직** 계층이고, `app/`은 그 위에 얇게 올라간 **전달(transport) 계층**이다. API Route는 대부분 "권한·상태 검증 → `lib/pipeline`의 함수 호출 → 즉시 응답"의 수 줄짜리 어댑터다. 이 분리 덕분에 파이프라인을 CLI 스크립트(`redo-*.ts`)에서도 재사용할 수 있다.

---

## 4. 아키텍처 설계

### 4.1 큰 그림

```
┌──────────────────────────────────────────────────────────────┐
│  브라우저 (React 19, 'use client')                              │
│  - 홈: 프로젝트 목록/생성   - 상세: 파이프라인 진행 UI            │
│  - EventSource 로 SSE 구독 → 실시간 로그/상태/비용 표시           │
└───────────────┬───────────────────────────▲───────────────────┘
        REST(POST/GET)                  SSE(text/event-stream)
                │                             │
┌───────────────▼─────────────────────────────┴──────────────────┐
│  Next.js API Routes (app/api) — 얇은 어댑터                      │
│  run/route.ts: 파이프라인을 await 하지 않고 백그라운드 실행        │
│  stream/route.ts: events 버스를 구독해 클라이언트로 중계          │
└───────────────┬─────────────────────────────▲──────────────────┘
                │ 함수 호출                      │ emit(projectId, event)
┌───────────────▼─────────────────────────────┴──────────────────┐
│  lib/pipeline/index.ts — 오케스트레이터(상태 머신)               │
│  단계 함수 순차 호출 → updateStatus() + emit() 반복               │
└───┬───────────────┬───────────────┬───────────────┬────────────┘
    │               │               │               │
┌───▼───┐     ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼──────┐
│claude- │     │ ElevenLabs│   │  fal.ai   │   │  CapCut    │
│runner  │     │   (TTS)   │   │ /Kling    │   │  draft     │
│(Claude)│     └───────────┘   └───────────┘   └────────────┘
└────────┘
                │ 모든 산출물 read/writeFile
┌───────────────▼────────────────────────────────────────────────┐
│  data/projects/{id}/  (파일시스템 = 단일 진실 공급원, S3 선택백업) │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 핵심 아키텍처 패턴

**(1) 파일시스템을 단일 진실 공급원(Single Source of Truth)으로 삼는 파이프라인**
DB가 없다. 각 단계의 산출물은 `data/projects/{id}/`에 `.md`/`.json`/미디어 파일로 떨어지고, 다음 단계는 이전 단계가 남긴 파일을 **다시 읽어서** 입력으로 쓴다. 프로젝트의 메타 상태는 `state.json`(`Project` 객체)에 저장된다. 이 설계의 핵심 이점은 **재개 가능성(resumability)** — 어느 파일까지 존재하는지만 보면 어디서 끊겼는지 알 수 있다.

**(2) "Fire-and-forget" 백그라운드 실행 + SSE 진행 보고**
`run/route.ts`는 `runPipeline(id)`를 `await`하지 않고 호출만 한 뒤 즉시 `{ started: true }`로 응답한다. 실제 작업은 서버 프로세스 안에서 비동기로 계속 돌고, 진행 상황은 `lib/events.ts`의 인메모리 `EventEmitter`를 통해 `emit()`된다. 클라이언트는 `/stream` 엔드포인트(`ReadableStream` 기반 SSE)를 `EventSource`로 구독해 로그·상태·비용·이미지 이벤트를 실시간 수신한다. 15초 하트비트로 연결을 유지하고, `done` 이벤트 수신 시 스트림을 닫는다.

**(3) 상태 머신 + 사용자 개입 게이트(human-in-the-loop)**
`PipelineStatus`는 `running:*` / `done:*` / `waiting:*` 형태의 문자열 유니온 타입(약 30개 상태)이다. 자동 진행 도중 사람의 판단이 필요한 지점에서 `waiting:*`로 멈추고 SSE로 `done`을 보내 제어권을 사용자에게 넘긴다. 사용자가 해당 게이트의 API(예: `concept`, `confirm`)를 호출하면 그 지점부터 후속 함수가 다시 백그라운드로 실행된다.

| 게이트 | 의미 | 해제 API |
|--------|------|----------|
| `waiting:youtube-urls` | 유튜브 채널 URL 입력(생략 가능) | `youtube-urls` |
| `waiting:concept` | 3개 컨셉 중 택1 | `concept` |
| `waiting:confirm` | 대본 최종 승인(80점 미만 재수정 후에만) | `confirm` |
| `waiting:cost-images` | 이미지 생성 비용 미리보기 확인 | `confirm-cost` |
| `waiting:reference` | 레퍼런스 이미지 업로드 | `start-images` |
| `waiting:sample-images` | 샘플 3장 확인 후 전체 생성 | `confirm-samples` |
| `waiting:images` | 생성 이미지 확인 후 영상 단계로 | `confirm-images` |

**(4) 6개 진입점으로 분리된 오케스트레이터**
하나의 거대한 함수가 아니라, 각 사용자 게이트 이후 구간을 별도 export 함수로 나눴다. API Route가 게이트별로 적절한 함수를 호출한다.

| 함수 | 담당 구간 | 호출 위치 |
|------|-----------|-----------|
| `runPipeline` | 리서치 → `waiting:youtube-urls` | run(신규) |
| `runPipelineFromYoutube` | 유튜브 분석 → 전략 → `waiting:concept` | youtube-urls |
| `runPipelineFromPlanning` | 기획 → 대본 → 팩트체크 → 검수 | concept |
| `runPostScript` | TTS → 씬 → 프롬프트 → `waiting:cost-images` | confirm |
| `continueFromImages` | 영상 → CapCut → `completed` | confirm-images |
| `resumePipeline` | 파일 존재 여부로 재개 지점 판단 후 분기 | run(error 상태) |

**(5) 에러 복구 — `lastStatus` 기반 재개**
`updateStatus()`가 `error`로 전환될 때 직전 상태를 `project.lastStatus`에 보존한다. 재실행 시 `resumePipeline()`이 산출물 파일들의 존재 여부를 위에서 아래로 점검하며 "어디까지 끝났는지"를 역추적해, 완료된 단계는 건너뛰고 끊긴 지점부터 이어서 실행한다. 비싼 LLM/이미지/영상 호출을 중복 과금 없이 재개할 수 있게 하는 핵심 메커니즘이다.

### 4.3 UI 디자인 시스템

다크모드 전용. `app/globals.css`에 CSS 변수(`--bg`, `--surface`, `--border`, `--text`, `--accent #7c6fff`, `--success/warning/error`)와 컴포넌트 클래스(`.card`, `.btn`, `.btn-primary`, `.badge`, `.stage-node-*`)를 정의한다. 상세 페이지는 `marked`로 각 단계 마크다운 산출물을 렌더링하고, 파이프라인 단계를 노드 그래프 형태로 시각화한다.

---

## 5. AI 파이프라인 단계 (= "스킬") 상세

각 단계는 독립 모듈로, 대부분 **(고정된 시스템 프롬프트) + (이전 산출물 주입) → `runClaude()` 호출 → `.md` 저장 → SSE 로그** 패턴을 따른다. 단계별로 비용/품질 균형을 고려해 모델을 다르게 배정한 점이 특징이다.

| # | 단계(스킬) | 모듈 | 모델 | 입력 | 출력 |
|---|-----------|------|------|------|------|
| 1 | 리서치 | researcher.ts | **Sonnet** + Tavily 4회 검색 | 토픽 | `research.md` |
| 2 | 유튜브 분석 | youtube-analyzer.ts | Sonnet | 토픽, (URL) | `youtube-analysis.md` |
| 3 | 컨셉 전략 | strategist.ts | **Opus** | research, youtube | `strategy.md` (컨셉 3안) |
| 4 | 기획서 | planner.ts | Sonnet | concept, research | `brief.md` (씬 구조) |
| 5 | 대본 | scriptwriter.ts | **Opus** | brief, research, youtube | `script-final.md` |
| 6 | 팩트 체크 | fact-checker.ts | Sonnet | script, research | `fact-check.md` |
| 7 | 대본 검수 | reviewer.ts | Sonnet | script, brief, factcheck | `script-review.md` (점수/100) |
| 7' | 자동 수정 | script-reviser.ts | **Opus** | script, review | `script-final.md`(갱신) |
| 8 | TTS | tts.ts | ElevenLabs | script | `audio/`, `subtitles/`(SRT) |
| 9 | 씬 설계 | scene-designer.ts | Sonnet | script, brief | `scene-design.md` |
| 10 | 이미지 프롬프트 | image-prompter.ts | Haiku+Sonnet | scene, script | `image-prompts.md` |
| 11 | 이미지 생성 | image-generator.ts | fal.ai(FLUX 등) | prompts | `images/` |
| 12 | 영상 생성 | video-generator.ts | Kling v2.1 | images | `videos/` |
| 13 | CapCut 빌드 | capcut-editor.ts | (Sonnet 보조) | 전체 | `capcut-project/` |

### 5.1 단계별 핵심 포인트

**리서치 (researcher.ts)** — Tavily로 토픽을 4가지 각도(`토픽`, `역사 배경`, `진실 비밀`, `알려지지 않은 사실`)로 검색한 뒤, 검색 결과를 컨텍스트로 주입해 Sonnet이 "핵심 사실 / 드라마틱한 순간 / 숨겨진 디테일 / 유사 콘텐츠 분석 / 출처" 구조의 리서치 보고서를 생성한다. 출처 불명 정보는 `[미확인]`으로 표기하도록 규칙화.

**대본 (scriptwriter.ts)** — 가장 정교한 시스템 프롬프트를 가진 단계(약 145줄). "1분 안에 주제 완전 전달 / 친구에게 말하듯 구어체 / 도입 3초 훅 / 금지 패턴(논문체 접속어·예고형 오프닝) / 감정 아크 / TTS 친화 규칙"까지 작가 가이드라인을 코드에 내장했다. 분량은 `brief.md`의 예상 길이에 비례(1분 ≈ 300자)하도록 강제. 품질이 중요한 만큼 **Opus**를 사용.

**검수 → 자동 수정 루프 (reviewer + script-reviser + runRevisionLoop)** — 검수자가 100점 만점 점수를 매기고, `parseReviewScore()`로 점수와 판정을 파싱한다. **80점 미만이거나 "🔴 필수 수정" 항목이 있으면** 최대 3회 자동 수정 루프를 돈다. 점수 개선이 없으면(`score <= prevScore`) 루프를 조기 종료한다. 80점 이상·필수 수정 없음이면 사람 승인 없이 자동 확정해 다음 단계로 진행 — **품질 게이트와 자동화의 균형**을 보여주는 핵심 로직.

**TTS (tts.ts)** — ElevenLabs로 씬별 나레이션을 음성화하고, 반환되는 **문자 단위 타임스탬프(alignment)**를 단어→세그먼트(최대 4단어/3초)로 묶어 SRT 자막으로 변환한다. 한국어/ASCII 따옴표 제거, "(없음)" 마커 스킵 등 파싱 방어 로직이 꼼꼼하다.

**이미지 생성 (image-generator.ts)** — 6종 fal.ai 모델을 모델별 단가(`MODEL_PRICE`, $0.0025~$0.035)와 함께 지원하고 LoRA(트리거 워드 주입)도 다룬다. 먼저 **샘플 3장**(`SAMPLE_COUNT`)만 생성해 사용자 확인을 받는 게이트가 있어 비용 낭비를 막는다. `sharp`로 이미지 위에 타이틀/자막 텍스트를 합성한다.

**영상 생성 (video-generator.ts)** — fal.ai 큐 API로 Kling v2.1에 이미지→영상(5초, 종횡비 16:9/9:16) 요청을 제출하고 5초 간격으로 최대 180회(15분) 폴링한다.

**CapCut 빌드 (capcut-editor.ts, 1,430줄)** — 프로젝트에서 가장 크고 복잡한 모듈. `ffprobe`로 클립 길이·해상도를 읽고, `ffmpeg`로 마지막 프레임을 추출하며, SRT를 마이크로초 단위로 파싱해 CapCut 드래프트 JSON(대문자 UUID 규약)을 직접 조립한다. 즉, 영상 편집기의 프로젝트 파일 포맷을 코드로 역설계해 생성하는 부분이다.

---

## 6. 핵심 공용 모듈 심층 분석

### 6.1 `claude-runner.ts` — Claude 호출 이중 모드 추상화

이 프로젝트에서 **가장 영리한 설계 결정**. `runClaude()`는 환경에 따라 두 경로로 분기한다.

- `ANTHROPIC_API_KEY`가 있으면 → **SDK 모드**(`runClaudeSDK`): 스트리밍으로 호출하고 `usage` 토큰을 받아 **정확한 비용**을 계산. 시스템 프롬프트/긴 접두부에 **프롬프트 캐싱**(`cache_control: ephemeral`)을 적용해 반복 호출 비용을 절감.
- 키가 없으면 → **CLI 모드**(`runCLI`): `claude` 바이너리를 자식 프로세스로 `spawn`하고 환경에서 `ANTHROPIC_API_KEY`를 **의도적으로 제거**해 CLI 자체 인증(구독 로그인)을 사용. 이 경우 비용은 문자 수 ÷ 3 추정치로 계산.

모델 상수(`MODEL.OPUS/SONNET/HAIKU`)와 단가표(`PRICING`)를 내장하고, 호출마다 `addLlmCost()`로 누적 비용을 갱신한 뒤 `llm-cost` SSE 이벤트를 발행한다. 이미지 입력 버전(`runClaudeWithImage`)도 SDK/CLI 양쪽을 지원한다. 타임아웃·SIGTERM·중복 resolve 방지 등 자식 프로세스 제어가 견고하다.

### 6.2 `project.ts` — 영속화 계층

- **슬러그 기반 ID**: 토픽 문자열을 파일명 안전 슬러그로 변환(`slugify`)하고 충돌 시 `-2`, `-3` 접미사(`uniqueSlug`).
- **동기(sync) 파일 I/O**: 모든 read/write가 `fs.*Sync`. 단일 사용자 로컬 앱 전제의 단순화 선택.
- **S3 미러링**: `writeFile`/`saveProject`가 로컬 기록과 동시에 `uploadToS3`를 호출(버킷 미설정 시 no-op). `loadProjectWithS3Fallback`으로 로컬에 없으면 S3에서 복원.
- **비용 집계**: `addLlmCost`(누적), `appendCostLog`/`readCostLog`(이미지·영상 단가 로그), `writeCostReport`(LLM+이미지+영상 합산 `cost-report.json` 생성).
- **파싱 헬퍼**: `parseConcepts`(전략 MD에서 컨셉 추출 — 정규식 기반, 폴백 패턴 보유), `parseReviewScore`(점수/판정 추출).

### 6.3 `events.ts` — SSE 이벤트 버스

단 18줄. Node `EventEmitter` 하나에 `project:{id}` 채널을 두고 `emit`/`subscribe`를 제공. 리스너 한도를 100으로 올리고, 리스너 오류가 파이프라인으로 전파되지 않도록 `try/catch`로 격리. 단순하지만 **프로세스 내 동일 서버**라는 전제에서 충분히 동작한다(주의: 다중 인스턴스 수평 확장 시에는 외부 pub/sub 필요 — 8장 참고).

### 6.4 타입 시스템 (`types.ts`)

`PipelineStatus`(약 30개 상태 유니온), `Project`(상태·컨셉·LoRA·비용·종횡비·언어 등 메타), `SSEEvent`(`status`/`log`/`cost`/`llm-cost`/`concepts`/`review`/`image`/`error`/`done`의 판별 유니온)를 **한 파일에 집중**시켜 프론트·백엔드가 동일 타입을 공유한다. 새 단계 추가 시 이 파일과 `index.ts`를 함께 고쳐야 한다는 점이 명시적 규약으로 문서화돼 있다.

---

## 7. 데이터 모델

```
data/projects/{토픽-슬러그}/
├── state.json          # Project 객체 (status, lastStatus, concepts, reviewScore, llmCostUsd, ...)
├── research.md         # ① 리서치
├── youtube-analysis.md # ② 유튜브 분석
├── strategy.md         # ③ 컨셉 3안
├── concept.md          # 선택된 컨셉
├── brief.md            # ④ 기획서(씬 구조)
├── script-final.md     # ⑤ 최종 대본
├── fact-check.md       # ⑥ 팩트 체크
├── script-review.md    # ⑦ 검수(점수)
├── scene-design.md     # ⑨ 씬 설계
├── image-prompts.md    # ⑩ 이미지 프롬프트
├── audio/              # ⑧ TTS 오디오
├── subtitles/          # ⑧ SRT 자막
├── images/             # ⑪ 생성 이미지
├── videos/             # ⑫ 영상 클립
├── references/         # 사용자 업로드 레퍼런스
├── capcut-project/     # ⑬ CapCut 드래프트 JSON
└── cost-report.json    # 최종 비용 리포트
```

`state.json`의 존재 + 각 산출물 파일의 존재 여부가 곧 파이프라인의 진행 상태를 표현한다. (DB 없이도 상태가 자기 기술적(self-describing)인 구조.)

---

## 8. 코드 리뷰 관점 — 강점 / 개선점 / 리스크

### 8.1 강점 (배울 점)

> [!success] Good
> - **관심사 분리가 명확**: `lib`(도메인) ↔ `app`(전달). API Route가 얇아 테스트·재사용이 쉽다.
> - **이중 모드 LLM 추상화**: SDK/CLI 자동 분기는 운영(정확 과금)과 개발(구독 인증)을 한 코드로 커버하는 실용적 설계.
> - **재개·복구 우선 설계**: 파일시스템을 상태로 삼아 비싼 단계의 중복 실행을 막는다. 비용·시간 관점에서 큰 이점.
> - **비용 가시성**: 단계마다 비용을 추적·스트리밍하고, 생성 전 미리보기 게이트로 과금을 통제한다.
> - **human-in-the-loop 게이트**: 완전 자동과 수동 통제를 상태 머신으로 우아하게 결합.
> - **프롬프트 엔지니어링의 코드화**: 작가·검수 가이드라인을 시스템 프롬프트에 체계적으로 내장. 품질 게이트(점수+자동 수정 루프)가 인상적.
> - **타입 단일 출처**: `types.ts`가 프론트·백 계약을 통일.

### 8.2 개선 여지 (논의 거리)

> [!warning] 개선점
> - **수평 확장 한계**: 인메모리 `EventEmitter` 버스 + 동기 파일 I/O는 단일 서버·단일 사용자 전제. 다중 인스턴스로 늘리면 SSE가 깨지고 파일 경합이 생긴다 → Redis pub/sub + 객체 스토리지/DB 전환이 필요.
> - **백그라운드 작업의 내구성**: `run/route.ts`가 `await` 없이 fire-and-forget. 서버가 재시작되면 진행 중 작업이 유실된다(상태는 파일에 남아 재개는 가능하나 자동 이어받기는 없음) → 작업 큐(BullMQ 등) 도입 검토.
> - **정규식 기반 파싱 의존**: 컨셉·점수·나레이션을 LLM 출력에서 정규식으로 추출 → 출력 형식이 흔들리면 깨지기 쉽다. 구조화 출력(JSON/tool use)로 강건화 가능.
> - **하드코딩된 기본 경로**: `CLAUDE_BIN` 기본값이 특정 사용자 홈(`/Users/hongss/.local/bin/claude`). 환경 변수 미설정 시 타 환경에서 실패.
> - **테스트 부재**: 단위/통합 테스트가 보이지 않음(타입 체크·빌드만). 팀 규칙(`coding-style.md`)은 Zod 검증·Playwright E2E를 권하지만 적용 흔적은 미미.
> - **대형 모듈**: `capcut-editor.ts`(1,430줄), 상세 페이지(1,457줄)는 책임 분할 여지가 있다.

### 8.3 보안·운영 메모

- API 키는 전부 환경 변수로 주입(`.env.local`), 자식 프로세스에서 키 제거 등 시크릿 취급은 양호.
- `--dangerously-skip-permissions`로 CLI를 spawn하므로 신뢰된 로컬 환경 전제. 멀티테넌트/서버 공개 환경에는 부적합.
- ffmpeg/ffprobe 호출이 `execSync` + 문자열 보간 → 입력 경로가 신뢰 가능한 내부 경로라 현재는 안전하나, 일반화 시 주입 위험 주의.

---

## 9. 발표용 핵심 요약 (Speaker Notes)

> [!quote] 30초 엘리베이터 피치
> "VideoMaker는 영상 주제 한 줄을 넣으면 리서치부터 CapCut 편집 프로젝트까지 13단계를 자동으로 만들어 주는 풀스택 TypeScript 앱입니다. 핵심은 ① 11개 AI 에이전트가 파일시스템을 매개로 협업하는 파이프라인, ② SSE로 진행을 실시간 중계하는 fire-and-forget 백그라운드 실행, ③ 파일 존재만 보고 어디서든 이어서 재개하는 복구 설계, 그리고 ④ 단계마다 모델을 달리 쓰고 비용을 추적하는 실용성입니다."

발표 시 강조 포인트 4가지:

1. **아키텍처** — `lib`(도메인) / `app`(전달) 분리, 6-진입점 오케스트레이터 상태 머신.
2. **AI 오케스트레이션** — 단계별 모델 배정(Opus=창작, Sonnet=분석, Haiku=경량), 검수→자동수정 품질 루프.
3. **운영 실용성** — SDK/CLI 이중 모드, 비용 미리보기·샘플 게이트, 재개·복구.
4. **한계와 다음 단계** — 단일 서버 전제 → 큐/외부 pub-sub/DB로 확장, 구조화 출력·테스트 도입.

---

## 부록 A. 환경 변수 정리

| 변수 | 용도 | 필수 |
|------|------|------|
| `ANTHROPIC_API_KEY` | Claude SDK 모드(정확 과금) | 선택(없으면 CLI) |
| `CLAUDE_BIN` | claude 바이너리 경로 | 선택 |
| `TAVILY_API_KEY` | 리서치 웹 검색 | 선택 |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` | TTS | 선택 |
| `FAL_API_KEY` | 이미지/영상 생성 | 선택 |
| `S3_BUCKET` / `AWS_REGION` | 산출물 백업 | 선택 |

## 부록 B. 개발 체크리스트

- 타입 체크: `npx tsc --noEmit`
- 빌드: `npm run build`
- 개발 서버: `npm run dev` (포트 3000)
- Next.js 16 API 확인: `node_modules/next/dist/docs/` 참조
- 새 파이프라인 단계 추가 시: `lib/types.ts`(상태)와 `lib/pipeline/index.ts`(오케스트레이터)를 **함께** 수정
