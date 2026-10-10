import { useEffect, useState } from 'react';
import { runBenchmark, saveBenchmark, type BenchResult } from '../eval/bench';
import { getKv } from '../store/db';
import { ModelBar } from './ModelBar';

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

function Chart({ r }: { r: BenchResult }) {
  const rows = [['Visual (CLIP)', r.modes.clip], ['Text (OCR)', r.modes.ocr], ['Fused (RRF)', r.modes.fused]] as const;
  return (
    <svg viewBox="0 0 560 190" role="img" aria-label={`Recall at 5: CLIP ${pct(r.modes.clip.recall5)}, OCR ${pct(r.modes.ocr.recall5)}, fused ${pct(r.modes.fused.recall5)}`} className="chart">
      {rows.map(([name, m], i) => (
        <g key={name} transform={`translate(0 ${i * 60 + 10})`}>
          <text x="0" y="22" className="cl">{name}</text>
          <rect x="130" y="4" width={Math.max(2, m.recall5 * 400)} height="20" className="b5" />
          <text x={136 + m.recall5 * 400} y="19" className="cv">R@5 {pct(m.recall5)}</text>
          <rect x="130" y="28" width={Math.max(2, m.recall1 * 400)} height="14" className="b1" />
          <text x={136 + m.recall1 * 400} y="40" className="cv">R@1 {pct(m.recall1)}</text>
        </g>
      ))}
    </svg>
  );
}

export function BenchmarkPage() {
  const [r, setR] = useState<BenchResult | null>(null);
  const [run, setRun] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void getKv<BenchResult>('bench-last').then((x) => x && setR(x)); }, []);
  const go = async () => {
    setErr(null); setRun({ done: 0, total: 1 });
    try {
      const res = await runBenchmark(undefined, (done, total) => setRun({ done, total }));
      if (!res.frames) throw new Error('No labelled frames found. Load the demo data from the Record page first.');
      await saveBenchmark(res); setR(res);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setRun(null); }
  };
  const download = () => {
    if (!r) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
    a.download = `flatpak-benchmark-${new Date(r.at).toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <section aria-labelledby="b-h">
      <ModelBar />
      <div className="row"><button className="btn primary" onClick={() => void go()} disabled={!!run}>{run ? `Running ${run.done}/${run.total}…` : 'Run benchmark'}</button>{r && <button className="btn" onClick={download}>Export JSON</button>}</div>
      {err && <div className="notice err" role="alert">{err}</div>}
      {r && (
        <>
          <p className="muted mono">{r.queries} queries · {r.frames} frames · {new Date(r.at).toLocaleString()}</p>
          <Chart r={r} />
          <table className="sess"><thead><tr><th>Signal</th><th>Recall@1</th><th>Recall@5</th><th>MRR</th><th>Median search</th></tr></thead>
            <tbody>{(['clip', 'ocr', 'fused'] as const).map((m) => <tr key={m}><td>{m === 'clip' ? 'CLIP only' : m === 'ocr' ? 'OCR only' : 'Fused (RRF k=60)'}</td><td className="mono">{pct(r.modes[m].recall1)}</td><td className="mono">{pct(r.modes[m].recall5)}</td><td className="mono">{r.modes[m].mrr.toFixed(3)}</td><td className="mono">{r.modes[m].medianSearchMs.toFixed(0)} ms</td></tr>)}</tbody></table>
          <h3>By query type (Recall@5)</h3>
          <table className="sess"><thead><tr><th>Kind</th><th>n</th><th>CLIP</th><th>OCR</th><th>Fused</th></tr></thead>
            <tbody>{Object.entries(r.byKind).map(([k, v]) => <tr key={k}><td>{k}</td><td className="mono">{v.fused.n}</td><td className="mono">{pct(v.clip.recall5)}</td><td className="mono">{pct(v.ocr.recall5)}</td><td className="mono">{pct(v.fused.recall5)}</td></tr>)}</tbody></table>
          <h3>Pipeline</h3>
          <div className="grid3">
            <div className="stat"><div className="v">{(r.pipeline.medianIndexMs / 1000).toFixed(2)}s</div><div className="k">median time to index a frame</div></div>
            <div className="stat"><div className="v">{r.pipeline.modelLoadMs ? (r.pipeline.modelLoadMs / 1000).toFixed(1) + 's' : 'n/a'}</div><div className="k">model load{r.pipeline.backend ? ` (${r.pipeline.backend})` : ''}</div></div>
            <div className="stat"><div className="v">{r.pipeline.mbPerHourKept.toFixed(0)} MB</div><div className="k">per hour if every 3 s frame were kept</div></div>
            <div className="stat"><div className="v">{r.pipeline.keptVsCaptured}</div><div className="k">kept / captured (live sessions)</div></div>
            <div className="stat"><div className="v">{r.activityAccuracy === null ? 'n/a' : pct(r.activityAccuracy)}</div><div className="k">zero-shot activity label accuracy</div></div>
            <div className="stat"><div className="v">{r.networkRequestsAfterLoad ?? 'n/a'}</div><div className="k">network requests after load</div></div>
          </div>
          <details><summary>Per-query ranks</summary>
            <table className="sess"><thead><tr><th>Query</th><th>Kind</th><th>CLIP</th><th>OCR</th><th>Fused</th></tr></thead><tbody>{r.perQuery.map((p) => <tr key={p.q}><td>{p.q}</td><td>{p.kind}</td><td className="mono">{p.ranks.clip ?? '–'}</td><td className="mono">{p.ranks.ocr ?? '–'}</td><td className="mono">{p.ranks.fused ?? '–'}</td></tr>)}</tbody></table>
          </details>
        </>
      )}
    </section>
  );
}
