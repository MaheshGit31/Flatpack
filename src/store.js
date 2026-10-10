import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const mem = new Map();
const ID_RE = /^[a-z0-9-]{4,48}$/;
export const validId = (id) => typeof id === 'string' && ID_RE.test(id);

export function dirFor(id) {
  if (!validId(id)) throw Object.assign(new Error('bad id'), { status: 400 });
  return id.startsWith('demo-') ? path.join(config.dirs.demos, id.slice(5)) : path.join(config.dirs.guides, id);
}

export const newId = () => crypto.randomBytes(5).toString('hex');

export function createGuide({ hint, photo, id: forcedId }) {
  const id = forcedId || newId();
  const guide = { id, createdAt: new Date().toISOString(), hint: hint || '', status: 'new', subject: '', goal: '', audience_note: '', safety_category: 'none', plan: [], panels: {} };
  fs.mkdirSync(dirFor(id), { recursive: true });
  fs.writeFileSync(path.join(dirFor(id), 'photo.jpg'), photo);
  mem.set(id, guide);
  save(guide);
  return guide;
}

export function save(guide) {
  fs.writeFileSync(path.join(dirFor(guide.id), 'guide.json'), JSON.stringify(guide, null, 2));
}

export function getGuide(id) {
  if (!validId(id)) return null;
  if (mem.has(id)) return mem.get(id);
  const f = path.join(dirFor(id), 'guide.json');
  if (!fs.existsSync(f)) return null;
  const g = JSON.parse(fs.readFileSync(f, 'utf8'));
  g.id = id; // demos carry their folder id
  mem.set(id, g);
  return g;
}

export const getPhoto = (id) => fs.readFileSync(path.join(dirFor(id), 'photo.jpg'));

const ext = (mime) => (mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png');

export function savePanel(guide, n, { mime, data }, extra = {}) {
  const prev = guide.panels[n];
  const rev = (prev?.rev ?? -1) + 1;
  const file = `panel-${n}-r${rev}.${ext(mime)}`;
  fs.writeFileSync(path.join(dirFor(guide.id), file), data);
  if (prev?.file && prev.file !== file) fs.rmSync(path.join(dirFor(guide.id), prev.file), { force: true });
  guide.panels[n] = { file, mime, status: 'ok', rev, critic: prev?.critic && extra.keepCritic ? prev.critic : null, error: null, ...extra.fields };
  save(guide);
  return guide.panels[n];
}

export function setPanel(guide, n, fields) {
  guide.panels[n] = { ...(guide.panels[n] || { rev: 0 }), ...fields };
  save(guide);
}

export function readPanel(guide, n) {
  const p = guide.panels[n];
  if (!p?.file || p.status === 'failed') return null;
  const f = path.join(dirFor(guide.id), p.file);
  return fs.existsSync(f) ? { mime: p.mime, data: fs.readFileSync(f) } : null;
}

export function publicGuide(g) {
  return {
    id: g.id, status: g.status, subject: g.title || g.subject, goal: g.goal, safety_category: g.safety_category, createdAt: g.createdAt,
    steps: g.plan.map(({ n, action, is_warning }) => ({ n, action, is_warning, panel: g.panels[n] ? { status: g.panels[n].status, rev: g.panels[n].rev, critic: g.panels[n].critic, url: g.panels[n].status === 'ok' ? `/api/guide/${g.id}/panel/${n}?v=${g.panels[n].rev}` : null } : null })),
  };
}

export function listDemos() {
  if (!fs.existsSync(config.dirs.demos)) return [];
  return fs.readdirSync(config.dirs.demos).filter((d) => fs.existsSync(path.join(config.dirs.demos, d, 'guide.json')));
}
