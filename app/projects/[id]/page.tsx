'use client';

import { useState, useEffect, useRef, use } from 'react';
import { useRouter } from 'next/navigation';
import { marked } from 'marked';
import type { Project, PipelineStatus, SSEEvent, Concept, ImageModel } from '@/lib/types';

function formatSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

const STAGES: { key: string; label: string; statuses: PipelineStatus[] }[] = [
  {
    key: 'research',
    label: '리서치',
    statuses: ['running:research', 'done:research'],
  },
  {
    key: 'youtube',
    label: 'YT분석',
    statuses: ['waiting:youtube-urls', 'running:youtube', 'done:youtube'],
  },
  {
    key: 'strategy',
    label: '전략',
    statuses: ['running:strategy', 'done:strategy', 'waiting:concept'],
  },
  {
    key: 'planning',
    label: '기획',
    statuses: ['running:planning', 'done:planning'],
  },
  {
    key: 'scripting',
    label: '대본',
    statuses: ['running:scripting', 'done:scripting'],
  },
  {
    key: 'factcheck',
    label: '팩트체크',
    statuses: ['running:factcheck', 'done:factcheck'],
  },
  {
    key: 'review',
    label: '검토',
    statuses: ['running:review', 'done:review', 'running:revising', 'waiting:confirm'],
  },
  {
    key: 'tts',
    label: 'TTS',
    statuses: ['running:tts', 'done:tts'],
  },
  {
    key: 'scene',
    label: '씬설계',
    statuses: ['running:scene', 'done:scene'],
  },
  {
    key: 'prompts',
    label: '프롬프트',
    statuses: ['running:prompts', 'done:prompts'],
  },
  {
    key: 'images',
    label: '이미지',
    statuses: ['waiting:cost-images', 'running:images', 'done:images', 'waiting:sample-images', 'waiting:images'],
  },
  {
    key: 'video',
    label: '영상',
    statuses: ['waiting:cost-video', 'running:video', 'done:video'],
  },
  {
    key: 'capcut',
    label: 'CapCut',
    statuses: ['running:capcut', 'completed'],
  },
];

function getStageNodeClass(stageIndex: number, currentStatusIndex: number, isRunning: boolean, isPaused: boolean, isErrorStage: boolean): string {
  if (stageIndex < currentStatusIndex) return 'stage-node stage-node-done';
  if (stageIndex === currentStatusIndex) {
    if (isErrorStage) return 'stage-node stage-node-error';
    if (isPaused) return 'stage-node stage-node-waiting';
    return isRunning ? 'stage-node stage-node-active' : 'stage-node stage-node-done';
  }
  return 'stage-node stage-node-pending';
}

function getStageNodeContent(stageIndex: number, currentStatusIndex: number, isRunning: boolean, isPaused: boolean, isErrorStage: boolean): string {
  if (stageIndex < currentStatusIndex) return '✓';
  if (stageIndex === currentStatusIndex) {
    if (isErrorStage) return '✗';
    if (isPaused) return '⏸';
    return isRunning ? '▶' : '✓';
  }
  return String(stageIndex + 1);
}

const ALL_WAITING_STATUSES: PipelineStatus[] = ['waiting:youtube-urls', 'waiting:concept', 'waiting:confirm', 'waiting:cost-images', 'waiting:sample-images', 'waiting:images', 'waiting:cost-video'];

function getStatusIndex(status: PipelineStatus, lastStatus?: PipelineStatus): { stageIdx: number; running: boolean; paused: boolean } {
  const effective = status === 'error' && lastStatus ? lastStatus : status;
  const paused = ALL_WAITING_STATUSES.includes(status as PipelineStatus);
  for (let i = 0; i < STAGES.length; i++) {
    if (STAGES[i].statuses.includes(effective)) {
      const running = status !== 'error' && effective.startsWith('running:');
      return { stageIdx: i, running, paused };
    }
  }
  if (effective === 'completed') return { stageIdx: STAGES.length, running: false, paused: false };
  return { stageIdx: -1, running: false, paused: false };
}

function renderMarkdown(text: string): string {
  return marked(text) as string;
}

function FileLink({ projectId, file, label }: { projectId: string; file: string; label: string }) {
  return (
    <a
      href={`/api/projects/${projectId}/files?file=${file}&download=1`}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 14px',
        borderRadius: 6,
        fontSize: 12,
        color: 'var(--accent)',
        border: '1px solid rgba(124,111,255,0.3)',
        textDecoration: 'none',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,111,255,0.1)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = ''; }}
    >
      ↓ {label}
    </a>
  );
}

function ConceptSelector({ concepts, onSelect, onRegenerate, regenerating }: { concepts: Concept[]; onSelect: (i: number) => void; onRegenerate: () => void; regenerating?: boolean }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text)' }}>
          컨셉을 선택하세요
        </h3>
        <button
          className="btn btn-outline"
          style={{ fontSize: 12, padding: '4px 12px' }}
          disabled={submitting || regenerating}
          onClick={onRegenerate}
        >
          {regenerating ? '⏳ 생성 중…' : '↻ 다시 제안받기'}
        </button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
        선택한 컨셉으로 기획서와 대본이 작성됩니다
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
        {concepts.map(c => (
          <div
            key={c.index}
            className={`concept-card${selected === c.index ? ' selected' : ''}`}
            onClick={() => setSelected(c.index)}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 6 }}>
                  {c.name}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.6 }}>
                  {c.angle}
                </div>
                {c.titles.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {c.titles.map((t, i) => (
                      <div key={i} style={{ fontSize: 12, color: 'var(--text)', background: 'var(--surface)', padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)' }}>
                        📹 {t}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                border: `2px solid ${selected === c.index ? 'var(--accent)' : 'var(--border)'}`,
                background: selected === c.index ? 'var(--accent)' : 'transparent',
                flexShrink: 0,
                marginTop: 2,
              }} />
            </div>
          </div>
        ))}
      </div>
      <button
        className="btn btn-primary"
        disabled={selected === null || submitting}
        onClick={() => {
          if (selected === null) return;
          setSubmitting(true);
          onSelect(selected);
        }}
      >
        {submitting ? '처리중…' : '이 컨셉으로 계속하기'}
      </button>
    </div>
  );
}

