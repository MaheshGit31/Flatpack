import { useEffect, useState } from 'react';
import { evaluateSamples, evaluateUserFrames, headStatus, labelDemoFromGroundTruth, loadPack, NoLabelsError } from '../model/trainer';
import { getKv, setKv } from '../store/db';
import type { EvalResult } from '../model/head';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const band = (r: { mean: number; min: number; max: number }) => `${pct(r.mean)} (${(r.min * 100).toFixed(0)}–${(r.max * 100).toFixed(0)})`;

interface Saved { at: number; source: 'user' | 'pack'; results: EvalResult[] }

function Curve({ r }: { r: EvalResult }) {
  const w = 520, row = 26;
  return (
    <svg viewBox={`0 0 ${w} ${(r.curve.length + 1) * row}`} className="chart" role="img" aria-label={`Held-out accuracy by number of corrected frames: ${r.curve.map((c) => `${c.k} frames ${pct(c.mean)}`).join(', ')}; zero-shot ${pct(r.zeroShot.mean)}`}>
      {r.curve.map((c, i) => (
        <g key={c.k} transform={`translate(0 ${i * row})`}>
          <text x="0" y="17" className="cl">{c.k === 0 ? 'zero-shot' : `${c.k} corrected`}</text>
          <rect x="110" y="4" width={Math.max(2, c.mean * 330)} height="16" className={c.mean >= r.zeroShot.mean ? 'b5' : 'b1'} />
          <text x={116 + c.mean * 330} y="17" className="cv">{pct(c.mean)}</text>
        </g>
      ))}
    </svg>
  );
}

export function HeadBench() {
  const [labelled, setLabelled] = useState(0);
  const [source, setSource] = useState<'user' | 'pack'>('pack');
  const [res, setRes] = useState<Saved | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const refresh = () => void headStatus().then((s) => setLabelled(s.labelled)).catch(() => undefined);
  useEffect(() => { refresh(); void getKv<Saved>('head-bench-last').then((x) => x && setRes(x)); }, []);

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const results: EvalResult[] = [];
      if (source === 'user') {
        const r = await evaluateUserFrames({ repeats: 12 });
        if (!r) throw new Error('Need at least 6 corrected frames. Fix some block labels on the Timeline first.');
        results.push(r);
      } else {
        const pack = await loadPack();
        const a = await evaluateSamples(pack, { repeats: 8 });
        const b = await evaluateSamples(pack, { repeats: 8, groupHoldout: true });
        if (a) results.push(a);
        if (b) results.push(b);
      }
      const saved: Saved = { at: Date.now(), source, results };
      await setKv('head-bench-last', saved);
      setRes(saved);
    } catch (e) {
      setErr(e instanceof NoLabelsError ? e.message : e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  const rec = res?.results.find((r) => r.mode === 'recurring');
  const fresh = res?.results.find((r) => r.mode === 'new-apps');
  const diff = (r: EvalResult) => (r.trained.mean - r.zeroShot.mean) * 100;

  return (
    <section className="panel" aria-labelledby="hb-h" style={{ marginTop: 24 }}>
      <h3 id="hb-h">Activity labels: zero-shot vs trained head</h3>
      <p className="muted">The trained head is a softmax regression on CLIP image embeddings that starts as the zero-shot classifier and learns from your Timeline corrections. This repeats a random holdout: it trains on part of the labelled frames and scores on the rest, which it never saw. Whatever comes out is what is shown.</p>
      <fieldset className="voice" style={{ marginTop: 12 }}>
        <legend>Labelled frames to evaluate on</legend>
        <div className="row" style={{ gap: 20 }}>
          <label className="chk"><input type="radio" name="hb-src" checked={source === 'user'} onChange={() => setSource('user')} /> My corrected frames ({labelled}{labelled < 6 ? ', need 6+' : ''})</label>
          <label className="chk"><input type="radio" name="hb-src" checked={source === 'pack'} onChange={() => setSource('pack')} /> Shipped test pack: 70 frames, 14 synthetic apps x 5 looks (not stored)</label>
        </div>
      </fieldset>
      <div className="row">
        <button className="btn primary" disabled={busy || (source === 'user' && labelled < 6)} onClick={() => void run()}>{busy ? 'Evaluating… (about 20 s)' : 'Run holdout evaluation'}</button>
        <button className="btn" onClick={() => void labelDemoFromGroundTruth().then((n) => { setNote(`Labelled ${n} demo frames with the ground truth that ships with the demo, standing in for your corrections.`); refresh(); })}>Label demo frames from ground truth</button>
      </div>
      {note && <p className="muted" role="status">{note}</p>}
      {err && <div className="notice err" role="alert">{err}</div>}
      {res && (
        <div style={{ marginTop: 16 }}>
          <p className="muted mono">{res.source === 'pack' ? 'shipped pack' : 'your frames'} · {res.results[0]?.labelled} labelled frames · {res.results[0]?.classes} classes · {res.results[0]?.repeats} random splits, {(res.results[0]?.holdoutFraction ?? 0) * 100}% held out</p>
          <table className="sess">
            <thead><tr><th>Split</th><th>Zero-shot</th><th>Trained head</th><th>Difference</th></tr></thead>
            <tbody>
              {res.results.map((r) => (
                <tr key={r.mode}>
                  <td>{r.mode === 'recurring' ? 'Same apps return (random split)' : 'Whole apps held out (never seen)'}</td>
                  <td className="mono">{band(r.zeroShot)}</td>
                  <td className="mono">{band(r.trained)}</td>
                  <td className="mono">{diff(r) >= 0 ? '+' : ''}{diff(r).toFixed(1)} pts</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Mean held-out accuracy, with the worst and best split in brackets. {rec ? `When the same apps return, the trained head is ${Math.abs(diff(rec)).toFixed(1)} points ${diff(rec) >= 0 ? 'better' : 'worse'} than zero-shot.` : ''} {fresh ? `On apps it never saw it is ${Math.abs(diff(fresh)).toFixed(1)} points ${diff(fresh) >= 0 ? 'better' : 'worse'}.` : ''}</p>
          {rec && <><h4 style={{ margin: '14px 0 6px' }}>Accuracy as you correct more frames</h4><Curve r={rec} /></>}
          <details><summary>How to read this</summary>
            <p className="muted">A trained head only helps on things it has been taught: it learns your labels for the apps you actually use. For apps it never saw, retraining can hurt, because the head has only learned from the classes you corrected. Classes you never corrected keep their zero-shot weights, and uncorrected frames act as zero-shot anchors, but that does not remove the effect. The shipped pack is small and synthetic, and the head&apos;s settings were chosen while looking at it, so its gain is optimistic. The honest test is your own corrected frames.</p>
          </details>
        </div>
      )}
    </section>
  );
}
