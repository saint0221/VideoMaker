'use client';

import { useState, useEffect, useRef } from 'react';
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
  const [pickingFolder, setPickingFolder] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState('');
  const [voices, setVoices] = useState<{ voice_id: string; name: string; category: string; preview_url: string; labels: Record<string, string> }[]>([]);
  const [koOnly, setKoOnly] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [playingVoiceId, setPlayingVoiceId] = useState('');
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const [voiceTab, setVoiceTab] = useState<'my' | 'library'>('my');
  const [libSearch, setLibSearch] = useState('');
  const [libLang, setLibLang] = useState('');
  const [libVoices, setLibVoices] = useState<{ public_owner_id: string; voice_id: string; name: string; language: string; preview_url: string; category: string; gender: string; cloned_by_count: number }[]>([]);
  const [libLoading, setLibLoading] = useState(false);
  const [libError, setLibError] = useState('');
  const [addingVoiceId, setAddingVoiceId] = useState('');
  const [voicesError, setVoicesError] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (!confirm('이 프로젝트를 삭제하시겠습니까?')) return;
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    setProjects(prev => prev.filter(p => p.id !== id));
  }

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(s => {
      setCapcutRoot(s.capcutRoot ?? '');
      setSelectedVoiceId(s.voiceId ?? '');
    }).catch(() => {});
    fetch('/api/settings/voices').then(r => r.json()).then(data => {
      if (data.voices) setVoices(data.voices);
      else setVoicesError(data.error ?? '음성 목록을 불러오지 못했습니다.');
    }).catch(() => setVoicesError('음성 목록을 불러오지 못했습니다.'));
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

  async function handleDetect() {
    setDetecting(true);
    setDetectMsg('');
    try {
      const res = await fetch('/api/settings/detect-capcut');
      const data = await res.json();
      if (data.path) {
        setCapcutRoot(data.path);
        setDetectMsg('✓ 자동 감지 성공');
      } else {
        setDetectMsg('CapCut 경로를 찾지 못했습니다. 직접 입력하거나 폴더를 선택해주세요.');
      }
    } catch {
      setDetectMsg('감지 중 오류가 발생했습니다.');
    } finally {
      setDetecting(false);
    }
  }

  async function handlePickFolder() {
    setPickingFolder(true);
    try {
      const res = await fetch('/api/settings/pick-folder', { method: 'POST' });
      const data = await res.json();
      if (data.path) setCapcutRoot(data.path);
    } catch {
      // 무시
    } finally {
      setPickingFolder(false);
    }
  }

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

  async function handleSelectVoice(voiceId: string) {
    setSelectedVoiceId(voiceId);
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceId }),
    });
  }

  function handlePlayPreview(voice: { voice_id: string; preview_url: string; labels: Record<string, string> }) {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if (playingVoiceId === voice.voice_id) {
      setPlayingVoiceId('');
      return;
    }
    setPlayingVoiceId(voice.voice_id);
    const audio = new Audio(voice.preview_url);
    currentAudioRef.current = audio;
    audio.play();
    audio.onended = () => { currentAudioRef.current = null; setPlayingVoiceId(''); };
    audio.onerror = () => { currentAudioRef.current = null; setPlayingVoiceId(''); };
  }

  async function handleLibSearch() {
    setLibLoading(true);
    setLibError('');
    try {
      const params = new URLSearchParams({ page_size: '24' });
      if (libSearch) params.set('search', libSearch);
      if (libLang) params.set('language', libLang);
      const res = await fetch(`/api/settings/voices/library?${params}`);
      const data = await res.json();
      if (data.voices) setLibVoices(data.voices);
      else setLibError(data.error ?? '검색 실패');
    } catch {
      setLibError('검색 중 오류가 발생했습니다.');
    } finally {
      setLibLoading(false);
    }
  }

  async function handleAddVoice(v: { public_owner_id: string; voice_id: string; name: string }) {
    setAddingVoiceId(v.voice_id);
    try {
      const res = await fetch('/api/settings/voices/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicOwnerId: v.public_owner_id, voiceId: v.voice_id, name: v.name }),
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      const refreshed = await fetch('/api/settings/voices').then(r => r.json());
      if (refreshed.voices) setVoices(refreshed.voices);
      handleSelectVoice(data.voice_id);
      setVoiceTab('my');
    } finally {
      setAddingVoiceId('');
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
        body: JSON.stringify({ topic: topic.trim(), aspectRatio }),
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
        <form onSubmit={handleCreate}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
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
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>비율:</span>
            {(['16:9', '9:16'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setAspectRatio(r)}
                disabled={creating}
                style={{
                  padding: '4px 12px',
                  borderRadius: 6,
                  border: `1px solid ${aspectRatio === r ? 'var(--accent)' : 'var(--border)'}`,
                  background: aspectRatio === r ? 'var(--accent)' : 'var(--surface-2)',
                  color: aspectRatio === r ? '#fff' : 'var(--text-muted)',
                  fontSize: 13,
                  fontWeight: aspectRatio === r ? 600 : 400,
                  cursor: creating ? 'not-allowed' : 'pointer',
                }}
              >
                {r === '16:9' ? '16:9 (가로)' : '9:16 (숏츠)'}
              </button>
            ))}
          </div>
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
        <form onSubmit={handleSaveSettings} style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={capcutRoot}
            onChange={e => { setCapcutRoot(e.target.value); setDetectMsg(''); }}
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
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleDetect}
            disabled={detecting}
            style={{ whiteSpace: 'nowrap' }}
          >
            {detecting ? '감지 중…' : '자동 감지'}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={handlePickFolder}
            disabled={pickingFolder}
            style={{ whiteSpace: 'nowrap' }}
          >
            {pickingFolder ? '열리는 중…' : '폴더 선택'}
          </button>
          <button type="submit" className="btn btn-outline" style={{ whiteSpace: 'nowrap' }}>
            {settingsSaved ? '저장됨 ✓' : '저장'}
          </button>
        </form>
        {detectMsg && (
          <p style={{ color: detectMsg.startsWith('✓') ? 'var(--success)' : 'var(--text-muted)', fontSize: 13, marginTop: 8, marginBottom: 0 }}>
            {detectMsg}
          </p>
        )}
        {settingsError && (
          <p style={{ color: 'var(--error)', fontSize: 13, marginTop: 8, marginBottom: 0 }}>
            {settingsError}
          </p>
        )}

        <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 20 }}>
          {/* 헤더: 타이틀 + 탭 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, flex: 1 }}>
              TTS 음성 선택
              {selectedVoiceId && voices.length > 0 && (
                <span style={{ marginLeft: 8, color: 'var(--accent)', fontWeight: 500 }}>
                  — {voices.find(v => v.voice_id === selectedVoiceId)?.name ?? selectedVoiceId}
                </span>
              )}
            </p>
            {(['my', 'library'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setVoiceTab(tab)}
                style={{
                  fontSize: 12,
                  padding: '3px 10px',
                  borderRadius: 12,
                  border: `1px solid ${voiceTab === tab ? 'var(--accent)' : 'var(--border)'}`,
                  background: voiceTab === tab ? 'rgba(124,111,255,0.12)' : 'transparent',
                  color: voiceTab === tab ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab === 'my' ? '내 보이스' : 'Voice Library'}
              </button>
            ))}
            {voiceTab === 'my' && (
              <button
                onClick={() => setKoOnly(v => !v)}
                style={{
                  fontSize: 12,
                  padding: '3px 10px',
                  borderRadius: 12,
                  border: `1px solid ${koOnly ? 'var(--accent)' : 'var(--border)'}`,
                  background: koOnly ? 'rgba(124,111,255,0.12)' : 'transparent',
                  color: koOnly ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                🇰🇷 한국어만
              </button>
            )}
          </div>

          {/* 내 보이스 탭 */}
          {voiceTab === 'my' && (
            voicesError ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{voicesError}</p>
            ) : voices.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>불러오는 중…</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
                {voices.filter(v => !koOnly || /korean|ko/i.test(v.labels?.language ?? '')).map(v => {
                  const isSelected = selectedVoiceId === v.voice_id;
                  const isPlaying = playingVoiceId === v.voice_id;
                  return (
                    <div
                      key={v.voice_id}
                      onClick={() => handleSelectVoice(v.voice_id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                        background: isSelected ? 'rgba(124,111,255,0.08)' : 'var(--surface-2)',
                        cursor: 'pointer',
                        transition: 'border-color 0.15s',
                      }}
                    >
                      <button
                        onClick={e => { e.stopPropagation(); handlePlayPreview(v); }}
                        style={{
                          flexShrink: 0, width: 28, height: 28, borderRadius: '50%',
                          border: 'none',
                          background: isPlaying ? 'var(--accent)' : 'var(--surface)',
                          color: isPlaying ? '#fff' : 'var(--text-muted)',
                          cursor: 'pointer', fontSize: 11,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                        title="미리듣기"
                      >
                        {isPlaying ? '■' : '▶'}
                      </button>
                      <span style={{ fontSize: 13, fontWeight: isSelected ? 600 : 400, color: 'var(--text)', flex: 1 }}>
                        {v.name}
                      </span>
                      {v.labels?.language && (
                        <span style={{
                          fontSize: 11,
                          color: /korean|ko/i.test(v.labels.language) ? '#4ade80' : 'var(--text-muted)',
                          background: 'var(--surface)', padding: '2px 6px', borderRadius: 4,
                        }}>
                          {v.labels.language}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--surface)', padding: '2px 6px', borderRadius: 4 }}>
                        {v.category}
                      </span>
                      {isSelected && <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>선택됨</span>}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* Voice Library 탭 */}
          {voiceTab === 'library' && (
            <div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <input
                  value={libSearch}
                  onChange={e => setLibSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLibSearch()}
                  placeholder="이름 검색 (예: Korean, Rachel...)"
                  style={{
                    flex: 1, padding: '6px 10px', borderRadius: 8,
                    border: '1px solid var(--border)', background: 'var(--surface-2)',
                    color: 'var(--text)', fontSize: 13,
                  }}
                />
                <select
                  value={libLang}
                  onChange={e => setLibLang(e.target.value)}
                  style={{
                    padding: '6px 8px', borderRadius: 8,
                    border: '1px solid var(--border)', background: 'var(--surface-2)',
                    color: 'var(--text)', fontSize: 13,
                  }}
                >
                  <option value="">전체 언어</option>
                  <option value="ko">한국어</option>
                  <option value="en">영어</option>
                  <option value="ja">일본어</option>
                  <option value="zh">중국어</option>
                </select>
                <button
                  onClick={handleLibSearch}
                  disabled={libLoading}
                  className="btn btn-primary"
                  style={{ fontSize: 13, padding: '6px 14px', whiteSpace: 'nowrap' }}
                >
                  {libLoading ? '검색 중…' : '검색'}
                </button>
              </div>
              {libError && <p style={{ fontSize: 13, color: 'var(--error)', margin: '0 0 8px' }}>{libError}</p>}
              {libVoices.length === 0 && !libLoading && (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                  검색어를 입력하고 검색 버튼을 눌러주세요.
                </p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
                {libVoices.map(v => {
                  const isPlaying = playingVoiceId === v.voice_id;
                  const isAdding = addingVoiceId === v.voice_id;
                  return (
                    <div
                      key={v.voice_id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 12px', borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--surface-2)',
                      }}
                    >
                      <button
                        onClick={() => handlePlayPreview({ voice_id: v.voice_id, preview_url: v.preview_url, labels: { language: v.language } })}
                        style={{
                          flexShrink: 0, width: 28, height: 28, borderRadius: '50%',
                          border: 'none',
                          background: isPlaying ? 'var(--accent)' : 'var(--surface)',
                          color: isPlaying ? '#fff' : 'var(--text-muted)',
                          cursor: 'pointer', fontSize: 11,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                        title="미리듣기"
                      >
                        {isPlaying ? '■' : '▶'}
                      </button>
                      <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>{v.name}</span>
                      {v.language && (
                        <span style={{ fontSize: 11, color: /ko/i.test(v.language) ? '#4ade80' : 'var(--text-muted)', background: 'var(--surface)', padding: '2px 6px', borderRadius: 4 }}>
                          {v.language}
                        </span>
                      )}
                      {v.gender && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--surface)', padding: '2px 6px', borderRadius: 4 }}>
                          {v.gender}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {v.cloned_by_count.toLocaleString()}명 사용
                      </span>
                      <button
                        onClick={() => handleAddVoice(v)}
                        disabled={isAdding}
                        className="btn btn-outline"
                        style={{ fontSize: 12, padding: '3px 10px', whiteSpace: 'nowrap' }}
                      >
                        {isAdding ? '추가 중…' : '+ 추가'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
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
