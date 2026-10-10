import express from 'express';
import compression from 'compression';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { prepPhoto, MAX_UPLOAD } from './image.js';
import { createGuide, getGuide, publicGuide, readPanel, listDemos, validId } from './store.js';
import { runGuide, runFix, runRetry } from './pipeline.js';
import { buildPdf } from './pdf.js';
import { ensureCharacter } from './character.js';
import { isMock } from './gemini.js';
import { safeErr, sleep } from './util.js';
import sharp from 'sharp';
import { renderSharePage, notFoundPage, titleOf } from './sharepage.js';

const app = express();
app.set('trust proxy', 1); // railway sits behind a proxy; needed for per-ip rate limits
app.disable('x-powered-by');
// gzip text, but never buffer the SSE streams
app.use(compression({ filter: (req, res) => !String(res.getHeader('Content-Type') || '').includes('event-stream') && compression.filter(req, res) }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD, files: 1, fields: 5 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('images only'), { status: 400 }));
  },
});

const guideLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: config.guidesPerHour, standardHeaders: true, legacyHeaders: false,
  message: { error: 'rate limit reached, try the demo buttons or come back in an hour' },
});
const fixLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: config.guidesPerHour * 3, standardHeaders: true, legacyHeaders: false,
  message: { error: 'rate limit reached, come back in an hour' },
});

// ---------- SSE plumbing ----------
const runs = new Map(); // id -> { events, listeners, done }
const busy = new Set(); // guide ids with a fix/retry in flight

function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function sseOpen(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': ok\n\n');
  const hb = setInterval(() => res.write(': hb\n\n'), 15000);
  res.on('close', () => clearInterval(hb));
}

function startRun(guide) {
  const run = { events: [], listeners: new Set(), done: false };
  runs.set(guide.id, run);
  const emit = (event, data) => {
    run.events.push([event, data]);
    for (const l of run.listeners) l(event, data);
    if (event === 'done' || event === 'error' || event === 'clarify') {
      run.done = true;
      setTimeout(() => runs.delete(guide.id), 10 * 60 * 1000).unref();
    }
  };
  runGuide(guide, emit);
}

// replay a finished/stored guide as SSE events (used for reopen + demo mode, zero API calls)
async function replay(res, guide, paceMs) {
  sseWrite(res, 'status', { stage: 'replay', message: 'loading guide' });
  if (!guide.plan.length) {
    sseWrite(res, guide.status === 'error' ? 'error' : 'status', { message: 'this guide has no steps' });
    return;
  }
  sseWrite(res, 'plan', { subject: guide.subject, goal: guide.goal, safety_category: guide.safety_category, steps: guide.plan.map(({ n, action, is_warning }) => ({ n, action, is_warning })) });
  for (const s of guide.plan) {
    if (res.writableEnded || res.destroyed) return;
    if (paceMs) await sleep(paceMs);
    const p = readPanel(guide, s.n);
    if (p) {
      sseWrite(res, 'panel', { n: s.n, imageBase64: p.data.toString('base64'), mime: p.mime });
      const c = guide.panels[s.n].critic;
      if (c) sseWrite(res, 'critic', { n: s.n, passed: c.passed, retried: c.retried });
    } else sseWrite(res, 'panel_error', { n: s.n, message: guide.panels[s.n]?.error || 'missing panel' });
  }
  sseWrite(res, 'done', { id: guide.id, replay: true });
}

// ---------- API ----------
app.get('/api/health', (_req, res) => res.json({ ok: true, mock: isMock, imageModel: config.imageModel, visionModel: config.visionModel }));

app.get('/api/demos', (_req, res) => {
  const demos = listDemos().map((k) => getGuide(`demo-${k}`)).filter((g) => g && g.plan.length).map((g) => ({
    id: g.id, title: titleOf(g), safety_category: g.safety_category,
    steps: g.plan.filter((s) => g.panels[s.n]?.status === 'ok').map((s) => ({ n: s.n, action: s.action, url: `/api/guide/${g.id}/panel/${s.n}?w=480&v=${g.panels[s.n].rev}` })),
  }));
  res.set('Cache-Control', 'public, max-age=60').json({ demos });
});

