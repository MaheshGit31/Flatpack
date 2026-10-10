import { createPortal } from 'react-dom';
import { recorder } from '../capture/recorder';
import { useRecorder } from './useRecorder';
import { fmtClock } from '../util/format';

/** Rendered into a Document Picture-in-Picture window so the recorder stays visible (and pausable) over other apps. */
export function MiniRecorder({ win }: { win: Window }) {
  const s = useRecorder();
  const paused = s.phase === 'paused';
  return createPortal(
    <div className="mini" role="region" aria-label="Flatpak recorder">
      <span className={'rec-pill' + (paused ? ' paused' : '')} role="status"><b aria-hidden />{paused ? 'PAUSED' : s.phase === 'recording' ? 'REC' : 'IDLE'}</span>
      <span className="mono">{fmtClock(s.elapsedMs)}</span>
      <span className="mono muted">{s.stats.kept} kept</span>
      <div className="row">
        <button className="btn" onClick={() => recorder().toggle()} disabled={s.phase !== 'recording' && !paused}>{paused ? 'Resume' : 'Pause'}</button>
        <button className="btn danger" onClick={() => void recorder().stop()} disabled={s.phase === 'idle'}>Stop</button>
      </div>
    </div>,
    win.document.body,
  );
}

export async function openMini(): Promise<Window | null> {
  const api = window.documentPictureInPicture;
  if (!api) return null;
  const w = await api.requestWindow({ width: 300, height: 150 });
  for (const ss of Array.from(document.styleSheets)) {
    try {
      const st = w.document.createElement('style');
      st.textContent = Array.from(ss.cssRules).map((r) => r.cssText).join('\n');
      w.document.head.appendChild(st);
    } catch { /* cross-origin sheet */ }
  }
  w.document.body.style.margin = '0';
  return w;
}
