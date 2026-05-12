# YouTube PD

유튜브 스토리텔링 채널용 완전 자동화 영상 제작 파이프라인.
주제 하나를 입력하면 리서치부터 캡컷 편집 프로젝트 생성까지 13단계를 자동으로 진행합니다.

## 파이프라인

```
주제 입력
  → 웹 리서치
  → 유튜브 채널 분석
  → 컨셉 전략 생성 ── [선택] 사용자가 컨셉 선택
  → 기획서 작성
  → 대본 작성
  → 팩트 체크
  → 대본 검수 + 자동 수정 (85점 미만 시) ── [선택] 재수정 후 사용자 승인
  → TTS 음성 생성
  → 씬 설계
  → 이미지 프롬프트 생성 ── [선택] 레퍼런스 이미지 업로드
  → 이미지 생성 ── [선택] 사용자 확인
  → 영상 클립 생성
  → 캡컷 프로젝트 생성
```

## 스택

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4** — 다크모드 전용 UI
- **Claude CLI** — AI 파이프라인 단계 (claude-runner.ts를 통해 subprocess spawn)
- **ElevenLabs** — TTS 음성 생성
- **fal.ai / Kling** — 이미지·영상 생성

## 시작하기

```bash
npm install
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 열기.

## 환경 변수

`.env.local` 파일을 생성하세요:

```env
ELEVENLABS_API_KEY=   # TTS (없으면 해당 단계 건너뜀)
FAL_API_KEY=          # 이미지·영상 생성 (없으면 건너뜀)
KLING_API_KEY=        # 영상 생성 폴백
```

> Claude AI 호출은 `claude CLI` 자체 인증을 사용합니다. `ANTHROPIC_API_KEY`는 불필요합니다.

## 데이터 저장

모든 프로젝트 산출물은 `data/projects/{slug}/` 폴더에 저장됩니다.

```
data/projects/{토픽-슬러그}/
├── state.json            # 프로젝트 상태
├── research.md           # 웹 리서치 결과
├── youtube-analysis.md   # 유튜브 채널 분석
├── strategy.md           # 컨셉 전략
├── brief.md              # 기획서
├── script-final.md       # 최종 대본
├── fact-check.md         # 팩트 체크
├── script-review.md      # 검수 결과
├── scene-design.md       # 씬 설계
├── image-prompts.md      # 이미지 프롬프트
├── audio/                # TTS 오디오
├── images/               # 생성 이미지
├── videos/               # 생성 영상 클립
└── capcut-project/       # 캡컷 프로젝트 JSON
```

## 타입 체크

```bash
npx tsc --noEmit
```