app.post('/api/guide', guideLimiter, upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'attach a photo' });
    const photo = await prepPhoto(req.file.buffer);
    const hint = String(req.body?.hint || '').slice(0, 300);
    const guide = createGuide({ hint, photo });
    startRun(guide);
    res.json({ id: guide.id });
  } catch (e) { next(e); }
});

app.get('/api/guide/:id', (req, res) => {
  const g = getGuide(req.params.id);
  if (!g) return res.status(404).json({ error: 'not found' });
  res.json(publicGuide(g));
});

app.get('/api/guide/:id/stream', async (req, res) => {
  const id = req.params.id;
  const g = getGuide(id);
  if (!g) return res.status(404).json({ error: 'not found' });
  sseOpen(res);
  const run = runs.get(id);
  if (run && !run.done) {
    for (const [ev, d] of run.events) sseWrite(res, ev, d);
    const l = (ev, d) => { sseWrite(res, ev, d); if (ev === 'done' || ev === 'error' || ev === 'clarify') res.end(); };
    run.listeners.add(l);
    res.on('close', () => run.listeners.delete(l));
    return;
  }
  const pace = id.startsWith('demo-') ? Number(req.query.pace ?? 450) : Number(req.query.pace || 0);
  await replay(res, g, Math.min(pace, 2000));
  res.end();
});

const webpCache = new Map();
app.get('/api/guide/:id/panel/:n', async (req, res, next) => {
  try {
    const g = getGuide(req.params.id);
    const n = Number(req.params.n);
    const p = g && readPanel(g, n);
    if (!p) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    const w = Math.min(Math.max(parseInt(req.query.w) || 0, 0), 1600);
    if (!w) return res.type(p.mime).send(p.data);
    const key = `${g.id}:${n}:${g.panels[n].rev}:${w}`;
    if (!webpCache.has(key)) {
      if (webpCache.size > 300) webpCache.clear();
      webpCache.set(key, await sharp(p.data).resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer());
    }
    res.type('image/webp').send(webpCache.get(key));
  } catch (e) { next(e); }
});

// 1200x630 social card: panel 1 on paper, shapes only (no fonts needed on the server)
const ogCache = new Map();
app.get('/og/:id.png', async (req, res, next) => {
  try {
    const g = getGuide(req.params.id);
    const p = g && readPanel(g, 1);
    if (!p) return res.status(404).end();
    const key = `${g.id}:${g.panels[1].rev}`;
    if (!ogCache.has(key)) {
      const panel = await sharp(p.data).resize(520, 520, { fit: 'contain', background: '#fff' }).png().toBuffer();
      const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#fff"/><rect x="0" y="0" width="1200" height="40" fill="#111"/><circle cx="1150" cy="20" r="9" fill="#E10600"/><rect x="62" y="82" width="526" height="526" fill="none" stroke="#111" stroke-width="6"/><rect x="62" y="560" width="526" height="48" fill="#111"/><circle cx="116" cy="584" r="12" fill="#E10600"/></svg>`);
      const card = await sharp(bg).composite([{ input: panel, left: 65, top: 85 }, ...(await Promise.all([2, 3].map(async (n, i) => { const q = readPanel(g, n); return q ? { input: await sharp(q.data).resize(300, 300, { fit: 'contain', background: '#fff' }).png().toBuffer(), left: 640 + i * 270, top: 140 + i * 40 } : null; }))).filter(Boolean)]).png().toBuffer();
      ogCache.set(key, card);
    }
    res.set('Cache-Control', 'public, max-age=86400').type('png').send(ogCache.get(key));
  } catch (e) { next(e); }
});

