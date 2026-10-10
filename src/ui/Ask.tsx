import { useEffect, useState } from 'react';
import { searchClient } from '../search/client';
import { listFrames } from '../store/db';
import { fmtBytes } from '../util/format';
import {
  askAboutFrames, DEFAULT_MODEL, getGeminiConfig, getGeminiUsage, GeminiError, maskKey, MODEL_CHOICES, onGeminiChange,
  removeGeminiKey, saveGeminiConfig, testKey, type GeminiConfig, type GeminiUsage,
} from '../ai/gemini';
import { useFrameImage } from './hooks';

function Thumb({ id }: { id: string }) {
  const url = useFrameImage(id, 'thumb');
  return url ? <img src={url} alt="" /> : <div className="ph" />;
}

const SCOPES = [
  { id: 'all', label: 'Any time', ms: 0 },
  { id: '24h', label: 'Last 24 hours', ms: 86_400_000 },
  { id: '7d', label: 'Last 7 days', ms: 7 * 86_400_000 },
];

export function AskPage() {
  const [cfg, setCfg] = useState<GeminiConfig | null>(null);
  const [usage, setUsage] = useState<GeminiUsage | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [agree, setAgree] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [q, setQ] = useState('');
  const [scope, setScope] = useState('all');
  const [count, setCount] = useState(4);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [answer, setAnswer] = useState<{ text: string; ids: string[] } | null>(null);
  const [aerr, setAerr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [c, u] = await Promise.all([getGeminiConfig(), getGeminiUsage()]);
      if (!alive) return;
      setCfg(c); setUsage(u); setModel(c.model); setAgree(!!c.consentAt);
    };
    void load();
    const off = onGeminiChange(() => void load());
    return () => { alive = false; off(); };
  }, []);
  if (!cfg) return null;
  const ready = !!cfg.key && !!cfg.consentAt;

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const key = keyDraft.trim() || cfg.key;
      if (!key) throw new GeminiError('Paste a Gemini API key first.');
      if (!agree) throw new GeminiError('Tick the box to confirm you understand what gets sent.');
      await saveGeminiConfig({ key, model: model.trim() || DEFAULT_MODEL, consentAt: cfg.consentAt ?? Date.now() });
      setKeyDraft('');
      setMsg({ ok: true, text: 'Saved in this browser. Nothing has been sent yet.' });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setMsg(null);
    try { await testKey(); setMsg({ ok: true, text: 'The key works. That test sent one short text message and no screen data.' }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); } finally { setBusy(false); }
  };

  const find = async () => {
    setAerr(null); setAnswer(null); setPicked(null);
    if (!q.trim()) return setAerr('Type a question first.');
    setAsking(true);
    try {
      const r = SCOPES.find((s) => s.id === scope);
      const filters = r?.ms ? { fromWall: Date.now() - r.ms } : {};
      let ids: string[] = [];
      try { ids = (await searchClient().search(q, 'fused', filters)).hits.slice(0, count).map((h) => h.frameId); }
      catch { /* models unavailable: fall back to the newest frames */ }
      if (!ids.length) ids = (await listFrames()).filter((f) => !r?.ms || f.wall >= Date.now() - r.ms).slice(-count).reverse().map((f) => f.id);
      if (!ids.length) return setAerr('Nothing is stored yet. Record something or load the demo first.');
      setPicked(ids);
    } catch (e) { setAerr(e instanceof Error ? e.message : String(e)); } finally { setAsking(false); }
  };
  const send = async () => {
    if (!picked) return;
    setAsking(true); setAerr(null);
    try { setAnswer({ text: await askAboutFrames(q, picked), ids: picked }); setPicked(null); }
    catch (e) { setAerr(e instanceof Error ? e.message : String(e)); } finally { setAsking(false); }
  };

  return (
    <div className="stack">
      <section className="panel" aria-labelledby="g-h">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 id="g-h">Gemini connection</h3>
          <span className={'badge' + (ready ? ' ok' : '')}>{ready ? 'connected' : cfg.key ? 'needs confirmation' : 'not set up'}</span>
        </div>
        <div className="disclosure">
          <b>What this does.</b> When you press Analyze or Ask, the selected frames (the blurred versions stored here) and their scrubbed text are sent from your browser straight to Google’s Gemini API, using your key. Google’s terms apply to that data.
          <ul>
            <li>Your key is saved only in this browser and sent only to generativelanguage.googleapis.com.</li>
            <li>Nothing is sent in the background. Every call starts from a button you press.</li>
            <li>Without a key, Flatpak never contacts Google.</li>
          </ul>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="keyrow">
            <label className="sr" htmlFor="gk">Gemini API key</label>
            <input id="gk" type="password" autoComplete="off" spellCheck={false} value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder={cfg.key ? `Saved key: ${maskKey(cfg.key)}` : 'Paste your Gemini API key (starts with AIza…)'} />
            <label className="sr" htmlFor="gm">Model</label>
            <input id="gm" list="gmodels" value={model} onChange={(e) => setModel(e.target.value)} style={{ width: 210 }} />
            <datalist id="gmodels">{MODEL_CHOICES.map((m) => <option key={m} value={m} />)}</datalist>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>Get a key free at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>. Restrict it to the Generative Language API in Google Cloud if you can.</p>
          <label className="chk" style={{ margin: '6px 0 14px' }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I understand the frames I analyze are sent to Google.</label>
          <div className="row">
            <button className="btn primary" type="submit" disabled={busy}>Save</button>
            <button className="btn" type="button" disabled={busy || !ready} onClick={() => void test()}>Test key</button>
            {cfg.key && <button className="btn danger" type="button" disabled={busy} onClick={() => void removeGeminiKey().then(() => setMsg({ ok: true, text: 'Key removed from this browser.' }))}>Remove key</button>}
          </div>
        </form>
        {msg && <div className={'notice' + (msg.ok ? '' : ' err')} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
        {usage && usage.calls > 0 && <p className="muted mono" style={{ marginTop: 10 }}>Sent so far from this browser: {usage.calls} request{usage.calls === 1 ? '' : 's'}, {usage.images} image{usage.images === 1 ? '' : 's'}, {fmtBytes(usage.chars)} of text.</p>}
      </section>

      <section className="panel" aria-labelledby="a-h">
        <h3 id="a-h">Ask about what you saw</h3>
        <p className="muted">Flatpak finds the most relevant frames on this device first. You see exactly which ones will be sent, then decide.</p>
        <label className="sr" htmlFor="aq">Your question</label>
        <textarea id="aq" rows={3} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. What plan was I comparing, and what did it cost?" />
        <div className="row filters">
          <label>When <select value={scope} onChange={(e) => setScope(e.target.value)}>{SCOPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          <label>Frames to send <select value={count} onChange={(e) => setCount(Number(e.target.value))}>{[2, 3, 4, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <button className="btn" onClick={() => void find()} disabled={asking}>{asking && !picked ? 'Finding…' : 'Find relevant frames'}</button>
        </div>
        {!ready && <div className="notice">Add and confirm a Gemini key above to send anything. You can still preview which frames would be chosen.</div>}
        {aerr && <div className="notice err" role="alert">{aerr}</div>}
        {picked && (
          <div>
            <p><b>{picked.length} frame{picked.length === 1 ? '' : 's'}</b> will be sent to Gemini, blurred as stored:</p>
            <div className="sent">{picked.map((id) => <Thumb key={id} id={id} />)}</div>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn primary" disabled={!ready || asking} onClick={() => void send()}>{asking ? 'Asking Gemini…' : `Send ${picked.length} to Gemini`}</button>
              <button className="btn" onClick={() => setPicked(null)}>Cancel</button>
            </div>
          </div>
        )}
        {answer && (
          <div style={{ marginTop: 18 }} aria-live="polite">
            <h4 style={{ marginBottom: 8 }}>Answer</h4>
            <div className="answer">{answer.text}</div>
            <div className="sent">{answer.ids.map((id, i) => <div key={id}><Thumb id={id} /><span className="mono muted">Frame {i + 1}</span></div>)}</div>
          </div>
        )}
      </section>
    </div>
  );
}
