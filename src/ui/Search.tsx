import { useEffect, useMemo, useRef, useState } from 'react';
import { searchClient } from '../search/client';
import { ACTIVITY_LABELS, type ActivityLabel, type SearchFilters, type SearchHit, type SearchMode } from '../types';
import { useFrame, useFrameImage } from './hooks';
import { Highlights, Viewer } from './Viewer';
import { fmtWhen } from '../util/format';
import { ModelBar } from './ModelBar';

const RANGES: { id: string; label: string; ms: number }[] = [
  { id: 'all', label: 'Any time', ms: 0 },
  { id: '24h', label: 'Last 24 h', ms: 86_400_000 },
  { id: '7d', label: 'Last 7 days', ms: 7 * 86_400_000 },
];

function Card({ hit, onOpen }: { hit: SearchHit; onOpen: () => void }) {
  const { frame } = useFrame(hit.frameId);
  const url = useFrameImage(hit.frameId, 'thumb');
  const sig = Object.entries(hit.signals) as [string, { rank: number; score: number }][];
  return (
    <button className="frame result" onClick={onOpen} aria-label={`Open result, ${frame ? fmtWhen(frame.wall, frame.tMs) : ''}`}>
      <div className="shot">
        {url ? <img src={url} alt="" /> : <div className="ph" />}
        <Highlights words={hit.matchedWords} />
      </div>
      <span>{frame ? fmtWhen(frame.wall, frame.tMs) : '…'}</span>
      <span className="sigs">
        {frame && <em className="badge">{frame.activity}</em>}
        {sig.map(([k, v]) => <em key={k} className={`badge sig-${k}`} title={`${k} signal: rank ${v.rank}, raw score ${v.score.toFixed(3)}`}>{k} #{v.rank}</em>)}
      </span>
    </button>
  );
}

export function SearchPage() {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<SearchMode>('fused');
  const [range, setRange] = useState('all');
  const [act, setAct] = useState<ActivityLabel | 'any'>('any');
  const [speech, setSpeech] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [stat, setStat] = useState<{ ms: number; embedMs: number } | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const sc = searchClient();
    const off = sc.onSize(setSize);
    void sc.load().then(setSize).catch(() => undefined);
    return off;
  }, []);

  const filters = useMemo<SearchFilters>(() => {
    const f: SearchFilters = {};
    const r = RANGES.find((x) => x.id === range);
    if (r?.ms) f.fromWall = Date.now() - r.ms;
    if (act !== 'any') f.activity = act;
    if (speech) f.hasSpeech = true;
    return f;
  }, [range, act, speech]);

  const run = async () => {
    if (!q.trim()) { setHits([]); return; }
    const my = ++seq.current;
    setBusy(true); setErr(null);
    try {
      const r = await searchClient().search(q, mode, filters);
      if (my !== seq.current) return;
      setHits(r.hits); setStat({ ms: r.ms, embedMs: r.embedMs });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (my === seq.current) setBusy(false);
    }
  };
  useEffect(() => { if (q.trim()) void run(); /* re-run when options change */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, filters]);

  const hitMap = useMemo(() => new Map(hits.map((h) => [h.frameId, h])), [hits]);
  return (
    <section aria-labelledby="s-h">
      <div className="sec"><span className="n">01</span><h2 id="s-h">Search</h2></div>
      <ModelBar />
      <form className="searchbar" role="search" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <label className="sr" htmlFor="q">Search what you saw</label>
        <input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder='try "red line chart", "pricing plans", "that stack trace"' autoFocus />
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
      </form>
      <div className="row filters">
        <div role="group" aria-label="Search signals" className="seg">
          {(['fused', 'clip', 'ocr'] as SearchMode[]).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'fused' ? 'Fused' : m === 'clip' ? 'Visual (CLIP)' : 'Text (OCR)'}</button>
          ))}
        </div>
        <label>When <select value={range} onChange={(e) => setRange(e.target.value)}>{RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
        <label>Activity <select value={act} onChange={(e) => setAct(e.target.value as ActivityLabel | 'any')}><option value="any">Any</option>{ACTIVITY_LABELS.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
        <label className="chk"><input type="checkbox" checked={speech} onChange={(e) => setSpeech(e.target.checked)} /> Has speech</label>
      </div>
      {size === 0 && <div className="notice">Nothing indexed yet. Record a session or load the demo from the Record tab.</div>}
      {err && <div className="notice err" role="alert">{err}</div>}
      {stat && <p className="muted mono" aria-live="polite">{hits.length} result{hits.length === 1 ? '' : 's'} in {stat.ms.toFixed(0)} ms{mode !== 'ocr' ? ` (query embedding ${stat.embedMs.toFixed(0)} ms)` : ''} · searched {size ?? 0} frames on this device</p>}
      <div className="frames results">{hits.map((h, i) => <Card key={h.frameId} hit={h} onOpen={() => setOpen(i)} />)}</div>
      {open !== null && <Viewer ids={hits.map((h) => h.frameId)} index={open} hits={hitMap} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </section>
  );
}