function ReviewView({ projectId, score, verdict, onConfirm, onApplyReview }: {
  projectId: string;
  score: number;
  verdict: string;
  onConfirm: () => Promise<{ error?: string; hasRevisions?: boolean } | null>;
  onApplyReview: () => void;
}) {
  const [content, setContent] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmError, setConfirmError] = useState<{ message: string; hasRevisions: boolean } | null>(null);
  const [tab, setTab] = useState<'review' | 'script'>('review');

  useEffect(() => {
    const file = tab === 'review' ? 'script-review.md' : 'script-final.md';
    fetch(`/api/projects/${projectId}/files?file=${file}`)
      .then(r => r.json())
      .then(data => setContent(data.content ?? ''))
      .catch(() => setContent(''));
  }, [projectId, tab]);

  const scoreColor = score >= 80 ? 'var(--success)' : score >= 60 ? 'var(--warning)' : 'var(--error)';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          background: 'var(--surface-2)',
          border: `2px solid ${scoreColor}`,
          borderRadius: 12,
          padding: '12px 20px',
          minWidth: 80,
        }}>
          <span style={{ fontSize: 28, fontWeight: 800, color: scoreColor }}>{score}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>/ 100점</span>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', marginBottom: 4 }}>검토 완료</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{verdict}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['review', 'script'] as const).map(t => (
          <button
            key={t}
            className={`btn ${tab === t ? 'btn-primary' : 'btn-outline'}`}
            style={{ fontSize: 13, padding: '6px 14px' }}
            onClick={() => setTab(t)}
          >
            {t === 'review' ? '검토 리포트' : '최종 대본'}
          </button>
        ))}
      </div>

      {content && (
        <div
          className="markdown"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 20,
            maxHeight: 400,
            overflowY: 'auto',
            marginBottom: 20,
          }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
        />
      )}

      {confirmError && (
        <div style={{
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid var(--error)',
          borderRadius: 8,
          padding: '10px 14px',
          color: 'var(--error)',
          fontSize: 13,
          marginBottom: 12,
        }}>
          {confirmError.message}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn btn-success"
          disabled={confirming || applying}
          onClick={async () => {
            setConfirming(true);
            setConfirmError(null);
            const result = await onConfirm();
            if (result?.error) {
              setConfirmError({ message: result.error, hasRevisions: result.hasRevisions ?? false });
              setConfirming(false);
            }
          }}
        >
          {confirming ? '처리중…' : '✓ 대본 확정'}
        </button>

        <button
          className="btn btn-outline"
          disabled={confirming || applying}
          onClick={() => { setApplying(true); setConfirmError(null); onApplyReview(); }}
          style={{ gap: 6 }}
        >
          {applying ? '⏳ 수정 적용 중…' : '↻ 권장사항 적용 후 재검수'}
        </button>
        <FileLink projectId={projectId} file="script-final.md" label="대본 다운로드" />
        <FileLink projectId={projectId} file="script-review.md" label="검토 리포트" />
      </div>
    </div>
  );
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [project, setProject] = useState<Project | null>(null);
  type CostEntry = { kind: 'cost'; stage: 'image' | 'video'; toGenerate: number; skipped: number; costPerUnit: number; totalCost: number };
  type LogEntry = string | CostEntry;
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [concepts, setConcepts] = useState<Concept[] | null>(null);
  const [reviewData, setReviewData] = useState<{ score: number; verdict: string } | null>(null);
  const [generatedImages, setGeneratedImages] = useState<Array<{ sceneId: string; localPath: string; ts?: number }>>([]);
  const [youtubeUrlInput, setYoutubeUrlInput] = useState('');
  const [youtubeUrlSubmitting, setYoutubeUrlSubmitting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regeneratingConcepts, setRegeneratingConcepts] = useState(false);
  const [regeneratingPrompts, setRegeneratingPrompts] = useState(false);
  const [confirmingImages, setConfirmingImages] = useState(false);
  const [imageModel, setImageModel] = useState<ImageModel>('fal-ai/flux-lora');
  const [loraUrl, setLoraUrl] = useState('');
  const [loraScale, setLoraScale] = useState(1.0);
  const [loraTriggerWord, setLoraTriggerWord] = useState('');
  const [loraStyleDesc, setLoraStyleDesc] = useState('');
  const [sseActive, setSseActive] = useState(false);
  const [pipelineStarted, setPipelineStarted] = useState(false);
  const [hasSubtitles, setHasSubtitles] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [silentSec, setSilentSec] = useState(0);
  const [llmCostUsd, setLlmCostUsd] = useState(0);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const stageStartRef = useRef<number>(Date.now());
  const lastLogTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then(r => r.json())
      .then((p: Project) => {
        setProject(p);
        if (p.concepts) setConcepts(p.concepts);
        if (p.reviewScore !== undefined && p.reviewVerdict) {
          setReviewData({ score: p.reviewScore, verdict: p.reviewVerdict });
        }
        if (p.llmCostUsd) setLlmCostUsd(p.llmCostUsd);
        if (p.imageModel) setImageModel(p.imageModel);
        if (p.loraUrl) setLoraUrl(p.loraUrl);
        if (p.loraScale !== undefined) setLoraScale(p.loraScale);
        if (p.loraTriggerWord) setLoraTriggerWord(p.loraTriggerWord);
        if (p.loraStyleDesc) setLoraStyleDesc(p.loraStyleDesc);
        if (p.status.startsWith('running:') || p.status.startsWith('waiting:')) {
          connectSSE();
        }
        fetch(`/api/projects/${id}/media?file=subtitles/scene_01.srt`)
          .then(r => setHasSubtitles(r.ok))
          .catch(() => {});
        fetch(`/api/projects/${id}/images`)
          .then(r => r.json())
          .then((data: { images: Array<{ sceneId: string; localPath: string }> }) => {
            if (data.images?.length) setGeneratedImages(data.images);
          })
          .catch(() => {});
      })
      .catch(() => router.push('/'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  function connectSSE() {
    if (esRef.current) esRef.current.close();
    setSseActive(true);
    stageStartRef.current = Date.now();
    lastLogTimeRef.current = Date.now();
    setElapsedSec(0);
    setSilentSec(0);
    const es = new EventSource(`/api/projects/${id}/stream`);
    esRef.current = es;

    es.addEventListener('message', (e: MessageEvent) => {
      try {
        const event: SSEEvent = JSON.parse(e.data);
        if (event.type === 'status') {
          if (!event.status) return;
          if (event.status === 'waiting:images' || event.status === 'waiting:sample-images') { setRegenerating(false); setRegeneratingPrompts(false); }
          setProject(prev => prev ? { ...prev, status: event.status } : prev);
        } else if (event.type === 'log') {
          lastLogTimeRef.current = Date.now();
          setLogs(prev => [...prev, event.message]);
        } else if (event.type === 'cost') {
          setLogs(prev => [...prev, { kind: 'cost', stage: event.stage, toGenerate: event.toGenerate, skipped: event.skipped, costPerUnit: event.costPerUnit, totalCost: event.totalCost }]);
          setProject(prev => prev ? { ...prev, costPreview: { stage: event.stage === 'image' ? 'images' : 'video', toGenerate: event.toGenerate, skipped: event.skipped, costPerUnit: event.costPerUnit, totalCost: event.totalCost } } : prev);
        } else if (event.type === 'llm-cost') {
          setLlmCostUsd(event.totalUsd);
          setProject(prev => prev ? { ...prev, llmCostUsd: event.totalUsd } : prev);
        } else if (event.type === 'concepts') {
          setConcepts(event.concepts);
          setRegeneratingConcepts(false);
        } else if (event.type === 'review') {
          setReviewData({ score: event.score, verdict: event.verdict });
        } else if (event.type === 'image') {
          setGeneratedImages(prev => {
            const filtered = prev.filter(img => img.sceneId !== event.sceneId);
            return [...filtered, { sceneId: event.sceneId, localPath: event.localPath, ts: Date.now() }];
          });
        } else if (event.type === 'error') {
          setLogs(prev => [...prev, `⚠️ ${event.message}`]);
          setProject(prev => prev ? { ...prev, status: 'error', error: event.message } : prev);
          es.close();
          setSseActive(false);
        } else if (event.type === 'done') {
          es.close();
          setSseActive(false);
        }
      } catch { /* ignore parse errors */ }
    });

    es.onerror = () => {
      es.close();
      setSseActive(false);
    };

    return es;
  }

  async function startPipeline() {
    setPipelineStarted(true);
    setLogs([]);
    connectSSE();
    await fetch(`/api/projects/${id}/run`, { method: 'POST' });
  }

  async function handleConceptSelect(conceptIndex: number) {
    await fetch(`/api/projects/${id}/concept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conceptIndex }),
    });
    setLogs([]);
    connectSSE();
  }

  async function handleRegenerateConcepts() {
    if (regeneratingConcepts) return;
    setRegeneratingConcepts(true);
    setLogs([]);
    connectSSE();
    try {
      const res = await fetch(`/api/projects/${id}/regenerate-concepts`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setLogs(prev => [...prev, `❌ 컨셉 재생성 실패: ${body.error ?? res.status}`]);
        setRegeneratingConcepts(false);
      }
      // 성공 시 SSE concepts 이벤트 수신 후 setRegeneratingConcepts(false) 처리
    } catch {
      setLogs(prev => [...prev, '❌ 컨셉 재생성 요청 실패']);
      setRegeneratingConcepts(false);
    }
  }

  async function handleConfirm(): Promise<{ error?: string; hasRevisions?: boolean } | null> {
    const res = await fetch(`/api/projects/${id}/confirm`, { method: 'POST' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return body as { error?: string; hasRevisions?: boolean };
    }
    setLogs([]);
    connectSSE();
    return null;
  }

  async function handleApplyReview() {
    setLogs([]);
    connectSSE();
    await fetch(`/api/projects/${id}/apply-review`, { method: 'POST' });
  }

  async function handleStartTTS() {
    setLogs([]);
    connectSSE();
    await fetch(`/api/projects/${id}/start-tts`, { method: 'POST' });
  }

  async function handleImagesConfirm() {
    setConfirmingImages(true);
    const res = await fetch(`/api/projects/${id}/confirm-images`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json() as { costPreview?: Project['costPreview'] };
      setProject(prev => prev ? { ...prev, status: 'waiting:cost-video', costPreview: data.costPreview } : prev);
    }
    setConfirmingImages(false);
  }

  async function handleRegenerateImages() {
    setRegenerating(true);
    setGeneratedImages([]);
    setLogs([]);
    connectSSE();
    await fetch(`/api/projects/${id}/regenerate-images`, { method: 'POST' });
  }

  async function handleConfirmSamples() {
    setLogs([]);
    connectSSE();
    await fetch(`/api/projects/${id}/confirm-samples`, { method: 'POST' });
  }

  async function handleRegenerateOneImage(sceneId: string) {
    setRegenerating(true);
    setLogs([]);
    connectSSE();
    await fetch(`/api/projects/${id}/regenerate-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenes: [sceneId] }),
    });
  }

  async function handleConfirmCost(stage: 'images' | 'video') {
    setLogs([]);
    connectSSE();
    const res = await fetch(`/api/projects/${id}/confirm-cost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage }),
    });
    if (res.ok) {
      setProject(prev => prev ? { ...prev, status: stage === 'images' ? 'running:images' : 'running:video', costPreview: undefined } : prev);
    }
  }

  async function handleImageModelChange(model: ImageModel) {
    setImageModel(model);
    await fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageModel: model }),
    });
  }

  async function handleLoraUrlBlur(url: string) {
    await fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loraUrl: url }),
    });
  }

  async function handleLoraTriggerWordBlur(word: string) {
    setLoraTriggerWord(word);
    await fetch(`/api/projects/${id}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loraTriggerWord: word }),
    });
  }

  async function handleLoraStyleDescBlur(desc: string) {
    setLoraStyleDesc(desc);
    await fetch(`/api/projects/${id}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loraStyleDesc: desc }),
    });
  }

  async function handleLoraScaleChange(scale: number) {
    const clamped = Math.min(2.0, Math.max(0.1, Math.round(scale * 10) / 10));
    setLoraScale(clamped);
    await fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loraScale: clamped }),
    });
  }

  async function handleRegeneratePrompts() {
    setRegeneratingPrompts(true);
    setRegenerating(false);
    setGeneratedImages([]);
    setLogs([]);
    connectSSE();
    await fetch(`/api/projects/${id}/regenerate-prompts`, { method: 'POST' });
  }

  async function handleUseExistingImages() {
    setConfirmingImages(true);
    const res = await fetch(`/api/projects/${id}/use-existing-images`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json() as { costPreview?: Project['costPreview'] };
      setProject(prev => prev ? { ...prev, status: 'waiting:cost-video', costPreview: data.costPreview } : prev);
    }
    setConfirmingImages(false);
  }

  async function handleYoutubeUrls(urls: string[]) {
    setYoutubeUrlSubmitting(true);
    setLogs([]);
    connectSSE();
    await fetch(`/api/projects/${id}/youtube-urls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
  }

  async function handleRegenerateCapcut() {
    setLogs([]);
    connectSSE();
    await fetch(`/api/projects/${id}/regenerate-capcut`, { method: 'POST' });
  }

  async function handlePatchSubtitles() {
    setLogs([]);
    connectSSE();
    await fetch(`/api/projects/${id}/patch-subtitles`, { method: 'POST' });
  }

  async function handleRegenerateTtsCapcut() {
    setLogs([]);
    connectSSE();
    await fetch(`/api/projects/${id}/regenerate-tts`, { method: 'POST' });
  }

  async function handleRegenerateScene() {
    setLogs([]);
    connectSSE();
    await fetch(`/api/projects/${id}/regenerate-scene`, { method: 'POST' });
  }

  async function handleDelete() {
    if (!confirm('이 프로젝트를 삭제하시겠습니까? 모든 파일이 삭제됩니다.')) return;
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    router.push('/');
  }

  useEffect(() => {
    return () => { esRef.current?.close(); };
  }, []);

  useEffect(() => {
    if (!sseActive) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setElapsedSec(Math.floor((now - stageStartRef.current) / 1000));
      setSilentSec(Math.floor((now - lastLogTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [sseActive]);

  if (!project) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-muted)' }}>
        불러오는 중…
      </div>
    );
  }

  const { stageIdx, running, paused } = getStatusIndex(project.status, project.lastStatus);
  const lastLogStr = logs.reduceRight<string | null>((acc, log) => {
    if (acc !== null) return acc;
    return typeof log === 'string' && !log.startsWith('⚠️') ? log : null;
  }, null);
  const isIdle = project.status === 'idle';
  const isWaitingYoutubeUrls = project.status === 'waiting:youtube-urls';
  const isWaitingConcept = project.status === 'waiting:concept';
  const isWaitingConfirm = project.status === 'waiting:confirm';
  const isWaitingCostImages = project.status === 'waiting:cost-images';
  const isWaitingImages = project.status === 'waiting:images';
  const isWaitingSampleImages = project.status === 'waiting:sample-images';
  const isWaitingCostVideo = project.status === 'waiting:cost-video';
  const isCompleted = project.status === 'completed';
  const isError = project.status === 'error';
  const isRunning = project.status?.startsWith('running:') ?? false;

  const IMAGE_PHASE_STATUSES: PipelineStatus[] = ['running:prompts', 'done:prompts', 'waiting:cost-images', 'running:images', 'waiting:sample-images'];
  const isErrorInImagePhase = isError && !!project.lastStatus && IMAGE_PHASE_STATUSES.includes(project.lastStatus);
  const VIDEO_OR_LATER: PipelineStatus[] = ['waiting:cost-video', 'running:video', 'done:video', 'running:capcut', 'completed'];
  const showUseExistingImages =
    generatedImages.length > 0 &&
    !isWaitingImages &&
    !isWaitingSampleImages &&
    !isWaitingCostVideo &&
    !isRunning &&
    !VIDEO_OR_LATER.includes(project.status);

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
        <button
          onClick={() => router.push('/')}
          style={{ all: 'unset', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}
        >
          ← 목록
        </button>
        <span style={{ color: 'var(--border)' }}>·</span>
        <span style={{ fontSize: 14, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400, flex: 1 }}>
          {project.topic}
        </span>
        <button
          onClick={handleDelete}
          style={{ all: 'unset', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', flexShrink: 0 }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--error)'; e.currentTarget.style.borderColor = 'var(--error)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
          삭제
        </button>
      </div>

      {/* Stage progress */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          {STAGES.map((stage, i) => {
            const isCurrentStage = i === stageIdx;
            const isActive = isCurrentStage && running;
            const isPausedStage = isCurrentStage && paused;
            const isDone = i < stageIdx || (isCurrentStage && !running && !paused);
            const isErrorStage = isError && isCurrentStage;
            return (
              <div key={stage.key} style={{ display: 'flex', alignItems: 'center', flex: i < STAGES.length - 1 ? 1 : 'none' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                  <div className={getStageNodeClass(i, stageIdx, isActive, isPausedStage, isErrorStage)}>
                    {getStageNodeContent(i, stageIdx, isActive, isPausedStage, isErrorStage)}
                  </div>
                  <span style={{
                    fontSize: 10,
                    whiteSpace: 'nowrap',
                    color: isErrorStage ? 'var(--error)' : isPausedStage ? 'var(--warning)' : isActive ? 'var(--accent)' : isDone ? 'var(--success)' : 'var(--text-muted)',
                    fontWeight: isErrorStage || isPausedStage || isActive ? 700 : isDone ? 500 : 400,
                  }}>
                    {stage.label}
                  </span>
                  {isActive && (
                    <span style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 600, letterSpacing: '0.03em' }}>
                      진행중
                    </span>
                  )}
                  {isPausedStage && (
                    <span style={{ fontSize: 9, color: 'var(--warning)', fontWeight: 600, letterSpacing: '0.03em' }}>
                      대기중
                    </span>
                  )}
                  {isErrorStage && (
                    <span style={{ fontSize: 9, color: 'var(--error)', fontWeight: 600, letterSpacing: '0.03em' }}>
                      실패
                    </span>
                  )}
                </div>
                {i < STAGES.length - 1 && (
                  <div style={{
                    flex: 1,
                    height: 2,
                    background: i < stageIdx ? 'var(--success)' : 'var(--border)',
                    margin: '0 4px',
                    marginBottom: isActive ? 28 : 22,
                    borderRadius: 1,
                  }} />
                )}
              </div>
            );
          })}
          {isCompleted && (
            <div style={{ marginLeft: 12, marginBottom: 22 }}>
              <span style={{ fontSize: 18 }}>✅</span>
            </div>
          )}
        </div>
      </div>

      {/* Model / LoRA info bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, fontSize: 12, color: 'var(--text-muted)' }}>
        <span style={{ flexShrink: 0 }}>이미지 모델</span>
        <span style={{
          padding: '2px 8px',
          borderRadius: 4,
          border: '1px solid var(--border)',
          background: 'var(--surface-2)',
          color: 'var(--accent)',
          fontFamily: 'monospace',
          fontSize: 11,
        }}>{imageModel}</span>
        {loraUrl && (
          <>
            <span style={{ flexShrink: 0 }}>LoRA</span>
            <span style={{
              padding: '2px 8px',
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--text-muted)',
              fontFamily: 'monospace',
              fontSize: 11,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 320,
            }} title={loraUrl}>{loraUrl}</span>
            <span style={{
              padding: '2px 8px',
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--text-muted)',
              fontFamily: 'monospace',
              fontSize: 11,
              flexShrink: 0,
            }}>{loraScale.toFixed(1)}</span>
            {loraTriggerWord && (
              <>
                <span style={{ flexShrink: 0 }}>트리거</span>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  color: 'var(--accent)',
                  fontFamily: 'monospace',
                  fontSize: 11,
                  flexShrink: 0,
                }}>{loraTriggerWord}</span>
              </>
            )}
          </>
        )}
      </div>

      {/* Start button (idle state) */}
      {isIdle && !pipelineStarted && (
        <div className="card" style={{ marginBottom: 24, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 0, marginBottom: 16 }}>
            파이프라인을 시작하면 리서치부터 전략 수립까지 자동으로 진행됩니다
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>이미지 모델</span>
            {(
              [
                { value: 'fal-ai/flux-lora', label: 'FLUX.1 LoRA', lora: true, price: 0.035 },
                { value: 'fal-ai/flux/schnell', label: 'FLUX.1 schnell', lora: false, price: 0.003 },
                { value: 'fal-ai/fast-sdxl', label: 'fast-SDXL', lora: true, price: 0.0025 },
                { value: 'fal-ai/flux-2/lora', label: 'FLUX.2 LoRA', lora: true, price: 0.021 },
                { value: 'fal-ai/flux/dev', label: 'FLUX.1 dev', lora: false, price: 0.025 },
                { value: 'fal-ai/flux-2', label: 'FLUX.2', lora: false, price: 0.012 },
              ] as Array<{ value: ImageModel; label: string; lora: boolean; price: number }>
            ).map(opt => (
              <button
                key={opt.value}
                onClick={() => handleImageModelChange(opt.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 11,
                  border: imageModel === opt.value ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: imageModel === opt.value ? 'rgba(124,111,255,0.15)' : 'transparent',
                  color: imageModel === opt.value ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  textAlign: 'left',
                  lineHeight: 1.4,
                }}
              >
                <div style={{ fontWeight: 500 }}>{opt.label}</div>
                <div style={{ display: 'flex', gap: 5, marginTop: 2, fontSize: 10, opacity: 0.8 }}>
                  <span style={{ color: opt.lora ? 'var(--success)' : 'inherit' }}>{opt.lora ? '✓ LoRA' : '✕ LoRA'}</span>
                  <span>·</span>
                  <span>${opt.price}/장</span>
                </div>
              </button>
            ))}
          </div>
          {(imageModel === 'fal-ai/flux-lora' || imageModel === 'fal-ai/fast-sdxl' || imageModel === 'fal-ai/flux-2/lora') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 520, margin: '0 auto 8px' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>LoRA</span>
              <input
                type="url"
                value={loraUrl}
                onChange={e => setLoraUrl(e.target.value)}
                onBlur={e => handleLoraUrlBlur(e.target.value)}
                placeholder="https://huggingface.co/... 또는 fal.ai storage URL"
                style={{
                  flex: 1,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '5px 10px',
                  fontSize: 12,
                  color: 'var(--text)',
                  outline: 'none',
                }}
              />
              {loraUrl && (
                <button
                  onClick={() => { setLoraUrl(''); handleLoraUrlBlur(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}
                  title="LoRA 제거"
                >✕</button>
              )}
            </div>
          )}
          {(imageModel === 'fal-ai/flux-lora' || imageModel === 'fal-ai/fast-sdxl' || imageModel === 'fal-ai/flux-2/lora') && loraUrl && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 520, margin: '0 auto 8px' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>스케일</span>
              <button
                onClick={() => handleLoraScaleChange(loraScale - 0.1)}
                disabled={loraScale <= 0.1}
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', cursor: loraScale <= 0.1 ? 'default' : 'pointer', fontSize: 14, lineHeight: 1, padding: '3px 8px', opacity: loraScale <= 0.1 ? 0.4 : 1 }}
              >−</button>
              <span style={{ fontSize: 13, color: 'var(--text)', minWidth: 32, textAlign: 'center' }}>{loraScale.toFixed(1)}</span>
              <button
                onClick={() => handleLoraScaleChange(loraScale + 0.1)}
                disabled={loraScale >= 2.0}
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', cursor: loraScale >= 2.0 ? 'default' : 'pointer', fontSize: 14, lineHeight: 1, padding: '3px 8px', opacity: loraScale >= 2.0 ? 0.4 : 1 }}
              >+</button>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>0.1 – 2.0</span>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 520, margin: '0 auto 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0, minWidth: 68 }}>트리거 워드</span>
              <input
                type="text"
                value={loraTriggerWord}
                onChange={e => setLoraTriggerWord(e.target.value)}
                onBlur={e => handleLoraTriggerWordBlur(e.target.value)}
                placeholder="예: pixel art"
                style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px', fontSize: 12, color: 'var(--text)', outline: 'none' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0, minWidth: 68 }}>스타일 설명</span>
              <input
                type="text"
                value={loraStyleDesc}
                onChange={e => setLoraStyleDesc(e.target.value)}
                onBlur={e => handleLoraStyleDescBlur(e.target.value)}
                placeholder="예: 수채화 애니메이션 스타일, 파스텔 색감"
                style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px', fontSize: 12, color: 'var(--text)', outline: 'none' }}
              />
            </div>
          </div>
          <button className="btn btn-primary" onClick={startPipeline}>
            🚀 파이프라인 시작
          </button>
        </div>
      )}

      {/* Running state: show log */}
      {(isRunning || sseActive || logs.length > 0) && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ marginBottom: 12 }}>
            {isError ? (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)' }}>
                <span style={{ fontSize: 16, lineHeight: 1.2, flexShrink: 0 }}>🔴</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: 'var(--error)', fontSize: 13 }}>작업이 중단되었습니다 (오류)</div>
                  {lastLogStr && (
                    <div style={{ fontSize: 11, color: 'var(--error)', opacity: 0.75, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      마지막: {lastLogStr}
                    </div>
                  )}
                </div>
              </div>
            ) : isRunning && sseActive ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="status-dot status-dot-running" />
                    <span style={{ fontWeight: 700, color: 'var(--success)', fontSize: 14 }}>실행 중 · {formatSec(elapsedSec)} 경과</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>LLM ${llmCostUsd.toFixed(4)}</span>
                    <span style={{ fontSize: 11, color: 'var(--accent)' }}>실시간 업데이트</span>
                  </div>
                </div>
                {lastLogStr && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', paddingLeft: 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    ↳ {lastLogStr}
                  </div>
                )}
                {silentSec >= 20 && (
                  <div style={{ fontSize: 11, color: 'var(--warning)', paddingLeft: 18, marginTop: 1, padding: '4px 10px', borderRadius: 5, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
                    ⏳ {formatSec(silentSec)}째 응답 없음 — Claude 처리 중 (정상)
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>로그</h3>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>LLM ${llmCostUsd.toFixed(4)}</span>
              </div>
            )}
          </div>
          <div style={{
            background: 'var(--surface-2)',
            borderRadius: 8,
            padding: '12px 16px',
            maxHeight: 240,
            overflowY: 'auto',
            fontFamily: 'monospace',
            fontSize: 12,
            lineHeight: 1.7,
            color: 'var(--text-muted)',
          }}>
            {logs.length === 0 && (
              <span style={{ color: 'var(--border)' }}>로그 대기중…</span>
            )}
            {logs.map((log, i) => {
              if (typeof log !== 'string') {
                const label = log.stage === 'image' ? '🖼️ 이미지 생성' : '🎬 영상 클립 생성';
                const unit = log.stage === 'image' ? '이미지' : '클립';
                return (
                  <div key={i} style={{
                    margin: '6px 0',
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: 'rgba(124,111,255,0.08)',
                    border: '1px solid rgba(124,111,255,0.25)',
                    fontSize: 12,
                  }}>
                    <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 3 }}>
                      💰 {label} 예상 비용
                    </div>
                    <div style={{ color: 'var(--text)' }}>
                      생성 예정: {log.toGenerate}{unit} × ${log.costPerUnit.toFixed(3)} = <strong>${log.totalCost.toFixed(3)}</strong>
                    </div>
                    {log.skipped > 0 && (
                      <div style={{ color: 'var(--text-muted)' }}>
                        이미 완료: {log.skipped}{unit} (건너뜀)
                      </div>
                    )}
                  </div>
                );
              }
              return (
                <div key={i} style={{ color: log.startsWith('⚠️') ? 'var(--error)' : 'var(--text-muted)' }}>
                  {log}
                </div>
              );
            })}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}

      {/* YouTube URL input gate */}
      {isWaitingYoutubeUrls && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px', color: 'var(--text)' }}>
            유튜브 레퍼런스 URL
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 16 }}>
            분석할 유튜브 영상 URL을 한 줄에 하나씩 입력하세요. 해당 영상의 제목·설명을 분석에 반영합니다.<br />
            없으면 건너뛰기를 누르세요.
          </p>
          <textarea
            value={youtubeUrlInput}
            onChange={e => setYoutubeUrlInput(e.target.value)}
            placeholder={'https://www.youtube.com/watch?v=...\nhttps://www.youtube.com/watch?v=...'}
            disabled={youtubeUrlSubmitting}
            rows={4}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text)',
              fontSize: 13,
              padding: '10px 14px',
              resize: 'vertical',
              fontFamily: 'monospace',
              marginBottom: 14,
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn btn-primary"
              disabled={youtubeUrlSubmitting || !youtubeUrlInput.trim()}
              onClick={() => {
                const urls = youtubeUrlInput.split('\n').map(u => u.trim()).filter(Boolean);
                handleYoutubeUrls(urls);
              }}
            >
              {youtubeUrlSubmitting ? '처리중…' : '🔍 URL 분석 후 계속'}
            </button>
            <button
              className="btn btn-outline"
              disabled={youtubeUrlSubmitting}
              onClick={() => handleYoutubeUrls([])}
            >
              건너뛰기
            </button>
          </div>
        </div>
      )}

      {/* Concept selection gate */}
      {isWaitingConcept && concepts && (
        <div className="card" style={{ marginBottom: 24 }}>
          <ConceptSelector concepts={concepts} onSelect={handleConceptSelect} onRegenerate={handleRegenerateConcepts} regenerating={regeneratingConcepts} />
        </div>
      )}

      {/* Script review + confirm gate */}
      {isWaitingConfirm && reviewData && (
        <div className="card" style={{ marginBottom: 24 }}>
          <ReviewView
            key={`${reviewData.score}-${reviewData.verdict}`}
            projectId={id}
            score={reviewData.score}
            verdict={reviewData.verdict}
            onConfirm={handleConfirm}
            onApplyReview={handleApplyReview}
          />
        </div>
      )}

      {/* Image cost preview gate */}
      {isWaitingCostImages && project.costPreview && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
            이미지 생성 예상 비용
          </h3>
          <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 6 }}>
              <span style={{ color: 'var(--text-muted)' }}>생성할 이미지</span>
              <span>{project.costPreview.toGenerate}장 × ${project.costPreview.costPerUnit}</span>
            </div>
            {project.costPreview.skipped > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: 'var(--text-muted)' }}>
                <span>이미 생성됨 (건너뜀)</span>
                <span>{project.costPreview.skipped}장</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <span>예상 총 비용</span>
              <span style={{ color: 'var(--accent)' }}>${project.costPreview.totalCost}</span>
            </div>
          </div>
          {project.costPreview.toGenerate > 3 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, padding: '8px 12px', background: 'rgba(124,111,255,0.06)', borderRadius: 6 }}>
              💡 먼저 3장 샘플을 생성합니다. 스타일 확인 후 나머지 {project.costPreview.toGenerate - 3}장을 생성합니다.
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => handleConfirmCost('images')}>
              확인 — 이미지 생성 시작
            </button>
            {showUseExistingImages && (
              <button className="btn btn-outline" onClick={handleUseExistingImages}>
                기존 이미지 재사용
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sample image confirmation gate */}
      {isWaitingSampleImages && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
            샘플 이미지 확인
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            3장의 샘플 이미지를 확인하세요. 스타일이 마음에 들면 나머지 이미지를 생성합니다.
          </p>
          {generatedImages.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 20 }}>
              {generatedImages.slice(0, 3).map(img => (
                <div key={img.sceneId} style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                  <img
                    src={`/api/projects/${id}/media?file=${encodeURIComponent(img.localPath)}${img.ts ? `&t=${img.ts}` : ''}`}
                    alt={`씬 ${img.sceneId}`}
                    style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }}
                  />
                  <div style={{ padding: '6px 10px' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>씬 {img.sceneId}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={handleConfirmSamples} disabled={generatedImages.length === 0 || regenerating}>
              이 스타일로 계속 생성
            </button>
            <button className="btn btn-outline" onClick={handleRegenerateImages} disabled={regenerating}>
              {regenerating ? '⏳ 생성 중…' : '↻ 샘플 재생성'}
            </button>
          </div>
        </div>
      )}

      {/* Image confirmation gate */}
      {isWaitingImages && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
            생성된 이미지 확인
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            아래 이미지를 검토한 후 영상 생성을 진행해주세요
          </p>
          {generatedImages.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 20 }}>
              {generatedImages.map(img => (
                <div key={img.sceneId} style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                  <img
                    src={`/api/projects/${id}/media?file=${encodeURIComponent(img.localPath)}${img.ts ? `&t=${img.ts}` : ''}`}
                    alt={`씬 ${img.sceneId}`}
                    style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }}
                  />
                  <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>씬 {img.sceneId}</span>
                    <button
                      onClick={() => handleRegenerateOneImage(img.sceneId)}
                      disabled={regenerating || regeneratingPrompts || confirmingImages}
                      style={{ fontSize: 11, padding: '2px 8px', cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)' }}
                      title="이 씬만 재생성"
                    >↻</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '20px', background: 'var(--surface-2)', borderRadius: 8, marginBottom: 20, textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
                이미지가 없습니다. FAL API 키가 서버에 반영되지 않았거나 프롬프트가 잘못되었을 수 있습니다.
              </p>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 520, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0, minWidth: 68 }}>트리거 워드</span>
              <input
                type="text"
                value={loraTriggerWord}
                onChange={e => setLoraTriggerWord(e.target.value)}
                onBlur={e => handleLoraTriggerWordBlur(e.target.value)}
                placeholder="예: pixel art"
                style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px', fontSize: 12, color: 'var(--text)', outline: 'none' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0, minWidth: 68 }}>스타일 설명</span>
              <input
                type="text"
                value={loraStyleDesc}
                onChange={e => setLoraStyleDesc(e.target.value)}
                onBlur={e => handleLoraStyleDescBlur(e.target.value)}
                placeholder="예: 수채화 애니메이션 스타일, 파스텔 색감"
                style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px', fontSize: 12, color: 'var(--text)', outline: 'none' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-success" onClick={handleImagesConfirm} disabled={generatedImages.length === 0 || confirmingImages || regenerating || regeneratingPrompts}>
              {confirmingImages ? '⏳ 영상 생성 준비 중…' : '✓ 이미지 확인 완료 — 영상 생성 시작'}
            </button>
            <button className="btn btn-outline" onClick={handleRegenerateImages} disabled={regenerating || regeneratingPrompts || confirmingImages}>
              {regenerating ? '⏳ 이미지 생성 중…' : '↻ 이미지 재생성'}
            </button>
            <button className="btn btn-outline" onClick={handleRegeneratePrompts} disabled={regenerating || regeneratingPrompts || confirmingImages}>
              {regeneratingPrompts ? '⏳ 프롬프트 재생성 중…' : '📝 씬+프롬프트 재생성'}
            </button>
          </div>
          {generatedImages.length === 0 && !regenerating && !regeneratingPrompts && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              이미지를 먼저 생성해주세요
            </p>
          )}
        </div>
      )}

      {/* Video cost preview gate */}
      {isWaitingCostVideo && project.costPreview && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
            영상 생성 예상 비용
          </h3>
          <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 6 }}>
              <span style={{ color: 'var(--text-muted)' }}>생성할 클립</span>
              <span>{project.costPreview.toGenerate}개 × ${project.costPreview.costPerUnit}</span>
            </div>
            {project.costPreview.skipped > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: 'var(--text-muted)' }}>
                <span>이미 생성됨 (건너뜀)</span>
                <span>{project.costPreview.skipped}개</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <span>예상 총 비용</span>
              <span style={{ color: 'var(--accent)' }}>${project.costPreview.totalCost}</span>
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => handleConfirmCost('video')}>
            확인 — 영상 생성 시작
          </button>
        </div>
      )}

      {/* Completed state */}
      {isCompleted && (
        <div className="card" style={{ marginBottom: 24, borderColor: 'rgba(74,222,128,0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <span style={{ fontSize: 24 }}>🎉</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: 'var(--success)', fontSize: 16 }}>제작 완료!</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>모든 파일이 준비되었습니다</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>LLM 비용</div>
              <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)' }}>${llmCostUsd.toFixed(4)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <FileLink projectId={id} file="script-final.md" label="최종 대본" />
            <FileLink projectId={id} file="script-review.md" label="검토 리포트" />
            <FileLink projectId={id} file="brief.md" label="기획서" />
            <FileLink projectId={id} file="scene-design.md" label="씬 설계서" />
            <FileLink projectId={id} file="image-prompts.md" label="이미지 프롬프트" />
            <FileLink projectId={id} file="research.md" label="리서치" />
            <FileLink projectId={id} file="strategy.md" label="전략" />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: '5px 14px' }}
              onClick={handleRegenerateCapcut}
            >
              ↺ CapCut 프로젝트 재생성
            </button>
            <button
              className="btn btn-outline"
              style={{ fontSize: 12, padding: '5px 14px' }}
              onClick={handleRegenerateTtsCapcut}
            >
              🎙️ TTS + CapCut 재생성
            </button>
            <button
              className="btn btn-outline"
              style={{ fontSize: 12, padding: '5px 14px' }}
              onClick={handlePatchSubtitles}
            >
              ✏️ 자막 패치 + CapCut 재생성
            </button>
            <button
              className="btn btn-outline"
              style={{ fontSize: 12, padding: '5px 14px' }}
              onClick={handleRegenerateScene}
            >
              🎬 씬 설계 재생성
            </button>
          </div>
        </div>
      )}

      {/* Error state */}
      {isError && project.error && (
        <div className="card" style={{ marginBottom: 24, borderColor: 'rgba(248,113,113,0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>⚠️</span>
              <span style={{ fontWeight: 700, color: 'var(--error)', fontSize: 15 }}>오류 발생</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-outline"
                style={{ fontSize: 12, padding: '5px 12px' }}
                onClick={startPipeline}
              >
                ↺ 이어서 재시도
              </button>
              {!hasSubtitles && (
                <button
                  className="btn btn-outline"
                  style={{ fontSize: 12, padding: '5px 12px' }}
                  onClick={handleStartTTS}
                >
                  ▶ TTS부터 재시작
                </button>
              )}
            </div>
          </div>
          <pre style={{ color: 'var(--error)', fontSize: 12, margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
            {(() => {
              try {
                const spaceIdx = project.error!.indexOf(' ');
                const json = spaceIdx > 0 ? JSON.parse(project.error!.slice(spaceIdx + 1)) : null;
                return json?.error?.message ?? project.error;
              } catch { return project.error; }
            })()}
          </pre>
        </div>
      )}

      {/* File downloads (when done with stages) */}
      {(stageIdx >= 1 || isCompleted) && !isError && (
        <div className="card">
          <h3 style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            파일 다운로드
          </h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {stageIdx >= 0 && <FileLink projectId={id} file="research.md" label="리서치" />}
            {stageIdx >= 1 && <FileLink projectId={id} file="strategy.md" label="전략" />}
            {stageIdx >= 2 && <FileLink projectId={id} file="concept.md" label="선택 컨셉" />}
            {stageIdx >= 3 && <FileLink projectId={id} file="brief.md" label="기획서" />}
            {stageIdx >= 4 && <FileLink projectId={id} file="script-final.md" label="대본" />}
            {stageIdx >= 4 && <FileLink projectId={id} file="script-review.md" label="검토 리포트" />}
          </div>
        </div>
      )}
    </div>
  );
}
