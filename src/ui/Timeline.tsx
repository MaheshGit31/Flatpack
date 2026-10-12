import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { allOcr, allVectors, dbChannel, listFrames } from '../store/db';
import { labelBlocks, segmentBlocks, DEFAULT_BLOCK_OPTS, type Block } from '../timeline/blocks';
import { useFrameImage } from './hooks';
import { Viewer } from './Viewer';
import { dayKey, fmtDuration, fmtWall } from '../util/format';
import { ACTIVITY_LABELS, type ActivityLabel } from '../types';
import { correctBlock, headStatus, resetHead, retrain, type HeadStatus } from '../model/trainer';

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
  const [head, setHead] = useState<HeadStatus | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);
  const refreshHead = useCallback(() => void headStatus().then(setHead).catch(() => undefined), []);
  useEffect(() => { refreshHead(); }, [refreshHead]);

  const train = useCallback(async () => {
    setBusy(true);
    try {
      const r = await retrain();
      setMsg({ ok: true, text: r.trainedOn ? `Trained on ${r.trainedOn} corrected frame${r.trainedOn === 1 ? '' : 's'} in ${(r.ms / 1000).toFixed(1)} s, on this device. ${r.relabelled} frame${r.relabelled === 1 ? '' : 's'} changed label.` : 'No corrections yet, so labels are still pure zero-shot.' });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); refreshHead(); }
  }, [refreshHead]);
  const correct = async (ids: string[], label: ActivityLabel | null) => {
    await correctBlock(ids, label);
    refreshHead();
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void train(), 600); // retrain from the corrections shortly after the last one
  };

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
      <details className="adv-filters" style={{ marginBottom: 16 }}><summary>Label settings</summary>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ marginBottom: 4 }}>Activity labels</h3>
            <p className="muted" style={{ margin: 0 }}>{head && head.trainedOn > 0 ? `A small classifier trained on your ${head.trainedOn} correction${head.trainedOn === 1 ? '' : 's'} helps label your day.` : 'Labels start as good guesses. Fix a block’s label below and Flatpak learns from you, on this device.'}</p>
          </div>
          <div className="row">
            <button className="btn" disabled={busy || !head?.labelled} onClick={() => void train()}>{busy ? 'Training…' : 'Retrain'}</button>
            <button className="btn" disabled={busy || !head?.trainedOn} onClick={() => void resetHead().then((n) => { setMsg({ ok: true, text: `Back to zero-shot labels (${n} changed). Your corrections are kept.` }); refreshHead(); })}>Reset to zero-shot</button>
          </div>
        </div>
        {head && <p className="muted mono" style={{ margin: '8px 0 0' }}>{head.labelled} corrected frame{head.labelled === 1 ? '' : 's'}{head.trainedAt ? ` · trained ${new Date(head.trainedAt).toLocaleTimeString()}` : ' · not trained yet'}</p>}
        {msg && <div className={'notice' + (msg.ok ? '' : ' err')} role={msg.ok ? 'status' : 'alert'} style={{ marginBottom: 0 }}>{msg.text}</div>}
      </div>
      <div className="row filters">
        <label>Split sensitivity <input type="range" min={0.6} max={0.95} step={0.01} value={sim} onChange={(e) => setSim(Number(e.target.value))} /> <span className="mono">{sim.toFixed(2)}</span></label>
        <label>Gap that starts a new block <select value={gapMin} onChange={(e) => setGapMin(Number(e.target.value))}>{[2, 5, 10, 30].map((m) => <option key={m} value={m}>{m} min</option>)}</select></label>
      </div></details>
      {!blocks.length && <div className="notice">No frames yet. Go Home and press Start remembering, or try the example data.</div>}
      {byDay.map(([day, bs]) => (
        <div key={day}>
          <h3 className="day">{day}</h3>
          {bs.map((b) => (
            <article key={b.id} className="block card">
              <div className="row"><b>{b.label}</b><label className="muted">Activity <select aria-label={`Activity of block ${b.label}`} value={b.frames.every((f) => f.userActivity === b.activity) ? b.activity : ''} onChange={(e) => void correct(b.frames.map((f) => f.id), (e.target.value || null) as ActivityLabel | null)}>{!b.frames.every((f) => f.userActivity === b.activity) && <option value="">{b.activity} (model)</option>}{ACTIVITY_LABELS.map((a) => <option key={a} value={a}>{a}{b.frames.every((f) => f.userActivity === a) ? ' (yours)' : ''}</option>)}</select></label><span className="mono muted">{fmtWall(b.startWall)} · {fmtDuration(Math.max(b.endWall - b.startWall, 0))} · {b.frames.length} frame{b.frames.length === 1 ? '' : 's'}</span></div>
              <div className="tl-strip">{b.frames.slice(0, 8).map((f) => <Thumb key={f.id} id={f.id} onClick={() => setView({ ids: b.frames.map((x) => x.id), i: b.frames.findIndex((x) => x.id === f.id) })} />)}</div>
            </article>
          ))}
        </div>
      ))}
      {view && <Viewer ids={view.ids} index={view.i} onIndex={(i) => setView({ ...view, i })} onClose={() => setView(null)} />}
    </section>
  );
}
