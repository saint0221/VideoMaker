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
  | 'waiting:reference'
  | 'running:images'
  | 'done:images'
  | 'waiting:images'
  | 'running:video'
  | 'done:video'
  | 'running:capcut'
  | 'completed'
  | 'error';

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
}

export type SSEEvent =
  | { type: 'status'; status: PipelineStatus }
  | { type: 'log'; message: string }
  | { type: 'concepts'; concepts: Concept[] }
  | { type: 'review'; score: number; verdict: string }
  | { type: 'image'; sceneId: string; localPath: string }
  | { type: 'error'; message: string }
  | { type: 'done' };
