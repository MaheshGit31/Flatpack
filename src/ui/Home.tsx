import { useEffect, useState } from 'react';
import { browserSupport, recorder } from '../capture/recorder';
import { dbChannel, frameCount, getSettings, saveSettings } from '../store/db';
import { loadDemo } from '../store/demo';
import { ConsentModal } from './Consent';
import { useRecorder } from './useRecorder';
import { useNetwork } from '../offline/sw';
import { href } from './router';

export const PENDING_Q = 'flatpak-q';

export function Home() {
  const s = useRecorder();
  const net = useNetwork();
  const [n, setN] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const support = browserSupport();
  const active = s.phase === 'recording' || s.phase === 'paused';

  useEffect(() => {
    let alive = true;
    const load = () => void frameCount().then((c) => alive && setN(c));
    load();
    const ch = dbChannel();
    if (ch) ch.onmessage = load;
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); ch?.close(); };
  }, []);

  const begin = async () => {
    const st = await getSettings();
    if (!st.consentAcceptedAt) await saveSettings({ consentAcceptedAt: Date.now() });
    setConsent(false);
    await recorder().start({ systemAudio: false, mic: false });
  };
  const start = async () => { const st = await getSettings(); if (st.consentAcceptedAt) void begin(); else setConsent(true); };
  const demo = async () => { setBusy(true); setNote('Loading examples…'); try { const r = await loadDemo(); setNote(`Added ${r.frames} example moments. Try searching "pricing table".`); } catch (e) { setNote('Could not load examples: ' + (e instanceof Error ? e.message : String(e))); } finally { setBusy(false); } };
  const search = (e: React.FormEvent) => { e.preventDefault(); if (!q.trim()) return; try { sessionStorage.setItem(PENDING_Q, q.trim()); } catch { /* ignore */ } location.hash = href('search'); };
  const empty = n === 0 && !active;

  return (
    <div className="home">
      <div className="home-actions">
        {!active
          ? <button className="btn-xl yellow" disabled={s.phase !== 'idle' || !support.ok} onClick={() => void start()}>Start remembering</button>
          : <button className="btn-xl" onClick={() => recorder().toggle()}>{s.phase === 'paused' ? 'Resume' : 'Pause'}</button>}
        <form className="home-search" role="search" onSubmit={search}>
          <label className="sr" htmlFor="home-q">Search your memory</label>
          <input id="home-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your memory… (try: pricing table)" />
          <button className="btn-xl" type="submit" aria-label="Search">Search</button>
        </form>
      </div>
      {s.error && <div className="notice err" role="alert">{s.error}</div>}
      {!support.ok && <div className="notice err" role="alert">This browser can't record your screen. Use desktop Chrome or Edge. You can still try the examples.</div>}
      {active && (
        <div className="home-status" role="status">
          <span className={'rec-dot' + (s.phase === 'paused' ? ' paused' : '')} aria-hidden />
          {s.phase === 'paused' ? 'Paused' : 'Remembering…'} {n ?? 0} moments saved
          <button className="link" onClick={() => void recorder().stop()}>Stop</button>
        </div>
      )}
      {!active && n !== null && n > 0 && <p className="home-status">{n} moments saved on this device. <a href={href('search')}>Search</a> · <a href={href('timeline')}>Your day</a></p>}
      {empty && (
        <ol className="steps3">
          <li><span className="ico" aria-hidden>▶</span><b>1. Click Start</b><span>and pick your screen.</span></li>
          <li><span className="ico" aria-hidden>💻</span><b>2. Keep working</b><span>as normal.</span></li>
          <li><span className="ico" aria-hidden>🔎</span><b>3. Search anything</b><span>you saw.</span></li>
        </ol>
      )}
      {empty && <div className="home-actions"><button className="btn-xl" disabled={busy} onClick={() => void demo()}>Try with example data</button></div>}
      {note && <p role="status" className="home-status">{note}</p>}
      <p className="home-private"><span className={'status-dot' + (net.online ? ' on' : ' off')} aria-hidden />Nothing leaves your device. Works offline. <span className="pill">{net.online ? 'Online' : 'Offline, still working'}</span></p>
      {consent && <ConsentModal audio={false} onAccept={() => void begin()} onCancel={() => setConsent(false)} />}
    </div>
  );
}
