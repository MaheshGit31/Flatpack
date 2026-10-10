import { useState } from 'react';
import { loadDemo } from '../store/demo';

export function Landing() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tryDemo = async () => {
    setBusy(true); setErr(null);
    try { await loadDemo(); location.hash = '#/app/search'; } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="lp">
      <div className="wrap">
        <header className="lp-nav">
          <a className="brand" href="#/"><span className="logo" aria-hidden />Flatpak</a>
          <div className="grow" />
          <a className="t" href="#how">How it works</a>
          <a className="t" href="#privacy">Privacy</a>
          <a className="btn" href="#/app/overview">Open dashboard</a>
        </header>

        <main>
          <section className="lp-hero" aria-labelledby="h1">
            <span className="eyebrow">screen memory · stays on your device</span>
            <h1 id="h1">Ctrl+F for everything you’ve <em>looked at.</em></h1>
            <p className="sub">Flatpak remembers your screen so you can search it later by describing it or quoting it. It runs entirely in your browser: no account, no upload, no server.</p>
            <div className="lp-cta">
              <a className="btn primary lg" href="#/app/record">Start recording</a>
              <button className="btn lg" onClick={() => void tryDemo()} disabled={busy}>{busy ? 'Loading demo…' : 'Try it with demo data'}</button>
            </div>
            {err && <div className="notice err" role="alert">{err}</div>}
            <p className="lp-fine">Desktop Chrome or Edge. The first run downloads about 155 MB of models once, then works offline.</p>
            <figure className="lp-shot" style={{ width: '100%' }} aria-label="Example search">
              <div className="bar-top"><i /><i /><i /><span>flatpak · search</span></div>
              <div className="demo-q" aria-hidden><span className="muted">⌕</span><b>that red line chart from yesterday</b><span className="caret" /></div>
              <div className="demo-grid" aria-hidden>
                <div><img src="/demo/thumbs/dashboard.webp" alt="" /><span>visual #1 · text #2</span></div>
                <div><img src="/demo/thumbs/pricing.webp" alt="" /><span>text #1</span></div>
                <div><img src="/demo/thumbs/code.webp" alt="" /><span>visual #3</span></div>
              </div>
            </figure>
          </section>

          <section className="lp-sec" id="how" aria-labelledby="how-h">
            <h2 id="how-h">Four quiet steps, all on your machine.</h2>
            <p className="intro">You share a window. Flatpak does the rest and keeps only what is worth keeping.</p>
            <div className="lp-steps">
              <div><h3>Notice what changed</h3><p>One frame every few seconds. Near-duplicates are dropped before they cost you any storage.</p></div>
              <div><h3>Read it</h3><p>Text on screen is read locally with OCR, so you can search the exact words you saw.</p></div>
              <div><h3>Blur what’s private</h3><p>Card numbers, emails, phones and secrets are pixelated before a frame is saved. Block-listed screens are never saved.</p></div>
              <div><h3>Understand it</h3><p>A CLIP model turns each screen into a meaning vector, so “pricing plans” finds the pricing page.</p></div>
            </div>
          </section>

          <section className="lp-sec" id="privacy" aria-labelledby="priv-h">
            <h2 id="priv-h">Private by construction, not by promise.</h2>
            <div className="lp-facts">
              <div><div className="big">0</div><p>requests to any server after the models load. The test suite checks every thread.</p></div>
              <div><div className="big">~26 ms</div><p>median search over the demo set, on a plain laptop-class CPU.</p></div>
              <div><div className="big">155 MB</div><p>of models, downloaded once and cached in your browser.</p></div>
              <div><div className="big">1 click</div><p>to delete every frame, vector and transcript Flatpak holds.</p></div>
            </div>
            <div className="lp-two">
              <div>
                <h3>Optional: bring your own Gemini key</h3>
                <p>If you want summaries or to ask questions about your day, add your own Gemini API key in the dashboard. It stays in your browser. Only the frames you choose to analyze are sent, already blurred, straight to Google. Leave it empty and Flatpak never makes a request.</p>
              </div>
              <div>
                <h3>What it can’t promise</h3>
                <ul>
                  <li>Redaction relies on OCR, so tiny or handwritten text can slip through.</li>
                  <li>Share one window instead of your whole screen when you can.</li>
                  <li>Retrieval numbers come from a small synthetic benchmark, so treat them as a floor for your own screens, not a guarantee.</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="lp-end" aria-label="Get started">
            <h2>Give your screen a memory.</h2>
            <div className="lp-cta">
              <a className="btn primary lg" href="#/app/record">Start recording</a>
              <a className="btn lg" href="#/app/overview">Open dashboard</a>
            </div>
          </section>
        </main>
        <footer className="lp-foot">Flatpak · built for Banana Hacks 2026 · nothing you record leaves this browser unless you add your own Gemini key.</footer>
      </div>
    </div>
  );
}
