<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Codex Agent Instructions

## First Read

- Read `CLAUDE.md` before making project changes. It is the project-specific operating context for this repository.
- If `CLAUDE.md` and source code disagree, trust the source code and update docs only when the task calls for it.
- Keep changes scoped. Do not touch generated project outputs in `data/projects/{id}/` unless the task explicitly targets a project artifact.

## Project Summary

This is YouTube PD, a Next.js 16 App Router application for an automated YouTube storytelling video pipeline.

- App code: `app/`
- Pipeline code: `lib/pipeline/`
- Project persistence: `data/projects/{id}/`
- Shared project/file helpers: `lib/project.ts`
- Pipeline status and event types: `lib/types.ts`
- SSE event bus: `lib/events.ts`

## Pipeline Rules

- Pipeline orchestration lives in `lib/pipeline/index.ts`.
- Any new or renamed pipeline status must update both `lib/types.ts` and the relevant orchestration/UI code.
- Current major stages include research, YouTube analysis, strategy, planning, scripting, fact-check, review, optional revising, TTS, scene design, image prompts, image generation, video generation, and CapCut export.
- User gates are `waiting:concept`, `waiting:confirm`, `waiting:reference`, and `waiting:images`.
- Error recovery uses `project.lastStatus`; preserve this pattern when changing status handling.

## Artifact Rules

Project artifacts are stored under `data/projects/{id}/`.

- Text artifacts include `research.md`, `youtube-analysis.md`, `strategy.md`, `concept.md`, `brief.md`, `script-final.md`, `fact-check.md`, `script-review.md`, `scene-design.md`, and `image-prompts.md`.
- TTS outputs go under `audio/` and `subtitles/`.
- Generated images go under `images/`.
- Generated video clips go under `videos/`.
- CapCut export files go under `capcut-project/`.

Use the helpers in `lib/project.ts` for project file access instead of ad hoc path handling when possible.

## AI And External Services

- Pipeline LLM calls use `lib/pipeline/claude-runner.ts`, which spawns the `claude` CLI.
- `ANTHROPIC_API_KEY` is intentionally removed from the child process environment; Claude CLI authentication is used instead.
- `CLAUDE_BIN` can override the Claude binary path. The default is `/Users/hongss/.local/bin/claude`.
- `ELEVENLABS_API_KEY` controls TTS. Missing keys should skip or degrade gracefully where existing code already does so.
- `FAL_API_KEY` controls image/video generation. Do not commit real API keys or local secrets.

## Development Checks

- Type check with `npx tsc --noEmit`.
- Build with `npm run build`.
- For Next.js APIs or App Router behavior, inspect `node_modules/next/dist/docs/` for this installed version before changing framework-specific code.
