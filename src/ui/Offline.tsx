import { useCallback, useEffect, useState } from 'react';
import { prepareOffline, readiness, setAirplane, useNetwork, type Readiness } from '../offline/sw';
import { indexClient } from '../workers/client';
import { searchClient } from '../search/client';
import { loadDemo } from '../store/demo';
import { ModelBar } from './ModelBar';

type Check = { ok: boolean; label: string; detail: string };

export function OfflinePage() {
  const net = useNetwork();
  const [r, setR] = useState<Readiness | null>(null);
  const [prep, setPrep] = useState<{ done: number; total: number } | null>(null);
  const [test, setTest] = useState<{ ms: number; hits: number; top: string; offline: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => void readiness().then(setR), []);
  useEffect(refresh, [refresh]);

  const prepare = async () => {
    setErr(null); setBusy(true);
    try {
      await prepareOffline((done, total) => setPrep({ done, total }));
      await indexClient().start(); // loads CLIP + OCR once; transformers.js stores the weights in Cache Storage
      refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); setPrep(null); }
  };
  const selfTest = async () => {
    setErr(null); setBusy(true);
    try {
      const t0 = performance.now();
      const res = await searchClient().search('code editor with a function', 'fused', {}, 5);
      setTest({ ms: performance.now() - t0, hits: res.hits.length, top: res.hits[0]?.frameId ?? '–', offline: !navigator.onLine || net.simulated });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const demo = async () => { setBusy(true); try { await loadDemo(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };

  const checks: Check[] = r ? [
    { ok: r.worker, label: 'Service worker controls this page', detail: r.worker ? 'active' : 'not yet. Reload once after the first visit (production build only).' },
    { ok: r.shell, label: 'App shell cached', detail: `${r.shellCount} files in Cache Storage` },
    { ok: r.models, label: 'Models cached (CLIP + OCR)', detail: r.models ? `${r.modelFiles} model files` : 'not yet. Press "Prepare for offline".' },
  ] : [];
  const ready = checks.length > 0 && checks.every((c) => c.ok);

  return (
    <section aria-labelledby="off-h">
      <ModelBar />
      <div className={'notice ' + (net.online ? '' : 'ok')} role="status" style={{ marginBottom: 16 }}>
        <b>Network: {net.online ? 'online' : net.simulated ? 'offline (airplane mode simulated)' : 'offline'}</b>
        {!net.online && <> · still working. Every search and every classification below runs on this device.</>}
      </div>
      <h2 id="off-h">Airplane mode demo</h2>
      <ol className="steps">
        <li>Press <b>Prepare for offline</b> once, while you have a connection. It caches the app, the OCR files and the CLIP model.</li>
        <li>Load the demo screens (or record your own).</li>
        <li>Turn on <b>Airplane mode</b>, or switch off your wifi. Reload the page if you like.</li>
        <li>Press <b>Search offline</b>. It embeds your words with CLIP and ranks frames, with no network.</li>
      </ol>
      <div className="row">
        <button className="btn primary" onClick={() => void prepare()} disabled={busy || !net.online}>{prep ? `Caching ${prep.done}/${prep.total}…` : 'Prepare for offline'}</button>
        <button className="btn" onClick={() => void demo()} disabled={busy}>Load demo screens</button>
        <button className="btn" onClick={() => void setAirplane(!net.simulated)} aria-pressed={net.simulated}>{net.simulated ? 'Turn off airplane mode' : 'Airplane mode (simulate)'}</button>
        <button className="btn" onClick={() => void selfTest()} disabled={busy}>Search offline</button>
      </div>
      {err && <div className="notice err" role="alert">{err}</div>}
      <h3>Readiness</h3>
      <ul className="checks">{checks.map((c) => <li key={c.label}><span className={'status-dot' + (c.ok ? ' on' : '')} aria-hidden /> <b>{c.label}</b> <span className="muted">{c.detail}</span></li>)}</ul>
      <p className="muted">{ready ? 'Ready: this app will open and work with the network off.' : 'Not ready yet.'}</p>
      {test && <p className="mono" role="status">Search finished in {test.ms.toFixed(0)} ms · {test.hits} hits · top frame {test.top} · {test.offline ? 'network was off' : 'network was on'}</p>}
      <p className="muted">Simulated airplane mode makes the service worker refuse every request from this app, so you can prove it on a machine that is still online. Real airplane mode needs nothing special. Not cached by design: the optional Gemini analysis, which needs the internet and is off by default.</p>
    </section>
  );
}
