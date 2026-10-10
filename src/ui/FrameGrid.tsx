import { useEffect, useRef, useState } from 'react';
import { dbChannel, getBlobs, listFrames } from '../store/db';
import type { FrameRec } from '../types';
import { fmtClock } from '../util/format';

function Thumb({ f, onOpen }: { f: FrameRec; onOpen?: (f: FrameRec) => void }) {
  const [url, setUrl] = useState<string>('');
  useEffect(() => {
    let u = '';
    let alive = true;
    void getBlobs(f.id).then((b) => {
      if (alive && b) setUrl((u = URL.createObjectURL(b.thumb)));
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [f.id]);
  return (
    <button className="frame" onClick={() => onOpen?.(f)} aria-label={`Frame at ${fmtClock(f.tMs)}, ${f.activity}`}>
      {url ? <img src={url} alt="" /> : <img alt="" />}
      <span>{fmtClock(f.tMs)} · {f.activity}{f.redactions ? ` · ${f.redactions} blurred` : ''}</span>
    </button>
  );
}

export function FrameGrid({ sessionId, limit = 48, onOpen }: { sessionId?: string; limit?: number; onOpen?: (f: FrameRec) => void }) {
  const [frames, setFrames] = useState<FrameRec[]>([]);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    const load = () => void listFrames(sessionId).then((all) => setFrames(all.slice(-limit).reverse()));
    load();
    const ch = dbChannel();
    if (ch)
      ch.onmessage = () => {
        if (timer.current === null) timer.current = window.setTimeout(() => { timer.current = null; load(); }, 600);
      };
    return () => {
      ch?.close();
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [sessionId, limit]);
  if (!frames.length) return <p className="muted">No frames yet.</p>;
  return (
    <div className="frames">
      {frames.map((f) => <Thumb key={f.id} f={f} onOpen={onOpen} />)}
    </div>
  );
}
