import { useEffect, useState } from 'react';
import { Record } from './Record';
import { SearchPage } from './Search';
import { TimelinePage } from './Timeline';
import { PrivacyPage } from './Privacy';
import { BenchmarkPage } from './Benchmark';
import { closeStaleSessions, expireOld, getSettings } from '../store/db';
import { MiniRecorder, openMini } from './Mini';
import { recorder } from '../capture/recorder';
import { useRecorder } from './useRecorder';

type Page = 'record' | 'search' | 'timeline' | 'privacy' | 'benchmark';
const PAGES: { id: Page; label: string }[] = [
  { id: 'record', label: 'Record' },
  { id: 'search', label: 'Search' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'benchmark', label: 'Benchmark' },
];

export function App() {
  const [page, setPage] = useState<Page>('record');
  const rec = useRecorder();
  const [pip, setPip] = useState<Window | null>(null);
  const [quota, setQuota] = useState<number | null>(null);
  useEffect(() => {
    // a reload or crash leaves sessions open: close them at their last frame (their data is all in IndexedDB), then apply expiry
    void closeStaleSessions().catch(() => undefined);
    void getSettings().then((st) => (st.expiryDays ? expireOld(st.expiryDays) : 0)).catch(() => undefined);
  }, []);
  useEffect(() => {
    const check = async () => { const e = await navigator.storage?.estimate?.(); if (e?.usage !== undefined && e.quota) setQuota(e.usage / e.quota); };
    void check();
    const t = setInterval(() => void check(), 15_000);
    return () => clearInterval(t);
  }, []);
  const live = rec.phase === 'recording' || rec.phase === 'paused';

  // recording indicator in the tab title; pause shortcut
  useEffect(() => {
    const base = 'Flatpak';
    document.title = rec.phase === 'recording' ? '● REC · ' + base : rec.phase === 'paused' ? '❚❚ paused · ' + base : base + ' — screen memory. stays on your device.';
  }, [rec.phase]);
  // favicon doubles as a recording indicator
  useEffect(() => {
    const link = document.getElementById('favicon') as HTMLLinkElement | null;
    if (!link) return;
    const dot = rec.phase === 'recording' ? '%23D62828' : rec.phase === 'paused' ? '%23888' : '';
    link.href = dot
      ? `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23111'/%3E%3Ccircle cx='16' cy='16' r='9' fill='${dot}'/%3E%3C/svg%3E`
      : `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23111'/%3E%3Crect x='6' y='6' width='20' height='20' fill='%23FFD60A'/%3E%3C/svg%3E`;
  }, [rec.phase]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.code === 'KeyP') {
        e.preventDefault();
        recorder().toggle();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  return (
    <>
      <header className="top">
        <div className="wrap">
          <div className="brand"><i aria-hidden /> Flatpak</div>
          {live && 'documentPictureInPicture' in window && !pip && <button className="btn" onClick={() => void openMini().then((w) => { if (w) { w.addEventListener('pagehide', () => setPip(null)); setPip(w); } })}>Mini recorder</button>}
          {live && <span className={'rec-pill' + (rec.phase === 'paused' ? ' paused' : '')} role="status"><b aria-hidden />{rec.phase === 'paused' ? 'PAUSED' : 'REC'}</span>}
          <nav aria-label="Main">
            {PAGES.map((p) => (
              <button key={p.id} aria-current={page === p.id ? 'page' : undefined} onClick={() => setPage(p.id)}>{p.label}</button>
            ))}
          </nav>
        </div>
      </header>
      {pip && <MiniRecorder win={pip} />}
      {quota !== null && quota > 0.8 && <div className="notice err" role="alert" style={{ margin: 0 }}>Browser storage is {(quota * 100).toFixed(0)}% full. Flatpak will drop its oldest frames when it runs out. Delete old sessions on the Privacy tab.</div>}
      <main>
        <div className="wrap">
          {page === 'record' && (
            <div className="hero">
              <h1>Ctrl+F for everything you've looked at.</h1>
              <p className="lead">Search what you saw and heard, 100% in your browser: no account, no upload, no server. <b>Screen memory. Stays on your device.</b></p>
            </div>
          )}
          {page === 'record' && <Record />}
          {page === 'search' && <SearchPage />}
          {page === 'timeline' && <TimelinePage />}
          {page === 'privacy' && <PrivacyPage />}
          {page === 'benchmark' && <BenchmarkPage />}
        </div>
      </main>
    </>
  );
}
