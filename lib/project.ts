import fs from 'fs';
import path from 'path';
import type { Project, PipelineStatus, Concept, CostLogEntry } from './types';
import { uploadToS3, downloadFromS3, deleteProjectFromS3, s3Enabled } from './s3';

const DATA_DIR = path.join(process.cwd(), 'data', 'projects');

function slugify(topic: string): string {
  return topic
    .trim()
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function uniqueSlug(base: string): string {
  if (!fs.existsSync(path.join(DATA_DIR, base))) return base;
  let i = 2;
  while (fs.existsSync(path.join(DATA_DIR, `${base}-${i}`))) i++;
  return `${base}-${i}`;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function projectDir(id: string) {
  return path.join(DATA_DIR, id);
}

export function projectFile(id: string, filename: string) {
  return path.join(DATA_DIR, id, filename);
}

export function createProject(topic: string, aspectRatio?: '16:9' | '9:16', language?: 'ko' | 'en'): Project {
  ensureDir(DATA_DIR);
  const id = uniqueSlug(slugify(topic));
  const dir = projectDir(id);
  ensureDir(dir);
  const project: Project = {
    id,
    topic,
    status: 'idle',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    aspectRatio: aspectRatio ?? '16:9',
    language: language ?? 'ko',
  };
  saveProject(project);
  return project;
}

export function saveProject(project: Project) {
  const dir = projectDir(project.id);
  ensureDir(dir);
  project.updatedAt = new Date().toISOString();
  const content = JSON.stringify(project, null, 2);
  fs.writeFileSync(path.join(dir, 'state.json'), content);
  uploadToS3(project.id, 'state.json', content);
}

export function loadProject(id: string): Project | null {
  const file = path.join(DATA_DIR, id, 'state.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

export async function loadProjectWithS3Fallback(id: string): Promise<Project | null> {
  const local = loadProject(id);
  if (local) return local;
  if (!s3Enabled()) return null;
  const buf = await downloadFromS3(id, 'state.json');
  if (!buf) return null;
  try {
    const project: Project = JSON.parse(buf.toString('utf-8'));
    ensureDir(projectDir(id));
    fs.writeFileSync(path.join(DATA_DIR, id, 'state.json'), buf);
    return project;
  } catch {
    return null;
  }
}

export function listProjects(): Project[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .map((id) => loadProject(id))
    .filter((p): p is Project => p !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function readFile(id: string, filename: string): string | null {
  const file = projectFile(id, filename);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf-8');
}

export function writeFile(id: string, filename: string, content: string) {
  const filePath = path.join(projectDir(id), filename);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
  uploadToS3(id, filename, content);
}

export function writeFileBinary(id: string, filename: string, buffer: Buffer) {
  const filePath = path.join(projectDir(id), filename);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, buffer);
  uploadToS3(id, filename, buffer);
}

export function listFiles(id: string, subdir: string): string[] {
  const dir = path.join(projectDir(id), subdir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort();
}

export function addLlmCost(id: string, costUsd: number): number {
  const project = loadProject(id);
  if (!project) return costUsd;
  project.llmCostUsd = (project.llmCostUsd ?? 0) + costUsd;
  saveProject(project);
  return project.llmCostUsd;
}

export function updateStatus(id: string, status: PipelineStatus, extra?: Partial<Project>) {
  const project = loadProject(id);
  if (!project) throw new Error(`Project ${id} not found`);
  if (status === 'error' && project.status !== 'error') {
    project.lastStatus = project.status;
  }
  project.status = status;
  if (extra) Object.assign(project, extra);
  saveProject(project);
}

export function parseConcepts(strategyMd: string): Concept[] {
  // JSON block first (new structured output)
  const jsonMatch = strategyMd.match(/```json\s*\n(\[[\s\S]*?\])\s*\n\s*```/);
  if (jsonMatch) {
    try {
      const parsed: unknown = JSON.parse(jsonMatch[1]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const concepts: Concept[] = (parsed as unknown[])
          .filter((c): c is Record<string, unknown> => c !== null && typeof c === 'object' && !Array.isArray(c))
          .map((c) => ({
            index: typeof c.index === 'number' ? c.index : 0,
            name: typeof c.name === 'string' ? c.name : '',
            angle: typeof c.angle === 'string' ? c.angle : '',
            titles: Array.isArray(c.titles) ? (c.titles as unknown[]).filter((t): t is string => typeof t === 'string') : [],
          }))
          .filter((c) => c.index > 0 && c.name.length > 0);
        if (concepts.length > 0) return concepts;
      }
    } catch { /* fall through */ }
  }

  // Fallback: existing regex (handles legacy strategy.md files)
  const concepts: Concept[] = [];
  const conceptBlocks = strategyMd.split(/##\s+\[컨셉\s*(\d+)\]\s+(.+)/g);

  let i = 1;
  while (i < conceptBlocks.length) {
    const index = parseInt(conceptBlocks[i], 10);
    const name = conceptBlocks[i + 1]?.trim() ?? `컨셉 ${index}`;
    const body = conceptBlocks[i + 2] ?? '';

    const titleMatches = [...body.matchAll(/[-*]\s+[ABC]:\s+`?"([^"]+)"/g)];
    const titles = titleMatches.map((m) => m[1]);

    const angleMatch = body.match(/접근\s*방식\**\s*:\s*([^\n]+)/);
    const angle = angleMatch ? angleMatch[1].trim() : '';

    concepts.push({ index, name, angle, titles });
    i += 3;
  }

  if (concepts.length === 0) {
    const simpleMatches = [...strategyMd.matchAll(/##\s+\[?컨셉\s*(\d+)\]?\s*[—-]?\s*(.+)/g)];
    simpleMatches.forEach((m, idx) => {
      concepts.push({ index: idx + 1, name: m[2].trim(), angle: '', titles: [] });
    });
  }

  return concepts;
}

const COST_LOG_FILE = path.join(process.cwd(), 'data', 'cost-log.json');

export function appendCostLog(entry: CostLogEntry): void {
  let log: CostLogEntry[] = [];
  if (fs.existsSync(COST_LOG_FILE)) {
    try { log = JSON.parse(fs.readFileSync(COST_LOG_FILE, 'utf-8')); } catch { log = []; }
  }
  log.push(entry);
  fs.writeFileSync(COST_LOG_FILE, JSON.stringify(log, null, 2));
}

export function readCostLog(): CostLogEntry[] {
  if (!fs.existsSync(COST_LOG_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(COST_LOG_FILE, 'utf-8')); } catch { return []; }
}

export function writeCostReport(id: string): void {
  const project = loadProject(id);
  const llmCostUsd = project?.llmCostUsd ?? 0;

  const entries = readCostLog().filter((e) => e.projectId === id);
  const imageEntry = entries.filter((e) => e.stage === 'image').at(-1);
  const videoEntry = entries.filter((e) => e.stage === 'video').at(-1);

  const imageCostUsd = imageEntry?.totalCost ?? 0;
  const videoCostUsd = videoEntry?.totalCost ?? 0;

  const report = {
    projectId: id,
    generatedAt: new Date().toISOString(),
    llm: {
      costUsd: +llmCostUsd.toFixed(6),
    },
    imageGeneration: {
      count: imageEntry ? imageEntry.toGenerate + imageEntry.skipped : 0,
      generated: imageEntry?.toGenerate ?? 0,
      skipped: imageEntry?.skipped ?? 0,
      costPerUnit: imageEntry?.costPerUnit ?? 0.025,
      totalCostUsd: +imageCostUsd.toFixed(4),
    },
    videoGeneration: {
      count: videoEntry ? videoEntry.toGenerate + videoEntry.skipped : 0,
      generated: videoEntry?.toGenerate ?? 0,
      skipped: videoEntry?.skipped ?? 0,
      costPerUnit: videoEntry?.costPerUnit ?? 0.28,
      totalCostUsd: +videoCostUsd.toFixed(4),
    },
    totalCostUsd: +(llmCostUsd + imageCostUsd + videoCostUsd).toFixed(4),
  };

  writeFile(id, 'cost-report.json', JSON.stringify(report, null, 2));
}

export function deleteProject(id: string): boolean {
  const dir = projectDir(id);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  deleteProjectFromS3(id);
  return true;
}

export function parseReviewScore(reviewMd: string): { score: number; verdict: string } {
  // JSON block first (new structured output)
  const jsonMatch = reviewMd.match(/```json\s*\n([\s\S]*?)\n\s*```/);
  if (jsonMatch) {
    try {
      const parsed: unknown = JSON.parse(jsonMatch[1]);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof (parsed as Record<string, unknown>).score === 'number' &&
        typeof (parsed as Record<string, unknown>).verdict === 'string'
      ) {
        const p = parsed as { score: number; verdict: string };
        return { score: p.score, verdict: p.verdict };
      }
    } catch { /* fall through */ }
  }

  // Fallback: existing regex (handles legacy script-review.md files)
  const scoreMatch = reviewMd.match(/\*\*점수\*\*:\s*(\d+)\/100/);
  const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;

  let verdict = '조건부 합격';
  if (reviewMd.includes('✅ 합격')) verdict = '합격';
  else if (reviewMd.includes('❌ 불합격')) verdict = '불합격';
  else if (reviewMd.includes('⚠️')) verdict = '조건부 합격';

  return { score, verdict };
}
