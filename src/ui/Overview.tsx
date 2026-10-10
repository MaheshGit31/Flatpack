import { useEffect, useState } from 'react';
import { dbChannel, frameCount, listFrames, listSessions, storageByDay } from '../store/db';
import { loadDemo } from '../store/demo';
import { fmtBytes, fmtWall } from '../util/format';
import { getGeminiConfig, onGeminiChange } from '../ai/gemini';
import { useFrameImage } from './hooks';
import { useRecorder } from './useRecorder';
import { ModelBar } from './ModelBar';
import { href } from './router';
import type { FrameRec } from '../types';

function Recent({ f }: { f: FrameRec }) {
  const url = useFrameImage(f.id, 'thumb');
  return (
    <a className="frame" href={href('search')} aria-label={`Frame from ${fmtWall(f.wall)}, ${f.activity}`}>
      {url ? <img src={url} alt="" /> : <div className="ph" />}
      <span>{fmtWall(f.wall)} · {f.activity}</span>
    </a>
  );
}

export function Overview() {
  const rec = useRecorder();
  const [n, setN] = useState<number | null>(null);
  const [sessions, setSessions] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [recent, setRecent] = useState<FrameRec[]>([]);
  const [gem, setGem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [c, s, u, all] = await Promise.all([frameCount(), listSessions(), storageByDay(), listFrames()]);
      if (!alive) return;
      setN(c); setSessions(s.length); setBytes(u.reduce((a, d) => a + d.bytes, 0)); setRecent(all.slice(-8).reverse());
    };
    void load();
    const ch = dbChannel();
    if (ch) ch.onmessage = () => void load();
    const refreshGem = () => void getGeminiConfig().then((c) => alive && setGem(!!c.key && !!c.consentAt));
    refreshGem();
    const off = onGeminiChange(refreshGem);
    return () => { alive = false; ch?.close(); off(); };
  }, []);

  const demo = async () => { setBusy(true); try { const r = await loadDemo(); setNote(`Loaded ${r.frames} demo frames.`); } catch (e) { setNote('Demo failed: ' + (e instanceof Error ? e.message : String(e))); } finally { setBusy(false); } };
  const live = rec.phase === 'recording' || rec.phase === 'paused';

  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi"><div className="v">{n ?? '–'}</div><div className="k">frames remembered</div></div>
        <div className="kpi"><div className="v">{sessions}</div><div className="k">sessions</div></div>
        <div className="kpi"><div className="v">{fmtBytes(bytes)}</div><div className="k">used in this browser</div></div>
        <div className="kpi"><div className="v">{gem ? 'On' : 'Off'}</div><div className="k">Gemini analysis (optional)</div></div>
      </div>

      {n === 0 ? (
        <div className="empty">
          <h3>Nothing remembered yet</h3>
          <p>Record a window, or load the demo to see search and the timeline working.</p>
          <div className="row">
            <a className="btn primary" href={href('record')}>Start recording</a>
            <button className="btn" disabled={busy} onClick={() => void demo()}>Load demo data</button>
          </div>
          {note && <p role="status" className="muted" style={{ marginTop: 10 }}>{note}</p>}
        </div>
      ) : (
        <>
          <div className="row">
            <a className="btn primary" href={href('record')}>{live ? 'Recording in progress' : 'Start recording'}</a>
            <a className="btn" href={href('search')}>Search</a>
            <a className="btn" href={href('timeline')}>Timeline</a>
            <a className="btn" href={href('ask')}>Ask AI</a>
          </div>
          <div className="sec" style={{ margin: '14px 0 0' }}><h2>Latest frames</h2></div>
          <div className="frames">{recent.map((f) => <Recent key={f.id} f={f} />)}</div>
        </>
      )}
      <ModelBar />
    </div>
  );
}
