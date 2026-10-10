import { useEffect, useState, type ReactNode } from 'react';
import { Record } from './Record';
import { SearchPage } from './Search';
import { TimelinePage } from './Timeline';
import { PrivacyPage } from './Privacy';
import { BenchmarkPage } from './Benchmark';
import { Overview } from './Overview';
import { AskPage } from './Ask';
import { Landing } from './Landing';
import { APP_PAGES, href, useRoute, type AppPage } from './router';
import { closeStaleSessions, expireOld, getSettings } from '../store/db';
import { MiniRecorder, openMini } from './Mini';
import { recorder } from '../capture/recorder';
import { useRecorder } from './useRecorder';

const META: Record<AppPage, { label: string; title: string; blurb: string; icon: ReactNode }> = {
  overview: { label: 'Overview', title: 'Overview', blurb: 'What Flatpak is holding for you right now, and what it can do next.', icon: <path d="M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 14h7v5H4z" /> },
  record: { label: 'Record', title: 'Record', blurb: "Pick a screen or window. Flatpak keeps what changed, blurs what's sensitive, and forgets the rest.", icon: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></> },
  search: { label: 'Search', title: 'Search', blurb: 'Describe what you remember, or quote the words on the screen. Visual and text matches are fused.', icon: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.2-4.2" /></> },
  timeline: { label: 'Timeline', title: 'Timeline', blurb: "Your screen time, split into blocks by gaps and by how far the screen's meaning drifts.", icon: <path d="M5 4v16M5 7h9M5 12h14M5 17h7" /> },
  ask: { label: 'Ask AI', title: 'Ask AI', blurb: 'Optional. Bring your own Gemini key to analyze frames and ask questions about what you saw.', icon: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z" /> },
  privacy: { label: 'Privacy & data', title: 'Privacy & data', blurb: 'What happens to every frame, what leaves this browser (nothing, unless you say so), and how to erase it.', icon: <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /> },
  benchmark: { label: 'Benchmark', title: 'Benchmark', blurb: 'Labelled queries over the demo screens, run on this device with the real models.', icon: <path d="M5 20V10M12 20V4M19 20v-7" /> },
};

function Dashboard({ page }: { page: AppPage }) {
  const rec = useRecorder();
  const [pip, setPip] = useState<Window | null>(null);
  const [quota, setQuota] = useState<number | null>(null);
  const live = rec.phase === 'recording' || rec.phase === 'paused';
  const m = META[page];
  useEffect(() => {
    const check = async () => { const e = await navigator.storage?.estimate?.(); if (e?.usage !== undefined && e.quota) setQuota(e.usage / e.quota); };
    void check();
    const t = setInterval(() => void check(), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const base = `${m.title} · Flatpak`;
    document.title = rec.phase === 'recording' ? '● REC · ' + base : rec.phase === 'paused' ? '❚❚ paused · ' + base : base;
  }, [rec.phase, m.title]);
  return (
    <div className="app">
      <aside className="side">
        <a className="brand" href="#/"><span className="logo" aria-hidden />Flatpak</a>
        <nav aria-label="Main">
          {APP_PAGES.map((p) => (
            <a key={p} href={href(p)} aria-current={page === p ? 'page' : undefined}>
              <svg viewBox="0 0 24 24" aria-hidden>{META[p].icon}</svg>{META[p].label}
            </a>
          ))}
        </nav>
        <div className="spacer" />
        <div className="side-foot">Everything stays in this browser.<br /><a href="#/">Back to home</a></div>
      </aside>
      <div className="main">
        <div className="topbar">
          {live ? <span className={'rec-pill' + (rec.phase === 'paused' ? ' paused' : '')} role="status"><b aria-hidden />{rec.phase === 'paused' ? 'PAUSED' : 'REC'}</span> : <span className="muted" style={{ fontSize: 'var(--t-sm)' }}><span className="status-dot on" aria-hidden />On device · no uploads</span>}
          <div className="grow" />
          {live && 'documentPictureInPicture' in window && !pip && <button className="btn" onClick={() => void openMini().then((w) => { if (w) { w.addEventListener('pagehide', () => setPip(null)); setPip(w); } })}>Mini recorder</button>}
          <ThemeButton />
        </div>
        {pip && <MiniRecorder win={pip} />}
        {quota !== null && quota > 0.8 && <div className="notice err" role="alert" style={{ margin: '16px 32px 0' }}>Browser storage is {(quota * 100).toFixed(0)}% full. Flatpak will drop its oldest frames when it runs out. Delete old sessions in Privacy &amp; data.</div>}
        <main className="content">
          <header className="page-head"><h1>{m.title}</h1><p>{m.blurb}</p></header>
          {page === 'overview' && <Overview />}
          {page === 'record' && <Record />}
          {page === 'search' && <SearchPage />}
          {page === 'timeline' && <TimelinePage />}
          {page === 'ask' && <AskPage />}
          {page === 'privacy' && <PrivacyPage />}
          {page === 'benchmark' && <BenchmarkPage />}
        </main>
      </div>
    </div>
  );
}

function ThemeButton() {
  const [t, setT] = useState<string>(() => { try { return localStorage.getItem('flatpak-theme') ?? 'auto'; } catch { return 'auto'; } });
  useEffect(() => {
    const el = document.documentElement;
    if (t === 'auto') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', t);
    try { localStorage.setItem('flatpak-theme', t); } catch { /* storage blocked */ }
  }, [t]);
  const next = t === 'auto' ? 'dark' : t === 'dark' ? 'light' : 'auto';
  return <button className="btn theme-btn" onClick={() => setT(next)} aria-label={`Theme: ${t}. Switch to ${next}`} title={`Theme: ${t}`}>{t === 'dark' ? 'Dark' : t === 'light' ? 'Light' : 'Auto'}</button>;
}

export function App() {
  const route = useRoute();
  useEffect(() => {
    // a reload or crash leaves sessions open: close them at their last frame, then apply expiry
    void closeStaleSessions().catch(() => undefined);
    void getSettings().then((st) => (st.expiryDays ? expireOld(st.expiryDays) : 0)).catch(() => undefined);
  }, []);
  // favicon doubles as a recording indicator
  const rec = useRecorder();
  useEffect(() => {
    const link = document.getElementById('favicon') as HTMLLinkElement | null;
    if (!link) return;
    const dot = rec.phase === 'recording' ? '%23C42F1E' : rec.phase === 'paused' ? '%23888' : '';
    link.href = dot
      ? `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23141816'/%3E%3Ccircle cx='16' cy='16' r='8' fill='${dot}'/%3E%3C/svg%3E`
      : `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%230B6B58'/%3E%3Crect x='10' y='10' width='12' height='12' rx='3' fill='%23F5F3EE'/%3E%3C/svg%3E`;
  }, [rec.phase]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.altKey && e.shiftKey && e.code === 'KeyP') { e.preventDefault(); recorder().toggle(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => {
    if (route.kind === 'landing') document.title = 'Flatpak — screen memory. stays on your device.';
  }, [route]);
  return route.kind === 'landing' ? <Landing /> : <Dashboard page={route.page} />;
}
