// Builds public/demo/* by running the REAL in-browser pipeline (OCR → redact → CLIP → WebP) over the synthetic scenes.
// Needs: `npm run build && npx vite preview --port 4173` running, network access to huggingface.co for the model download.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { SCENES } from './scenes.mjs';

const OUT = 'public/demo';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT + '/frames', { recursive: true });
mkdirSync(OUT + '/thumbs', { recursive: true });

const plan = [
  { label: 'Planning the Q3 roadmap', daysAgo: 2, hour: 9, minute: 30, scenes: ['code', 'dashboard', 'slides', 'spreadsheet', 'chat'] },
  { label: 'Booking a trip and shopping', daysAgo: 1, hour: 14, minute: 10, scenes: ['email', 'pricing', 'shopping', 'checkout', 'maps'] },
  { label: 'Evening wind-down', daysAgo: 0, hour: 19, minute: 40, scenes: ['video', 'social', 'doc', 'settings', 'terminal'] },
];
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, proxy, args: ['--ignore-certificate-errors'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true })).newPage();
p.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)));
await p.goto(process.env.APP_URL || 'http://localhost:4173/');
await p.waitForFunction(() => window.__flatpak);

const sessions = [];
const vecs = [];
for (const s of plan) {
  const items = s.scenes.map((id) => ({ id, b64: readFileSync(`samples/${id}.png`).toString('base64') }));
  const res = await p.evaluate(async ({ items, label }) => {
    const f = window.__flatpak;
    const blobs = items.map((i) => ({ name: i.id, blob: new Blob([Uint8Array.from(atob(i.b64), (c) => c.charCodeAt(0))], { type: 'image/png' }) }));
    const r = await f.importImages(blobs, { label, gapMs: 90_000, demo: true });
    const frames = (await f.store.listFrames(r.session.id)).sort((a, b) => a.seq - b.seq);
    const out = [];
    for (const fr of frames) {
      const bl = await f.store.getBlobs(fr.id);
      const oc = await f.store.getOcr(fr.id);
      const v = (await (await f.store.db()).get('vectors', fr.id)).vec;
      const enc = (blob) => new Promise((ok) => { const rd = new FileReader(); rd.onload = () => ok(String(rd.result).split(',')[1]); rd.readAsDataURL(blob); });
      out.push({ fr, text: oc.text, words: oc.words, full: await enc(bl.full), thumb: await enc(bl.thumb), vec: Array.from(v) });
    }
    return out;
  }, { items, label: s.label });
  const frames = [];
  const keptSeq = new Set(res.map((r) => r.fr.seq));
  for (const r of res) {
    const scene = s.scenes[r.fr.seq];
    writeFileSync(`${OUT}/frames/${scene}.webp`, Buffer.from(r.full, 'base64'));
    writeFileSync(`${OUT}/thumbs/${scene}.webp`, Buffer.from(r.thumb, 'base64'));
    frames.push({ scene, seq: r.fr.seq, tMs: r.fr.tMs, activity: r.fr.activity, activityConf: r.fr.activityConf, w: r.fr.w, h: r.fr.h, hasText: r.fr.hasText, redactions: r.fr.redactions, hash: r.fr.hash, indexMs: r.fr.indexMs, text: r.text, words: r.words, full: `frames/${scene}.webp`, thumb: `thumbs/${scene}.webp`, vecRow: vecs.length / 512 });
    vecs.push(...r.vec);
  }
  const skipped = s.scenes.map((sc, i) => ({ sc, i })).filter((x) => !keptSeq.has(x.i)).map((x) => ({ scene: x.sc, reason: 'blocklist phrase on screen: whole frame dropped, nothing stored' }));
  sessions.push({ label: s.label, daysAgo: s.daysAgo, hour: s.hour, minute: s.minute, frames, skipped });
}
const expected = Object.fromEntries(SCENES.map((s) => [s.id, s.activity]));
writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ version: 1, dim: 512, sessions, expected }));
writeFileSync(`${OUT}/vectors.bin`, Buffer.from(new Float32Array(vecs).buffer));
console.log('demo built:', sessions.map((s) => `${s.label}: ${s.frames.length} kept, ${s.skipped.length} skipped`).join(' | '));
await b.close();
