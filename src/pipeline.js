import { config } from './config.js';
import { read, diagnoseFix } from './read.js';
import { makePlan } from './plan.js';
import { drawPanel } from './draw.js';
import { review } from './critic.js';
import { pool, safeErr } from './util.js';
import { getPhoto, save, savePanel, setPanel, readPanel } from './store.js';

const b64 = (p) => ({ imageBase64: p.data.toString('base64'), mime: p.mime });

/** Draw one panel, emit it immediately, then critic-check; regenerate ONCE if it fails. */
async function produceStep(guide, step, emit, { photo, fixPhoto, replaced = false }) {
  const n = step.n;
  try {
    let out = await drawPanel({ photo, step, fixPhoto, rev: (guide.panels[n]?.rev ?? -1) + 1, attempt: 0 });
    savePanel(guide, n, out);
    emit('panel', { n, ...b64(out), replaced });

    const verdict = await review({ panel: out, step, n, attempt: 0 });
    let retried = false;
    let passed = verdict.pass;
    if (verdict.pass === false) {
      retried = true;
      try {
        out = await drawPanel({ photo, step, fixPhoto, reasons: verdict.reasons, rev: (guide.panels[n]?.rev ?? -1) + 1, attempt: 1 });
        savePanel(guide, n, out); // accept the retry either way
        emit('panel', { n, ...b64(out), replaced: true });
        const v2 = await review({ panel: out, step, n, attempt: 1 });
        passed = v2.pass;
      } catch {
        passed = false; // keep the first image
      }
    }
    setPanel(guide, n, { critic: { passed, retried } });
    emit('critic', { n, passed, retried });
  } catch (e) {
    const error = safeErr(e);
    console.error(`[panel ${n}] failed: ${String(e?.message || e).slice(0, 500)}`.replace(process.env.GEMINI_API_KEY || '\u0000', '[redacted]'));
    setPanel(guide, n, { status: 'failed', error });
    emit('panel_error', { n, message: error });
  }
}

export async function drawSteps(guide, steps, emit, opts) {
  const photo = getPhoto(guide.id);
  await pool(steps, config.concurrency, (s) => produceStep(guide, s, emit, { photo, ...opts }));
}

export async function runGuide(guide, emit) {
  try {
    guide.status = 'running';
    const photo = getPhoto(guide.id);
    emit('status', { stage: 'read', message: 'looking at your photo' });
    const info = await read({ photo, hint: guide.hint });
    Object.assign(guide, { subject: info.subject, goal: info.goal, audience_note: info.audience_note, safety_category: info.safety_category });
    if (info.needs_clarification) {
      guide.status = 'clarify';
      save(guide);
      emit('clarify', { question: info.clarifying_question });
      return;
    }
    emit('status', { stage: 'plan', message: 'planning the steps' });
    guide.plan = await makePlan({ photo, info, hint: guide.hint });
    save(guide);
    emit('plan', { subject: guide.subject, goal: guide.goal, safety_category: guide.safety_category, steps: guide.plan.map(({ n, action, is_warning }) => ({ n, action, is_warning })) });
    emit('status', { stage: 'draw', message: 'drawing panels' });
    await drawSteps(guide, guide.plan, emit, {});
    guide.status = 'done';
    save(guide);
    emit('done', { id: guide.id });
  } catch (e) {
    guide.status = 'error';
    save(guide);
    emit('error', { message: safeErr(e) });
  }
}

/** "this isn't what I see": diagnose, then regenerate ONLY the affected step + dependents. */
export async function runFix(guide, { photo, note, n }, emit) {
  try {
    emit('status', { stage: 'diagnose', message: 'checking what changed' });
    const d = await diagnoseFix({ guide, photo, note, clicked: n });
    for (const k of d.set) {
      const step = guide.plan.find((s) => s.n === k);
      const r = d.revised[k];
      if (r) { step.panel_spec = r.panel_spec; step.check = r.check || step.check; }
      else if (note) step.panel_spec += ` (revision: ${note.slice(0, 200)})`;
    }
    save(guide);
    emit('fix', { affected: d.affected, regenerate: d.set, explanation: d.what_differs });
    const steps = guide.plan.filter((s) => d.set.includes(s.n));
    const origPhoto = getPhoto(guide.id);
    await pool(steps, config.concurrency, (s) => produceStep(guide, s, emit, { photo: origPhoto, fixPhoto: photo, replaced: true }));
    emit('done', { id: guide.id, replaced: d.set });
  } catch (e) {
    emit('error', { message: safeErr(e) });
  }
}

export async function runRetry(guide, n, emit) {
  const step = guide.plan.find((s) => s.n === n);
  if (!step) return emit('error', { message: 'no such step' });
  emit('status', { stage: 'draw', message: `redrawing step ${n}` });
  await drawSteps(guide, [step], emit, { replaced: true });
  emit('done', { id: guide.id, replaced: [n] });
}

export { readPanel };
