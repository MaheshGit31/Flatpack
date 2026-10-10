import { useModels } from './hooks';
import { fmtBytes } from '../util/format';

export function ModelBar() {
  const m = useModels();
  if (m.state === 'idle') return <div className="modelbar muted" role="status">Models load on first use (about 155 MB, then cached in this browser).</div>;
  if (m.state === 'loading')
    return (
      <div className="modelbar" role="status" aria-live="polite">
        <div className="mb-top"><b>Loading models</b><span className="mono">{m.pct.toFixed(0)}%{m.total ? ` · ${fmtBytes(m.loaded)} / ${fmtBytes(m.total)}` : ''}</span></div>
        <div className="bar" role="progressbar" aria-valuenow={Math.round(m.pct)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${m.pct}%` }} /></div>
        <div className="muted mono mb-file">{m.file}</div>
      </div>
    );
  if (m.state === 'error') return <div className="notice err" role="alert">Models failed to load: {m.message}</div>;
  return <div className="modelbar ok" role="status">Models ready · {m.backend === 'webgpu' ? 'WebGPU' : 'WASM'} · loaded in {m.loadMs ? (m.loadMs / 1000).toFixed(1) : '?'}s{m.message ? ` · ${m.message}` : ''}</div>;
}