async function streamAction(req, res, task) {
  const g = getGuide(req.params.id);
  if (!g) return res.status(404).json({ error: 'not found' });
  if (g.id.startsWith('demo-')) return res.status(403).json({ error: 'demo guides are read-only. make your own guide to use this' });
  if (!g.plan.length) return res.status(409).json({ error: 'guide is not ready' });
  if (busy.has(g.id)) return res.status(409).json({ error: 'this guide is busy, wait a sec' });
  busy.add(g.id);
  sseOpen(res);
  try {
    await task(g, (ev, d) => !res.writableEnded && sseWrite(res, ev, d));
  } finally {
    busy.delete(g.id);
    res.end();
  }
}

app.post('/api/guide/:id/step/:n/fix', fixLimiter, upload.single('photo'), async (req, res, next) => {
  try {
    const n = Number(req.params.n);
    const note = String(req.body?.note || '').slice(0, 300).trim();
    if (!req.file && !note) return res.status(400).json({ error: 'add a photo or a short note' });
    const photo = req.file ? await prepPhoto(req.file.buffer) : null;
    const g = getGuide(req.params.id);
    if (g && !g.plan.some((s) => s.n === n)) return res.status(404).json({ error: 'no such step' });
    await streamAction(req, res, (guide, emit) => runFix(guide, { photo, note, n }, emit));
  } catch (e) { next(e); }
});

app.post('/api/guide/:id/step/:n/retry', fixLimiter, async (req, res, next) => {
  try {
    const n = Number(req.params.n);
    await streamAction(req, res, (guide, emit) => runRetry(guide, n, emit));
  } catch (e) { next(e); }
});

app.get('/api/guide/:id/pdf', async (req, res, next) => {
  try {
    const g = getGuide(req.params.id);
    if (!g) return res.status(404).json({ error: 'not found' });
    const pdf = await buildPdf(g);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="flatpack-${g.id}.pdf"`, 'Content-Length': pdf.length }).send(pdf);
  } catch (e) { next(e); }
});

// ---------- pages ----------
const origin = (req) => process.env.PUBLIC_URL || `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;
const indexHtml = fs.readFileSync(path.join(config.dirs.public, 'index.html'), 'utf8');
app.get('/', (req, res) => {
  const demo = listDemos().includes('gadget') ? 'demo-gadget' : listDemos()[0] ? `demo-${listDemos()[0]}` : null;
  res.type('html').send(indexHtml.replaceAll('__ORIGIN__', origin(req)).replaceAll('__GITHUB__', process.env.GITHUB_URL || 'https://github.com/MaheshGit31/flatpack').replaceAll('__OG__', demo ? `${origin(req)}/og/${demo}.png` : ''));
});
app.get('/g/:id', (req, res) => {
  const g = validId(req.params.id) ? getGuide(req.params.id) : null;
  if (!g) return res.status(404).type('html').send(notFoundPage());
  res.set('Cache-Control', 'no-cache').type('html').send(renderSharePage(g, origin(req)));
});
app.get('/guide/:id', (req, res) => res.redirect(302, `/g/${encodeURIComponent(req.params.id)}`));
app.use(express.static(config.dirs.public, { index: false, maxAge: '1h' }));

app.use((err, _req, res, _next) => {
  const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : err.status || 500;
  const error = err.code === 'LIMIT_FILE_SIZE' ? 'image too big, max 8MB' : status >= 500 ? 'something broke on our side' : err.message;
  if (status >= 500) console.error('[error]', safeErr(err));
  if (res.headersSent) return res.end();
  res.status(status).json({ error });
});

fs.mkdirSync(config.dirs.guides, { recursive: true });
app.listen(config.port, () => {
  console.log(`FLATPACK on :${config.port}  ${isMock ? '[MOCK MODE: no GEMINI_API_KEY, placeholder panels]' : `[image=${config.imageModel} vision=${config.visionModel}]`}`);
  ensureCharacter().catch((e) => console.error('[character] failed:', safeErr(e)));
});
