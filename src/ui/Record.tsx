import { useState } from 'react';
import { browserSupport, recorder } from '../capture/recorder';
import { useRecorder } from './useRecorder';
import { ConsentModal } from './Consent';
import { FrameGrid } from './FrameGrid';
import { getSettings, saveSettings } from '../store/db';
import { fmtBytes, fmtClock } from '../util/format';

export function Record() {
  const s = useRecorder();
  const [consent, setConsent] = useState(false);
  const support = browserSupport();
  const active = s.phase === 'recording' || s.phase === 'paused';

  const begin = async () => {
    const st = await getSettings();
    if (!st.consentAcceptedAt) await saveSettings({ consentAcceptedAt: Date.now() });
    setConsent(false);
    await recorder().start();
  };
  const want = async () => ((await getSettings()).consentAcceptedAt ? void begin() : setConsent(true));

  if (!support.ok)
    return (
      <div className="notice err" role="alert">
        <b>This browser can't run Flatpak.</b>
        <ul>{support.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        Use desktop Chrome or Edge. You can still browse the demo data.
      </div>
    );

  const st = s.stats;
  return (
    <section aria-labelledby="rec-h">
      <div className="sec"><span className="n">01</span><h2 id="rec-h">Record</h2></div>
      <p className="lead">Pick a screen or window. Flatpak keeps what changed, blurs what's sensitive, and forgets the rest.</p>
      {s.error && <div className="notice err" role="alert">{s.error}</div>}
      <div className="row" style={{ marginBottom: 16 }}>
        {!active && <button className="btn primary" disabled={s.phase !== 'idle'} onClick={() => void want()}>Start recording</button>}
        {active && <button className="btn" onClick={() => recorder().toggle()}>{s.phase === 'paused' ? 'Resume' : 'Pause'}</button>}
        {active && <button className="btn danger" onClick={() => void recorder().stop()}>Stop</button>}
        {active && <span className="mono">{fmtClock(s.elapsedMs)}</span>}
        {st.captureOnly && active && <span className="badge">capture-only: indexer behind</span>}
        {s.audioTracks > 0 && <span className="badge">audio shared</span>}
      </div>
      <div className="grid3">
        <div className="stat"><div className="v">{st.captured}</div><div className="k">captured</div></div>
        <div className="stat"><div className="v">{st.kept}</div><div className="k">kept</div></div>
        <div className="stat"><div className="v">{st.skippedDup}</div><div className="k">skipped (unchanged)</div></div>
        <div className="stat"><div className="v">{st.queue}</div><div className="k">indexing queue</div></div>
        <div className="stat"><div className="v">{fmtBytes(st.bytes)}</div><div className="k">stored this session</div></div>
        <div className="stat"><div className="v">{st.dropped}</div><div className="k">dropped</div></div>
      </div>
      <div className="sec"><span className="n">02</span><h2>Latest frames</h2></div>
      <FrameGrid sessionId={s.session?.id} />
      {consent && <ConsentModal onAccept={() => void begin()} onCancel={() => setConsent(false)} />}
    </section>
  );
}
