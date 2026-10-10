import { useEffect, useState } from 'react';
import { Record } from './Record';
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
  const live = rec.phase === 'recording' || rec.phase === 'paused';

  // recording indicator in the tab title; pause shortcut
  useEffect(() => {
    const base = 'Flatpak';
    document.title = rec.phase === 'recording' ? '● REC · ' + base : rec.phase === 'paused' ? '❚❚ paused · ' + base : base + ' — screen memory. stays on your device.';
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
          {live && <span className={'rec-pill' + (rec.phase === 'paused' ? ' paused' : '')} role="status"><b aria-hidden />{rec.phase === 'paused' ? 'PAUSED' : 'REC'}</span>}
          <nav aria-label="Main">
            {PAGES.map((p) => (
              <button key={p.id} aria-current={page === p.id ? 'page' : undefined} onClick={() => setPage(p.id)}>{p.label}</button>
            ))}
          </nav>
        </div>
      </header>
      <main>
        <div className="wrap">
          {page === 'record' && <Record />}
          {page !== 'record' && <p className="lead">Coming in a later phase.</p>}
        </div>
      </main>
    </>
  );
}
