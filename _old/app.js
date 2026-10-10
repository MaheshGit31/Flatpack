const $ = (s) => document.querySelector(s);
const els = {
  intake: $('#intake'), guide: $('#guide'), form: $('#form'), photo: $('#photo'), drop: $('#drop'), dropMain: $('#dropMain'),
  preview: $('#preview'), hint: $('#hint'), go: $('#go'), grid: $('#grid'), subject: $('#subject'), status: $('#status'),
  topActions: $('#topActions'), pdfBtn: $('#pdfBtn'), shareBtn: $('#shareBtn'), disclaimer: $('#disclaimer'), toast: $('#toast'),
  clarify: $('#clarify'), clarifyQ: $('#clarifyQ'), clarifyForm: $('#clarifyForm'), clarifyA: $('#clarifyA'), again: $('#again'),
  fixDlg: $('#fixDlg'), fixForm: $('#fixForm'), fixPhoto: $('#fixPhoto'), fixNote: $('#fixNote'), fixCancel: $('#fixCancel'), fixPhotoLbl: $('#fixPhotoLbl'),
  mockBanner: $('#mockBanner'),
};
let file = null;
let state = { id: null, steps: [], abort: null, fixStep: null };

// ---------- helpers ----------
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => els.toast.classList.remove('show'), 2600);
}
const setStatus = (msg, busy = true) => { els.status.textContent = msg || ''; els.status.classList.toggle('busy', !!msg && busy); };

/** tiny SSE-over-fetch client (works for GET replays and streaming POSTs) */
async function sse(url, opts, onEvent, signal) {
  const res = await fetch(url, { ...opts, signal });
  if (!res.ok) {
    let msg = `error ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let ev = 'message', data = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) ev = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data) { try { onEvent(ev, JSON.parse(data)); } catch (e) { console.error(e); } }
    }
  }
}

// ---------- rendering ----------
const SKEL_SVG = `<svg viewBox="0 0 100 100" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round"><circle class="draw" cx="40" cy="26" r="12"/><path class="draw" d="M26 46h28l6 36H20z"/><path class="draw" d="M62 60h22v22H62z"/></svg>`;

function makeSlot(step) {
  const li = document.createElement('li');
  li.className = 'slot' + (step.is_warning ? ' warn' : '');
  li.dataset.n = step.n;
  li.style.animationDelay = `${(step.n - 1) * 70}ms`;
  li.innerHTML = `
    <div class="frame"><span class="num">${step.n}</span><div class="skel">${SKEL_SVG}</div></div>
    <div class="meta"><span class="badge" aria-live="polite"></span><button class="fixbtn" type="button">this isn't what i see</button></div>`;
  li.querySelector('.fixbtn').addEventListener('click', () => openFix(step.n));
  li.querySelector('.frame').setAttribute('aria-label', `step ${step.n}: ${step.action}`);
  return li;
}
const slot = (n) => els.grid.querySelector(`.slot[data-n="${n}"]`);

function showPanel(n, src) {
  const li = slot(n);
  if (!li) return;
  const frame = li.querySelector('.frame');
  frame.querySelector('.skel')?.remove();
  frame.querySelector('.failed')?.remove();
  let im = frame.querySelector('img');
  const fresh = document.createElement('img');
  fresh.alt = `step ${n}: ${state.steps.find((s) => s.n === n)?.action || ''}`;
  fresh.decoding = 'async';
  fresh.src = src;
  if (im) im.replaceWith(fresh); else frame.appendChild(fresh);
  li.classList.add('has-img');
  li.classList.remove('redraw');
  setBadge(n, 'checking', 'checking...');
}
function setBadge(n, kind, text) {
  const b = slot(n)?.querySelector('.badge');
  if (!b) return;
  b.className = 'badge ' + (kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : '');
  b.textContent = text || '';
}
function showFailed(n) {
  const li = slot(n);
  if (!li) return;
  const frame = li.querySelector('.frame');
  frame.querySelector('.skel')?.remove();
  frame.querySelector('img')?.remove();
  li.classList.remove('has-img', 'redraw');
  if (!frame.querySelector('.failed')) {
    const d = document.createElement('div');
    d.className = 'failed';
    d.innerHTML = `<span class="q">?</span><button class="btn small" type="button">retry this step</button>`;
    d.querySelector('button').addEventListener('click', () => retryStep(n));
    frame.appendChild(d);
  }
  setBadge(n, 'warn', 'could not draw');
}
function setCritic({ n, passed, retried }) {
  if (passed === true) setBadge(n, 'ok', retried ? 'checked (fixed)' : 'checked');
  else if (passed === false) setBadge(n, 'warn', 'unverified');
  else setBadge(n, '', 'not checked');
}

function handle(ev, d) {
  switch (ev) {
    case 'status': setStatus(d.message); break;
    case 'plan':
      state.steps = d.steps;
      els.subject.textContent = d.subject;
      document.title = `FLATPACK - ${d.subject}`;
      els.grid.replaceChildren(...d.steps.map(makeSlot));
      els.disclaimer.hidden = !d.safety_category || d.safety_category === 'none';
      break;
    case 'panel': showPanel(d.n, `data:${d.mime};base64,${d.imageBase64}`); break;
    case 'critic': setCritic(d); break;
    case 'panel_error': showFailed(d.n); break;
    case 'fix':
      d.regenerate.forEach((n) => { slot(n)?.classList.add('redraw'); setBadge(n, '', 'redrawing...'); });
      setStatus(d.explanation ? `redrawing steps ${d.regenerate.join(', ')}` : 'redrawing');
      break;
    case 'clarify':
      els.clarify.hidden = false;
      els.clarifyQ.textContent = d.question;
      setStatus('');
      break;
    case 'done': setStatus(''); break;
    case 'error': setStatus(`oops: ${d.message}`, false); toast(d.message); break;
  }
}

function enterGuide(id) {
  state.id = id;
  els.intake.hidden = true;
  els.guide.hidden = false;
  els.topActions.hidden = false;
  els.pdfBtn.href = `/api/guide/${id}/pdf`;
  els.clarify.hidden = true;
  history.replaceState({}, '', `/guide/${id}`);
  window.scrollTo({ top: 0 });
}

async function watch(id, query = '') {
  state.abort?.abort();
  state.abort = new AbortController();
  try {
    await sse(`/api/guide/${id}/stream${query}`, {}, handle, state.abort.signal);
  } catch (e) {
    if (e.name !== 'AbortError') { setStatus(`oops: ${e.message}`, false); toast(e.message); }
  }
}

// ---------- intake ----------
function setFile(f) {
  if (!f) return;
  if (!/^image\//.test(f.type)) return toast('images only');
  if (f.size > 8 * 1024 * 1024) return toast('image too big, max 8MB');
  file = f;
  els.preview.src = URL.createObjectURL(f);
  els.preview.hidden = false;
  els.drop.classList.add('has');
  els.dropMain.textContent = 'tap to retake';
  els.go.disabled = false;
}
els.photo.addEventListener('change', () => setFile(els.photo.files[0]));
['dragenter', 'dragover'].forEach((e) => els.drop.addEventListener(e, (ev) => { ev.preventDefault(); els.drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((e) => els.drop.addEventListener(e, (ev) => { ev.preventDefault(); els.drop.classList.remove('over'); }));
els.drop.addEventListener('drop', (ev) => setFile(ev.dataTransfer.files[0]));
els.drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.photo.click(); } });

async function submit(hint) {
  if (!file) return;
  els.go.disabled = true;
  const fd = new FormData();
  fd.append('photo', file);
  fd.append('hint', hint);
  els.subject.textContent = 'reading your photo';
  els.grid.replaceChildren();
  els.disclaimer.hidden = true;
  setStatus('uploading');
  enterGuide('pending');
  els.topActions.hidden = true;
  try {
    const r = await fetch('/api/guide', { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'upload failed');
    enterGuide(j.id);
    watch(j.id);
  } catch (e) {
    toast(e.message);
    els.guide.hidden = true;
    els.intake.hidden = false;
    history.replaceState({}, '', '/');
  } finally {
    els.go.disabled = false;
  }
}
els.form.addEventListener('submit', (e) => { e.preventDefault(); submit(els.hint.value.trim()); });
els.clarifyForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const h = `${els.hint.value.trim()} ${els.clarifyA.value.trim()}`.trim();
  els.hint.value = h;
  els.clarifyA.value = '';
  submit(h);
});

document.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () => {
  const id = `demo-${b.dataset.demo}`;
  els.subject.textContent = 'demo';
  els.grid.replaceChildren();
  els.disclaimer.hidden = true;
  enterGuide(id);
  watch(id);
}));

