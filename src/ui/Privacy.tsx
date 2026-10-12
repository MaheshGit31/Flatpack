import { useCallback, useEffect, useState } from 'react';
import { deleteEverything, deleteSession, expireOld, getKv, getSettings, listSessions, saveSettings, storageByDay, type DayUsage } from '../store/db';
import { collectNet, summarize, type NetSummary } from '../privacy/netaudit';
import { recorder } from '../capture/recorder';
import type { SessionRec, Settings } from '../types';
import { experimentalAudio } from '../util/flags';
import { fmtBytes } from '../util/format';

export function PrivacyPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [sessions, setSessions] = useState<SessionRec[]>([]);
  const [usage, setUsage] = useState<DayUsage[]>([]);
  const [net, setNet] = useState<NetSummary | null>(null);
  const [blk, setBlk] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [quota, setQuota] = useState<{ used: number; quota: number } | null>(null);

  const refresh = useCallback(async () => {
    setS(await getSettings());
    setSessions(await listSessions());
    setUsage(await storageByDay());
    const e = await navigator.storage?.estimate?.();
    if (e?.usage !== undefined && e.quota) setQuota({ used: e.usage, quota: e.quota });
    setNet(summarize(await collectNet(), (await getKv<number>('models-ready-at')) ?? null));
  }, []);
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 4000); return () => clearInterval(t); }, [refresh]);

  const patch = async (p: Partial<Settings>) => { setS(await saveSettings(p)); };
  if (!s) return null;
  const max = Math.max(1, ...usage.map((u) => u.bytes));
  return (
    <section aria-labelledby="p-h">
      <div className="grid2">
        <div className="card">
          <h3>What happens to a frame</h3>
          <ol className="steps">
            <li>The browser hands Flatpak a snapshot. It is compared with the last kept frame (64-bit dHash + a coarse change grid). Near-duplicates are dropped.</li>
            <li>OCR runs locally. If a block-list phrase is on screen, the <b>whole frame is dropped</b>.</li>
            <li>Card numbers (Luhn-checked), emails, phones, SSNs, API-key shapes and anything next to “password / token / secret / CVC” are <b>pixelated in the stored image</b>. The original pixels are overwritten, and the OCR text is scrubbed too.</li>
            <li>Only the redacted image, its CLIP vector and the scrubbed text go into IndexedDB. There is no server to send them to.</li>
          </ol>
          <p className="muted">Redaction depends on OCR. Text that OCR misses, such as handwriting, very small text or text inside images, is not blurred. Share one window instead of the whole screen when you can.</p>
        </div>
        <div className="card" aria-labelledby="net-h">
          <h3 id="net-h">Network audit</h3>
          {net && (
            <>
              <div className="grid3">
                <div className="stat"><div className="v">{net.afterReady.total}</div><div className="k">requests since models loaded</div></div>
                <div className="stat"><div className="v">{net.afterReady.external}</div><div className="k">to other origins</div></div>
                <div className="stat"><div className="v">{net.total}</div><div className="k">total this page load</div></div>
              </div>
              <p className="muted">Models download once from {net.external.length ? [...new Set(net.external.map((e) => e.origin.replace('https://', '')))].join(', ') : 'huggingface.co (not needed yet)'} and are then cached. Every other asset is served from this site. If you add a Gemini key and use Ask AI, those calls to generativelanguage.googleapis.com are counted here too.</p>
              <details><summary>All external requests ({net.external.length})</summary><ul className="netlist mono">{net.external.slice(-40).map((e, i) => <li key={i}>{e.source}: {e.name.slice(0, 90)}</li>)}</ul></details>
              <p className="muted">This panel sees the page and the indexing worker. The automated test checks every thread at the network level.</p>
            </>
          )}
        </div>
      </div>

      <div className="sec"><h2>Controls</h2></div>
      <div className="grid2">
        <div className="card">
          <h3>Capture</h3>
          <label className="fld">Sampling interval <input type="number" min={1} max={30} step={1} value={s.intervalMs / 1000} onChange={(e) => void patch({ intervalMs: Math.max(1, Number(e.target.value)) * 1000 })} /> s</label>
          <label className="fld">Duplicate threshold <input type="range" min={0} max={20} value={s.dedupeThreshold} onChange={(e) => void patch({ dedupeThreshold: Number(e.target.value) })} /> <span className="mono">{s.dedupeThreshold} bits</span></label>
          <p className="muted">Frames within this many differing bits (of 64) of the last kept frame, with a quiet change grid, are treated as unchanged. Applies to the next recording.</p>
          <label className="chk"><input type="checkbox" checked={s.ocrEnabled} onChange={(e) => void patch({ ocrEnabled: e.target.checked })} /> Read text on screen (OCR, needed for redaction and text search)</label>
          {experimentalAudio() && <label className="chk"><input type="checkbox" checked={s.audioFeature} onChange={(e) => void patch({ audioFeature: e.target.checked })} /> Enable voice memory (experimental, off by default)</label>}
        </div>
        <div className="card">
          <h3>Never store a screen that shows…</h3>
          <ul className="chips">{s.blocklist.map((b) => <li key={b}><span>{b}</span><button aria-label={`Remove ${b}`} onClick={() => void patch({ blocklist: s.blocklist.filter((x) => x !== b) })}>×</button></li>)}</ul>
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (blk.trim()) { void patch({ blocklist: [...new Set([...s.blocklist, blk.trim().toLowerCase()])] }); setBlk(''); } }}>
            <input aria-label="Add a block-list phrase" value={blk} onChange={(e) => setBlk(e.target.value)} placeholder="add a phrase, e.g. bank statement" />
            <button className="btn" type="submit">Add</button>
          </form>
        </div>
      </div>

      <div className="sec"><h2>Your data</h2></div>
      <div className="card">
        <div className="row"><b>Auto-delete after</b>
          <select value={s.expiryDays} onChange={(e) => void patch({ expiryDays: Number(e.target.value) })} aria-label="Auto-expiry">
            {[1, 3, 7, 14, 30, 0].map((d) => <option key={d} value={d}>{d === 0 ? 'never' : `${d} day${d === 1 ? '' : 's'}`}</option>)}
          </select>
          <button className="btn" onClick={() => void expireOld(s.expiryDays || 36500).then((n) => { setMsg(`Removed ${n} expired frame(s).`); void refresh(); })}>Run now</button>
          {quota && <span className="mono muted">browser storage used: {fmtBytes(quota.used)} of {fmtBytes(quota.quota)}</span>}
        </div>
        <div className="usage" aria-label="Storage by day">
          {usage.map((u) => <div key={u.day} className="u-row"><span className="mono">{u.day}</span><div><i style={{ width: `${(u.bytes / max) * 100}%` }} /></div><span className="mono">{fmtBytes(u.bytes)} · {u.frames}</span></div>)}
        </div>
        <table className="sess"><thead><tr><th>Session</th><th>Kept / captured</th><th /></tr></thead>
          <tbody>{sessions.map((x) => <tr key={x.id}><td>{x.label}{x.demo ? ' (demo)' : ''}</td><td className="mono">{x.counters.kept} / {x.counters.captured}</td><td><button className="btn" onClick={() => { if (confirm(`Delete "${x.label}" and all its frames?`)) void deleteSession(x.id).then(refresh); }}>Delete</button></td></tr>)}</tbody></table>
        <div className="row">
          <button className="btn danger" onClick={async () => { if (!confirm('Delete every session, frame, vector and transcript stored by Flatpak in this browser?')) return; await recorder().stop(); await deleteEverything({ models: false }); setMsg('Everything deleted.'); void refresh(); }}>Delete everything</button>
          <button className="btn danger" onClick={async () => { if (!confirm('Delete all data AND the cached AI models (about 155 MB, plus 44 MB if you used voice)? They will be downloaded again next time.')) return; await recorder().stop(); await deleteEverything({ models: true }); setMsg('Everything and the cached models deleted.'); void refresh(); }}>Delete everything + models</button>
        </div>
        {msg && <div className="notice" role="status">{msg}</div>}
      </div>
    </section>
  );
}
