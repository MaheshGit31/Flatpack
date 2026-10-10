import { useEffect, useState } from 'react';
import { useFrame, useFrameImage } from './hooks';
import { fmtClock, fmtWhen } from '../util/format';
import type { OcrWord, SearchHit } from '../types';
import { analyzeFrame, getCachedAnalysis, getGeminiConfig, type FrameAnalysis } from '../ai/gemini';
import { href } from './router';

export function Highlights({ words }: { words: OcrWord[] }) {
  return (
    <>
      {words.map((w, i) => (
        <span key={i} className="hl" style={{ left: `${w.x * 100}%`, top: `${w.y * 100}%`, width: `${w.w * 100}%`, height: `${w.h * 100}%` }} />
      ))}
    </>
  );
}

export function Viewer({ ids, index, hits, onIndex, onClose }: { ids: string[]; index: number; hits?: Map<string, SearchHit>; onIndex: (i: number) => void; onClose: () => void }) {
  const id = ids[index] ?? null;
  const { frame, ocr } = useFrame(id);
  const url = useFrameImage(id, 'full');
  const hit = id ? hits?.get(id) : undefined;
  const [ai, setAi] = useState<FrameAnalysis | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  useEffect(() => {
    let alive = true;
    setAi(null); setAiErr(null);
    void getGeminiConfig().then((c) => alive && setAiReady(!!c.key && !!c.consentAt));
    if (id) void getCachedAnalysis(id).then((a) => alive && setAi(a ?? null));
    return () => { alive = false; };
  }, [id]);
  const analyze = async (force = false) => {
    if (!id) return;
    setAiBusy(true); setAiErr(null);
    try { setAi(await analyzeFrame(id, force)); } catch (e) { setAiErr(e instanceof Error ? e.message : String(e)); } finally { setAiBusy(false); }
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key === 'ArrowRight' && index < ids.length - 1) onIndex(index + 1);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [index, ids.length, onIndex, onClose]);
  return (
    <div className="modal-bg" role="presentation" onClick={onClose}>
      <div className="modal viewer" role="dialog" aria-modal="true" aria-label="Frame viewer" onClick={(e) => e.stopPropagation()}>
        <div className="row v-head">
          <b>{frame ? fmtWhen(frame.wall, frame.tMs) : '…'}</b>
          {frame && <span className="badge">{frame.activity}</span>}
          {frame && frame.redactions > 0 && <span className="badge">{frame.redactions} blurred</span>}
          <span className="mono muted">{index + 1} / {ids.length}</span>
          <button className="btn" onClick={onClose} aria-label="Close viewer" style={{ marginLeft: 'auto' }}>Close</button>
        </div>
        <div className="shot">
          {url ? <img src={url} alt={ocr?.text ? `Screen capture. Text: ${ocr.text.slice(0, 160)}` : 'Screen capture'} /> : <div className="ph" />}
          {hit && <Highlights words={hit.matchedWords} />}
        </div>
        {hit && hit.speech.length > 0 && (
          <div className="card speech">{hit.speech.map((s, i) => <div key={i}><span className="mono muted">{fmtClock(s.startMs)}</span> “{s.text}”</div>)}</div>
        )}
        {ai && (
          <div className="gem-box" aria-live="polite">
            <h4>{ai.title}</h4>
            <p style={{ margin: 0 }}>{ai.summary}</p>
            {ai.details.length > 0 && <ul>{ai.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
            <p className="muted mono" style={{ margin: '8px 0 0' }}>Gemini ({ai.model}){ai.tags.length ? ' · ' + ai.tags.join(', ') : ''}</p>
          </div>
        )}
        {aiErr && <div className="notice err" role="alert">{aiErr}</div>}
        <details className="ocrtext"><summary>Text found on this screen (redacted)</summary><pre>{ocr?.text || '(none)'}</pre></details>
        <div className="row">
          <button className="btn" disabled={index <= 0} onClick={() => onIndex(index - 1)} aria-label="Previous frame">← Prev</button>
          <button className="btn" disabled={index >= ids.length - 1} onClick={() => onIndex(index + 1)} aria-label="Next frame">Next →</button>
          <span className="muted">Use ← → and Esc</span>
          {aiReady
            ? <button className="btn" disabled={aiBusy} onClick={() => void analyze(!!ai)} style={{ marginLeft: 'auto' }}>{aiBusy ? 'Asking Gemini…' : ai ? 'Re-analyze with Gemini' : 'Analyze with Gemini'}</button>
            : <a className="btn ghost" href={href('ask')} onClick={onClose} style={{ marginLeft: 'auto' }}>Set up Gemini analysis</a>}
        </div>
      </div>
    </div>
  );
}
