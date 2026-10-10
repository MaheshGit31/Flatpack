import { useEffect, useRef, useState } from 'react';
import { browserSupport, recorder } from '../capture/recorder';
import { useRecorder } from './useRecorder';
import { ConsentModal } from './Consent';
import { FrameGrid } from './FrameGrid';
import { getSettings, saveSettings } from '../store/db';
import { fmtBytes, fmtClock } from '../util/format';
import { loadDemo } from '../store/demo';
import { importImages } from '../capture/importer';
import { ModelBar } from './ModelBar';

export function Record() {
  const s = useRecorder();
  const [consent, setConsent] = useState<null | 'screen' | 'audio'>(null);
  const [voice, setVoice] = useState(false);
  const [sys, setSys] = useState(false);
  const [mic, setMic] = useState(false);
  useEffect(() => { void getSettings().then((x) => setVoice(x.audioFeature)); }, []);
  const support = browserSupport();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const doDemo = async () => { setBusy(true); setNote('Loading demo sessions…'); try { const r = await loadDemo(); setNote(`Loaded ${r.frames} frames in ${r.sessions} demo sessions. Try the Search tab.`); } catch (e) { setNote('Demo failed: ' + (e instanceof Error ? e.message : String(e))); } finally { setBusy(false); } };
  const doImport = async (files: FileList | null) => { if (!files?.length) return; setBusy(true); try { const r = await importImages([...files].map((f) => ({ name: f.name, blob: f })), { gapMs: 60_000, onProgress: (d, t) => setNote(`Indexing ${d}/${t}…`) }); setNote(`Indexed ${r.stored} image(s)${r.skipped ? `, dropped ${r.skipped} (block-list)` : ''}.`); } catch (e) { setNote('Import failed: ' + (e instanceof Error ? e.message : String(e))); } finally { setBusy(false); } };
  const active = s.phase === 'recording' || s.phase === 'paused';

  const begin = async () => {
    const st = await getSettings();
    if (!st.consentAcceptedAt) await saveSettings({ consentAcceptedAt: Date.now() });
    setConsent(null);
    await recorder().start({ systemAudio: voice && sys, mic: voice && mic });
  };
  const want = async () => {
    const st = await getSettings();
    if (voice && (sys || mic) && !st.audioConsentAcceptedAt) return setConsent('audio');
    return st.consentAcceptedAt ? void begin() : setConsent('screen');
  };
  const audioOk = async () => {
    await saveSettings({ audioConsentAcceptedAt: Date.now() });
    const st = await getSettings();
    if (st.consentAcceptedAt) void begin(); else setConsent('screen');
  };

  if (!support.ok)
    return (
      <div className="notice err" role="alert">
        <b>This browser can't run Flatpak.</b>
        <ul>{support.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        Use desktop Chrome or Edge. You can still browse the demo data.
        <div className="row" style={{ marginTop: 10 }}><button className="btn" onClick={() => void doDemo()}>Load demo data</button></div>
        {note && <p>{note}</p>}
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
        {s.audioTracks > 0 && <span className="badge">listening · {st.transcribed} line{st.transcribed === 1 ? '' : 's'}{st.audioPending ? ` · ${st.audioPending} queued` : ''}</span>}
      </div>
      {!active && (
        <fieldset className="voice">
          <legend>Voice memory <span className="badge">experimental</span></legend>
          <label className="chk"><input type="checkbox" checked={voice} onChange={(e) => { setVoice(e.target.checked); void saveSettings({ audioFeature: e.target.checked }); }} /> Transcribe speech locally (adds a ~44 MB speech model)</label>
          {voice && <div className="row"><label className="chk"><input type="checkbox" checked={sys} onChange={(e) => setSys(e.target.checked)} /> Shared tab / system audio</label><label className="chk"><input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} /> Microphone</label></div>}
        </fieldset>
      )}
      <ModelBar />
      <div className="row" style={{ margin: '12px 0 16px' }}>
        <button className="btn" disabled={busy} onClick={() => void doDemo()}>Load demo data</button>
        <button className="btn" disabled={busy} onClick={() => file.current?.click()}>Index screenshots…</button>
        <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => { void doImport(e.target.files); e.target.value = ''; }} />
        {note && <span role="status" className="muted">{note}</span>}
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
      {consent && <ConsentModal audio={consent === 'audio'} onAccept={() => void (consent === 'audio' ? audioOk() : begin())} onCancel={() => setConsent(null)} />}
    </section>
  );
}
