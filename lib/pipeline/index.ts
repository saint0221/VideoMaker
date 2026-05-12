import { runResearcher } from './researcher';
import { runYoutubeAnalyzer } from './youtube-analyzer';
import { runStrategist } from './strategist';
import { runPlanner } from './planner';
import { runScriptwriter } from './scriptwriter';
import { runFactChecker } from './fact-checker';
import { runReviewer } from './reviewer';
import { runScriptReviser } from './script-reviser';
import { runTTS } from './tts';
import { runSceneDesigner } from './scene-designer';
import { runImagePrompter } from './image-prompter';
import { runImageGenerator, findReferenceImage } from './image-generator';
import { runVideoGenerator } from './video-generator';
import { runCapcutEditor } from './capcut-editor';
import { emit } from '../events';
import {
  loadProject,
  updateStatus,
  readFile,
  writeFile,
  listFiles,
  parseConcepts,
  parseReviewScore,
} from '../project';

function hasMandatoryRevisions(reviewMd: string): boolean {
  const match = reviewMd.match(/###\s*🔴\s*필수\s*수정\n([\s\S]*?)(?=###|$)/);
  if (!match) return false;
  const body = match[1].trim();
  return body.length > 0 && !/^-\s*(없음|해당\s*없음)/.test(body);
}

function handleError(projectId: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  updateStatus(projectId, 'error', { error: message });
  emit(projectId, { type: 'error', message });
  emit(projectId, { type: 'done' });
}

export async function runPipeline(projectId: string) {
  const project = loadProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  try {
    const { topic } = project;

    // Stage 1: Research
    const noResearch = readFile(projectId, 'research.md') === null;
    if (project.status === 'idle' || project.status === 'running:research' ||
        (project.status === 'error' && noResearch)) {
      updateStatus(projectId, 'running:research');
      emit(projectId, { type: 'status', status: 'running:research' });

      await runResearcher(projectId, topic);

      updateStatus(projectId, 'done:research');
      emit(projectId, { type: 'status', status: 'done:research' });
    }

    // Stage 1.5: YouTube Analysis
    if (readFile(projectId, 'youtube-analysis.md') === null) {
      updateStatus(projectId, 'running:youtube');
      emit(projectId, { type: 'status', status: 'running:youtube' });

      await runYoutubeAnalyzer(projectId, topic);

      updateStatus(projectId, 'done:youtube');
      emit(projectId, { type: 'status', status: 'done:youtube' });
    }

    // Stage 2: Strategy
    if (
      project.status === 'done:research' ||
      project.status === 'running:strategy' ||
      readFile(projectId, 'research.md') !== null
    ) {
      const researchMd = readFile(projectId, 'research.md');
      if (!researchMd) throw new Error('research.md를 찾을 수 없습니다.');

      const youtubeAnalysisMd = readFile(projectId, 'youtube-analysis.md') ?? undefined;

      updateStatus(projectId, 'running:strategy');
      emit(projectId, { type: 'status', status: 'running:strategy' });

      const strategyMd = await runStrategist(projectId, topic, researchMd, youtubeAnalysisMd);

      const concepts = parseConcepts(strategyMd);
      updateStatus(projectId, 'waiting:concept', { concepts });
      emit(projectId, { type: 'status', status: 'waiting:concept' });
      emit(projectId, { type: 'concepts', concepts });
      emit(projectId, { type: 'done' });
      return; // Wait for user to select concept
    }
  } catch (err) {
    handleError(projectId, err);
  }
}

export async function runPipelineFromPlanning(projectId: string) {
  const project = loadProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  try {
    const { topic } = project;

    const conceptMd = readFile(projectId, 'concept.md');
    const researchMd = readFile(projectId, 'research.md');

    if (!conceptMd || !researchMd) {
      throw new Error('concept.md 또는 research.md를 찾을 수 없습니다.');
    }

    // Stage 3: Planning
    updateStatus(projectId, 'running:planning');
    emit(projectId, { type: 'status', status: 'running:planning' });

    const briefMd = await runPlanner(projectId, topic, conceptMd, researchMd);

    updateStatus(projectId, 'done:planning');
    emit(projectId, { type: 'status', status: 'done:planning' });

    // Stage 4: Scripting
    updateStatus(projectId, 'running:scripting');
    emit(projectId, { type: 'status', status: 'running:scripting' });

    const scriptMd = await runScriptwriter(projectId, topic, briefMd, researchMd);

    updateStatus(projectId, 'done:scripting');
    emit(projectId, { type: 'status', status: 'done:scripting' });

    // Stage 4.5: Fact Check
    updateStatus(projectId, 'running:factcheck');
    emit(projectId, { type: 'status', status: 'running:factcheck' });

    const factCheckMd = await runFactChecker(projectId, topic, scriptMd, researchMd);

    updateStatus(projectId, 'done:factcheck');
    emit(projectId, { type: 'status', status: 'done:factcheck' });

    // Stage 5: Review
    updateStatus(projectId, 'running:review');
    emit(projectId, { type: 'status', status: 'running:review' });

    const reviewMd = await runReviewer(projectId, topic, scriptMd, briefMd, factCheckMd);
    const { score, verdict } = parseReviewScore(reviewMd);

    // 필수 수정 항목이 있으면 자동 적용
    if (hasMandatoryRevisions(reviewMd)) {
      emit(projectId, { type: 'log', message: '🔴 필수 수정 항목 감지 — 자동 적용 중...' });
      updateStatus(projectId, 'running:revising');
      emit(projectId, { type: 'status', status: 'running:revising' });
      await runScriptReviser(projectId, scriptMd, reviewMd);
    }

    updateStatus(projectId, 'waiting:confirm', { reviewScore: score, reviewVerdict: verdict });
    emit(projectId, { type: 'status', status: 'waiting:confirm' });
    emit(projectId, { type: 'review', score, verdict });
    emit(projectId, { type: 'done' });
  } catch (err) {
    handleError(projectId, err);
  }
}

export async function runPostScript(projectId: string) {
  const project = loadProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  try {
    const scriptMd = readFile(projectId, 'script-final.md');
    const briefMd = readFile(projectId, 'brief.md');

    if (!scriptMd) throw new Error('script-final.md를 찾을 수 없습니다.');
    if (!briefMd) throw new Error('brief.md를 찾을 수 없습니다.');

    const { topic } = project;

    // Stage 6: TTS
    updateStatus(projectId, 'running:tts');
    emit(projectId, { type: 'status', status: 'running:tts' });
    await runTTS(projectId, scriptMd);
    updateStatus(projectId, 'done:tts');
    emit(projectId, { type: 'status', status: 'done:tts' });

    // Stage 7: Scene Designer
    updateStatus(projectId, 'running:scene');
    emit(projectId, { type: 'status', status: 'running:scene' });
    const sceneDesignMd = await runSceneDesigner(projectId, topic, scriptMd, briefMd);
    updateStatus(projectId, 'done:scene');
    emit(projectId, { type: 'status', status: 'done:scene' });

    // Stage 8: Image Prompter
    updateStatus(projectId, 'running:prompts');
    emit(projectId, { type: 'status', status: 'running:prompts' });
    const promptsMd = await runImagePrompter(projectId, topic, sceneDesignMd);
    updateStatus(projectId, 'done:prompts');
    emit(projectId, { type: 'status', status: 'done:prompts' });

    // Stage 9: Auto-start if reference image already uploaded, otherwise wait
    const referenceImagePath = findReferenceImage(projectId) ?? undefined;
    if (referenceImagePath) {
      emit(projectId, { type: 'log', message: '📎 레퍼런스 이미지 감지 — 이미지 생성 자동 시작' });
      updateStatus(projectId, 'running:images');
      emit(projectId, { type: 'status', status: 'running:images' });
      await runImageGenerator(projectId, promptsMd, { referenceImagePath });
      updateStatus(projectId, 'waiting:images');
      emit(projectId, { type: 'status', status: 'waiting:images' });
      emit(projectId, { type: 'done' });
    } else {
      updateStatus(projectId, 'waiting:reference');
      emit(projectId, { type: 'status', status: 'waiting:reference' });
      emit(projectId, { type: 'done' });
    }
  } catch (err) {
    handleError(projectId, err);
  }
}

export async function continueFromImages(projectId: string) {
  const project = loadProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  try {
    // Stage 10: Video Generator
    updateStatus(projectId, 'running:video');
    emit(projectId, { type: 'status', status: 'running:video' });
    await runVideoGenerator(projectId);
    updateStatus(projectId, 'done:video');
    emit(projectId, { type: 'status', status: 'done:video' });

    // Stage 11: CapCut Editor
    updateStatus(projectId, 'running:capcut');
    emit(projectId, { type: 'status', status: 'running:capcut' });
    await runCapcutEditor(projectId);

    updateStatus(projectId, 'completed');
    emit(projectId, { type: 'status', status: 'completed' });
    emit(projectId, { type: 'log', message: '🎬 모든 단계 완료! capcut-project/ 폴더를 CapCut에서 임포트하세요.' });
    emit(projectId, { type: 'done' });
  } catch (err) {
    handleError(projectId, err);
  }
}

export async function resumePipeline(projectId: string) {
  const project = loadProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  try {
    const { topic } = project;

    const research = readFile(projectId, 'research.md');
    const youtubeAnalysis = readFile(projectId, 'youtube-analysis.md');
    const strategy = readFile(projectId, 'strategy.md');
    const concept = readFile(projectId, 'concept.md');
    let brief = readFile(projectId, 'brief.md');
    let script = readFile(projectId, 'script-final.md');
    let factCheck = readFile(projectId, 'fact-check.md');
    const review = readFile(projectId, 'script-review.md');
    let scene = readFile(projectId, 'scene-design.md');
    let prompts = readFile(projectId, 'image-prompts.md');
    const imageFiles = listFiles(projectId, 'images').filter(f => !f.startsWith('.'));

    // No research → full restart
    if (!research) {
      return runPipeline(projectId);
    }

    // No youtube analysis → run it, then strategy
    if (!youtubeAnalysis) {
      updateStatus(projectId, 'running:youtube', { error: undefined });
      emit(projectId, { type: 'status', status: 'running:youtube' });
      const youtubeAnalysisMd = await runYoutubeAnalyzer(projectId, topic);
      updateStatus(projectId, 'done:youtube');
      emit(projectId, { type: 'status', status: 'done:youtube' });

      updateStatus(projectId, 'running:strategy', { error: undefined });
      emit(projectId, { type: 'status', status: 'running:strategy' });
      const strategyMd = await runStrategist(projectId, topic, research, youtubeAnalysisMd);
      const concepts = parseConcepts(strategyMd);
      updateStatus(projectId, 'waiting:concept', { concepts });
      emit(projectId, { type: 'status', status: 'waiting:concept' });
      emit(projectId, { type: 'concepts', concepts });
      emit(projectId, { type: 'done' });
      return;
    }

    // No strategy → re-run strategy then wait for concept selection
    if (!strategy) {
      updateStatus(projectId, 'running:strategy', { error: undefined });
      emit(projectId, { type: 'status', status: 'running:strategy' });
      const strategyMd = await runStrategist(projectId, topic, research, youtubeAnalysis ?? undefined);
      const concepts = parseConcepts(strategyMd);
      updateStatus(projectId, 'waiting:concept', { concepts });
      emit(projectId, { type: 'status', status: 'waiting:concept' });
      emit(projectId, { type: 'concepts', concepts });
      emit(projectId, { type: 'done' });
      return;
    }

    // No concept selected → restore concept selection gate
    if (!concept) {
      const concepts = parseConcepts(strategy);
      updateStatus(projectId, 'waiting:concept', { concepts, error: undefined });
      emit(projectId, { type: 'status', status: 'waiting:concept' });
      emit(projectId, { type: 'concepts', concepts });
      emit(projectId, { type: 'done' });
      return;
    }

    // Stage 3: Planning (skip if brief.md exists)
    if (!brief) {
      updateStatus(projectId, 'running:planning', { error: undefined });
      emit(projectId, { type: 'status', status: 'running:planning' });
      brief = await runPlanner(projectId, topic, concept, research);
      updateStatus(projectId, 'done:planning');
      emit(projectId, { type: 'status', status: 'done:planning' });
    }

    // Stage 4: Scripting (skip if script-final.md exists)
    if (!script) {
      updateStatus(projectId, 'running:scripting', { error: undefined });
      emit(projectId, { type: 'status', status: 'running:scripting' });
      script = await runScriptwriter(projectId, topic, brief!, research);
      updateStatus(projectId, 'done:scripting');
      emit(projectId, { type: 'status', status: 'done:scripting' });
    }

    // Stage 4.5: Fact Check (skip if fact-check.md exists)
    if (!factCheck) {
      updateStatus(projectId, 'running:factcheck', { error: undefined });
      emit(projectId, { type: 'status', status: 'running:factcheck' });
      factCheck = await runFactChecker(projectId, topic, script!, research);
      updateStatus(projectId, 'done:factcheck');
      emit(projectId, { type: 'status', status: 'done:factcheck' });
    }

    // Stage 5: Review (skip if script-review.md exists)
    if (!review) {
      updateStatus(projectId, 'running:review', { error: undefined });
      emit(projectId, { type: 'status', status: 'running:review' });
      const reviewMd = await runReviewer(projectId, topic, script!, brief!, factCheck ?? undefined);
      const { score, verdict } = parseReviewScore(reviewMd);

      if (hasMandatoryRevisions(reviewMd)) {
        emit(projectId, { type: 'log', message: '🔴 필수 수정 항목 감지 — 자동 적용 중...' });
        updateStatus(projectId, 'running:revising', { error: undefined });
        emit(projectId, { type: 'status', status: 'running:revising' });
        await runScriptReviser(projectId, script!, reviewMd);
      }

      updateStatus(projectId, 'waiting:confirm', { reviewScore: score, reviewVerdict: verdict, error: undefined });
      emit(projectId, { type: 'status', status: 'waiting:confirm' });
      emit(projectId, { type: 'review', score, verdict });
      emit(projectId, { type: 'done' });
      return;
    }

    // Review done but no scene-design → restore confirm gate so user re-triggers post-script
    if (!scene) {
      const { score, verdict } = parseReviewScore(review);
      const resolvedScore = project.reviewScore ?? score;
      const resolvedVerdict = project.reviewVerdict ?? verdict;
      updateStatus(projectId, 'waiting:confirm', { reviewScore: resolvedScore, reviewVerdict: resolvedVerdict, error: undefined });
      emit(projectId, { type: 'status', status: 'waiting:confirm' });
      emit(projectId, { type: 'review', score: resolvedScore, verdict: resolvedVerdict });
      emit(projectId, { type: 'done' });
      return;
    }

    // Stage 8: Image Prompter (skip if image-prompts.md exists)
    if (!prompts) {
      updateStatus(projectId, 'running:prompts', { error: undefined });
      emit(projectId, { type: 'status', status: 'running:prompts' });
      prompts = await runImagePrompter(projectId, topic, scene!);
      updateStatus(projectId, 'done:prompts');
      emit(projectId, { type: 'status', status: 'done:prompts' });
    }

    // Stage 9: Auto-start if reference image exists; otherwise wait at reference gate
    if (imageFiles.length === 0) {
      const referenceImagePath = findReferenceImage(projectId) ?? undefined;
      if (referenceImagePath) {
        emit(projectId, { type: 'log', message: '📎 레퍼런스 이미지 감지 — 이미지 생성 자동 시작' });
        updateStatus(projectId, 'running:images', { error: undefined });
        emit(projectId, { type: 'status', status: 'running:images' });
        await runImageGenerator(projectId, prompts!, { referenceImagePath });
        updateStatus(projectId, 'waiting:images');
        emit(projectId, { type: 'status', status: 'waiting:images' });
        emit(projectId, { type: 'done' });
      } else {
        updateStatus(projectId, 'waiting:reference', { error: undefined });
        emit(projectId, { type: 'status', status: 'waiting:reference' });
        emit(projectId, { type: 'done' });
      }
      return;
    }

    updateStatus(projectId, 'waiting:images', { error: undefined });
    emit(projectId, { type: 'status', status: 'waiting:images' });
    emit(projectId, { type: 'done' });
  } catch (err) {
    handleError(projectId, err);
  }
}

export function runImagesBackground(
  projectId: string,
  promptsMd: string,
  referenceImagePath?: string,
): void {
  (async () => {
    updateStatus(projectId, 'running:images');
    emit(projectId, { type: 'status', status: 'running:images' });
    await runImageGenerator(projectId, promptsMd, referenceImagePath ? { referenceImagePath } : undefined);
    updateStatus(projectId, 'waiting:images');
    emit(projectId, { type: 'status', status: 'waiting:images' });
    emit(projectId, { type: 'done' });
  })().catch((err) => handleError(projectId, err));
}

export async function saveConcept(projectId: string, conceptIndex: number) {
  const strategyMd = readFile(projectId, 'strategy.md');
  if (!strategyMd) throw new Error('strategy.md를 찾을 수 없습니다.');

  const project = loadProject(projectId);
  if (!project?.concepts) throw new Error('컨셉 목록을 찾을 수 없습니다.');

  const selected = project.concepts.find((c) => c.index === conceptIndex);
  if (!selected) throw new Error(`컨셉 ${conceptIndex}를 찾을 수 없습니다.`);

  const conceptBlocks = strategyMd.split(/##\s+\[컨셉\s*\d+\]/);
  const targetBlock = conceptBlocks[conceptIndex];

  const conceptContent = targetBlock
    ? `# 선택된 컨셉: ${selected.name}\n\n## [컨셉 ${selected.index}] ${selected.name}\n${targetBlock}`
    : `# 선택된 컨셉: ${selected.name}\n\n컨셉명: ${selected.name}\n각도: ${selected.angle}`;

  writeFile(projectId, 'concept.md', conceptContent);
}