els.again.addEventListener('click', () => { location.href = '/'; });

// ---------- share ----------
els.shareBtn.addEventListener('click', async () => {
  const url = `${location.origin}/guide/${state.id}`;
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(url);
    else throw 0;
    toast('link copied');
  } catch {
    if (navigator.share) navigator.share({ url }).catch(() => {});
    else window.prompt('copy this link', url);
  }
});

// ---------- fix / retry ----------
function openFix(n) {
  if (state.id?.startsWith('demo-')) return toast('demo guides are read-only. make your own to use this');
  state.fixStep = n;
  els.fixPhoto.value = '';
  els.fixNote.value = '';
  els.fixPhotoLbl.firstChild.textContent = 'add photo';
  els.fixDlg.showModal();
}
els.fixPhoto.addEventListener('change', () => { els.fixPhotoLbl.firstChild.textContent = els.fixPhoto.files[0] ? 'photo added' : 'add photo'; });
els.fixCancel.addEventListener('click', () => els.fixDlg.close());
els.fixForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = els.fixPhoto.files[0];
  const note = els.fixNote.value.trim();
  if (!f && !note) return toast('add a photo or a note');
  els.fixDlg.close();
  const fd = new FormData();
  if (f) fd.append('photo', f);
  fd.append('note', note);
  runAction(`/api/guide/${state.id}/step/${state.fixStep}/fix`, fd);
});
function retryStep(n) {
  slot(n)?.classList.add('redraw');
  runAction(`/api/guide/${state.id}/step/${n}/retry`);
}
async function runAction(url, body) {
  setStatus('working');
  try { await sse(url, { method: 'POST', body }, handle); }
  catch (e) { setStatus(`oops: ${e.message}`, false); toast(e.message); document.querySelectorAll('.slot.redraw').forEach((s) => s.classList.remove('redraw')); }
}

// ---------- boot ----------
fetch('/api/health').then((r) => r.json()).then((h) => { els.mockBanner.hidden = !h.mock; }).catch(() => {});
const m = location.pathname.match(/^\/guide\/([a-z0-9-]+)$/);
if (m) { enterGuide(m[1]); watch(m[1]); }
