import { useEffect, useMemo, useState } from 'react';
import { allOcr, allVectors, dbChannel, listFrames } from '../store/db';
import { labelBlocks, segmentBlocks, DEFAULT_BLOCK_OPTS, type Block } from '../timeline/blocks';
import { useFrameImage } from './hooks';
import { Viewer } from './Viewer';
import { dayKey, fmtDuration, fmtWall } from '../util/format';

function Thumb({ id, onClick }: { id: string; onClick: () => void }) {
  const url = useFrameImage(id, 'thumb');
  return <button className="tl-thumb" onClick={onClick} aria-label="Open frame">{url ? <img src={url} alt="" /> : <span className="ph" />}</button>;
}

export function TimelinePage() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [sim, setSim] = useState(DEFAULT_BLOCK_OPTS.simThreshold);
  const [gapMin, setGapMin] = useState(DEFAULT_BLOCK_OPTS.gapMs / 60_000);
  const [raw, setRaw] = useState<{ frames: Awaited<ReturnType<typeof listFrames>>; vecs: Map<string, Float32Array>; text: Map<string, string> } | null>(null);
  const [view, setView] = useState<{ ids: string[]; i: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [frames, vecs, ocr] = await Promise.all([listFrames(), allVectors(), allOcr()]);
      if (alive) setRaw({ frames, vecs: new Map(vecs.map((v) => [v.frameId, v.vec])), text: new Map(ocr.map((o) => [o.frameId, o.text])) });
    };
    void load();
    const ch = dbChannel();
    if (ch) ch.onmessage = () => void load();
    return () => { alive = false; ch?.close(); };
  }, []);
  useEffect(() => {
    if (!raw) return;
    setBlocks(labelBlocks(segmentBlocks(raw.frames, raw.vecs, { ...DEFAULT_BLOCK_OPTS, simThreshold: sim, gapMs: gapMin * 60_000 }), (id) => raw.text.get(id) ?? '').reverse());
  }, [raw, sim, gapMin]);

  const byDay = useMemo(() => {
    const m = new Map<string, Block[]>();
    for (const b of blocks) m.set(dayKey(b.startWall), [...(m.get(dayKey(b.startWall)) ?? []), b]);
    return [...m.entries()];
  }, [blocks]);

  return (
    <section aria-labelledby="t-h">
      <div className="sec"><span className="n">01</span><h2 id="t-h">Timeline</h2></div>
      <p className="lead">Your screen time, split into blocks by time gaps and by how far the screen's CLIP embedding drifts. Each block is labelled with its dominant activity and its most distinctive on-screen words.</p>
      <div className="row filters">
        <label>Split sensitivity <input type="range" min={0.6} max={0.95} step={0.01} value={sim} onChange={(e) => setSim(Number(e.target.value))} /> <span className="mono">{sim.toFixed(2)}</span></label>
        <label>Gap that starts a new block <select value={gapMin} onChange={(e) => setGapMin(Number(e.target.value))}>{[2, 5, 10, 30].map((m) => <option key={m} value={m}>{m} min</option>)}</select></label>
      </div>
      {!blocks.length && <div className="notice">No frames yet. Record a session or load the demo from the Record tab.</div>}
      {byDay.map(([day, bs]) => (
        <div key={day}>
          <h3 className="day">{day}</h3>
          {bs.map((b) => (
            <article key={b.id} className="block card">
              <div className="row"><b>{b.label}</b><span className="badge">{b.activity}</span><span className="mono muted">{fmtWall(b.startWall)} · {fmtDuration(Math.max(b.endWall - b.startWall, 0))} · {b.frames.length} frame{b.frames.length === 1 ? '' : 's'}</span></div>
              <div className="tl-strip">{b.frames.slice(0, 8).map((f) => <Thumb key={f.id} id={f.id} onClick={() => setView({ ids: b.frames.map((x) => x.id), i: b.frames.findIndex((x) => x.id === f.id) })} />)}</div>
            </article>
          ))}
        </div>
      ))}
      {view && <Viewer ids={view.ids} index={view.i} onIndex={(i) => setView({ ...view, i })} onClose={() => setView(null)} />}
    </section>
  );
}
