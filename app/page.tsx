'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Project, PipelineStatus } from '@/lib/types';

function statusBadge(status: PipelineStatus) {
  if (status === 'idle') return { cls: 'badge badge-idle', label: '대기중' };
  if (status?.startsWith('running:')) return { cls: 'badge badge-running', label: '실행중' };
  if (status?.startsWith('waiting:')) return { cls: 'badge badge-waiting', label: '입력 필요' };
  if (status === 'completed') return { cls: 'badge badge-completed', label: '완료' };
  if (status === 'error') return { cls: 'badge badge-error', label: '오류' };
  return { cls: 'badge badge-idle', label: status };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}일 전`;
  if (h > 0) return `${h}시간 전`;
  if (m > 0) return `${m}분 전`;
  return '방금 전';
}

export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [topic, setTopic] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [capcutRoot, setCapcutRoot] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsError, setSettingsError] = useState('');

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (!confirm('이 프로젝트를 삭제하시겠습니까?')) return;
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    setProjects(prev => prev.filter(p => p.id !== id));
  }

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(s => setCapcutRoot(s.capcutRoot ?? '')).catch(() => {});
  }, []);

  useEffect(() => {
    function refresh() {
      fetch('/api/projects')
        .then(r => r.json())
        .then((ps: Project[]) => {
          setProjects(ps);
          const hasRunning = ps.some(p => p.status?.startsWith('running:') || p.status?.startsWith('waiting:'));
          if (hasRunning) {
            timer = window.setTimeout(refresh, 3000);
          }
        })
        .catch(() => {});
    }
    let timer: number;
    refresh();
    return () => window.clearTimeout(timer);
  }, []);

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSettingsError('');
    setSettingsSaved(false);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capcutRoot }),
      });
      if (!res.ok) throw new Error('저장 실패');
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
    } catch {
      setSettingsError('설정 저장에 실패했습니다.');
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim()) return;
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topic.trim() }),
      });
      if (!res.ok) throw new Error('프로젝트 생성 실패');
      const project: Project = await res.json();
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
      setCreating(false);
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '48px 24px' }}>
      <header style={{ marginBottom: 48 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 28 }}>🎬</span>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: 'var(--text)' }}>
            YouTube PD
          </h1>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>
          주제를 입력하면 리서치 → 전략 → 기획 → 대본 → 검토 → TTS → 씬설계 → 이미지프롬프트 → 이미지생성 → 영상생성 → 캡컷편집까지 자동으로 진행합니다
        </p>
      </header>

      <section className="card" style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 16, color: 'var(--text)' }}>
          새 영상 제작
        </h2>
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: 12 }}>
          <input
            type="text"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder="예: 조선시대 왕들의 충격적인 죽음"
            disabled={creating}
            style={{
              flex: 1,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '10px 16px',
              color: 'var(--text)',
              fontSize: 14,
              outline: 'none',
            }}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={creating || !topic.trim()}
          >
            {creating ? '생성중…' : '시작'}
          </button>
        </form>
        {error && (
          <p style={{ color: 'var(--error)', fontSize: 13, marginTop: 8, marginBottom: 0 }}>
            {error}
          </p>
        )}
      </section>

      <section className="card" style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 4, color: 'var(--text)' }}>
          설정
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 16 }}>
          CapCut 프로젝트 저장 경로
        </p>
        <form onSubmit={handleSaveSettings} style={{ display: 'flex', gap: 12 }}>
          <input
            type="text"
            value={capcutRoot}
            onChange={e => setCapcutRoot(e.target.value)}
            placeholder="~/Movies/CapCut/User Data/Projects/com.lveditor.draft"
            style={{
              flex: 1,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '10px 16px',
              color: 'var(--text)',
              fontSize: 13,
              outline: 'none',
              fontFamily: 'monospace',
            }}
          />
          <button type="submit" className="btn btn-outline" style={{ whiteSpace: 'nowrap' }}>
            {settingsSaved ? '저장됨 ✓' : '저장'}
          </button>
        </form>
        {settingsError && (
          <p style={{ color: 'var(--error)', fontSize: 13, marginTop: 8, marginBottom: 0 }}>
            {settingsError}
          </p>
        )}
      </section>

      {projects.length > 0 && (
        <section>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 16, marginTop: 0 }}>
            최근 프로젝트 ({projects.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[...projects].reverse().map(p => {
              const { cls, label } = statusBadge(p.status);
              return (
                <Link
                  key={p.id}
                  href={`/projects/${encodeURIComponent(p.id)}`}
                  style={{
                    textDecoration: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px 20px',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    transition: 'border-color 0.15s',
                    boxSizing: 'border-box',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.topic}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {timeAgo(p.updatedAt)}
                      {p.reviewScore ? ` · 검토 점수 ${p.reviewScore}점` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 16, flexShrink: 0 }}>
                    <span className={cls}>{label}</span>
                    <button
                      onClick={e => handleDelete(e, p.id)}
                      style={{ all: 'unset', cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)', padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)' }}
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--error)'; e.currentTarget.style.borderColor = 'var(--error)'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
                    >
                      삭제
                    </button>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {projects.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 0', fontSize: 14 }}>
          아직 프로젝트가 없습니다. 첫 번째 영상을 만들어보세요!
        </div>
      )}
    </div>
  );
}
