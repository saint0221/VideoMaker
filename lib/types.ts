export type PipelineStatus =
  | 'idle'
  | 'running:research'
  | 'done:research'
  | 'waiting:youtube-urls'
  | 'running:youtube'
  | 'done:youtube'
  | 'running:strategy'
  | 'done:strategy'
  | 'waiting:concept'
  | 'running:planning'
  | 'done:planning'
  | 'running:scripting'
  | 'done:scripting'
  | 'running:factcheck'
  | 'done:factcheck'
  | 'running:review'
  | 'done:review'
  | 'running:revising'
  | 'waiting:confirm'
  | 'running:tts'
  | 'done:tts'
  | 'running:scene'
  | 'done:scene'
  | 'running:prompts'
  | 'done:prompts'
  | 'waiting:cost-images'
  | 'running:images'
  | 'done:images'
  | 'waiting:sample-images'
  | 'waiting:images'
  | 'waiting:cost-video'
  | 'running:video'
  | 'done:video'
  | 'running:capcut'
  | 'completed'
  | 'error';

export type ImageModel = 'fal-ai/flux/dev' | 'fal-ai/flux/schnell' | 'fal-ai/fast-sdxl' | 'fal-ai/flux-2' | 'fal-ai/flux-lora';

export interface Concept {
  index: number;
  name: string;
  angle: string;
  titles: string[];
}

export interface Project {
  id: string;
  topic: string;
  status: PipelineStatus;
  lastStatus?: PipelineStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  concepts?: Concept[];
  youtubeUrls?: string[];
  reviewScore?: number;
  reviewVerdict?: string;
  capcutPath?: string;
  capcutDraftId?: string;
  capcutTimelineId?: string;
  aspectRatio?: '16:9' | '9:16';
  language?: 'ko' | 'en';
  imageModel?: ImageModel;
  loraUrl?: string;
  loraScale?: number;
  loraTriggerWord?: string;
  loraStyleDesc?: string;
  costPreview?: { stage: 'images' | 'video'; toGenerate: number; skipped: number; costPerUnit: number; totalCost: number };
  llmCostUsd?: number;
}

export interface CostLogEntry {
  timestamp: string;
  projectId: string;
  stage: 'image' | 'video';
  toGenerate: number;
  skipped: number;
  costPerUnit: number;
  totalCost: number;
}

export type SSEEvent =
  | { type: 'status'; status: PipelineStatus }
  | { type: 'log'; message: string }
  | { type: 'cost'; stage: 'image' | 'video'; toGenerate: number; skipped: number; costPerUnit: number; totalCost: number }
  | { type: 'llm-cost'; model: string; inputTokens: number; outputTokens: number; costUsd: number; totalUsd: number }
  | { type: 'concepts'; concepts: Concept[] }
  | { type: 'review'; score: number; verdict: string }
  | { type: 'image'; sceneId: string; localPath: string }
  | { type: 'error'; message: string }
  | { type: 'done' };
