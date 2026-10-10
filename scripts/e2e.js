// end-to-end smoke test against a running server: BASE=http://localhost:3000 npm test
import sharp from 'sharp';
import crypto from 'node:crypto';
const BASE = process.env.BASE || 'http://localhost:3000';
const h = (b) => crypto.createHash('md5').update(b).digest('hex').slice(0, 8);
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };

async function events(res) {
  const out = [];
  const dec = new TextDecoder(); let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const c = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = /event: (.*)/.exec(c)?.[1]; const d = /data: (.*)/.exec(c)?.[1];
      if (ev && d) out.push({ ev, t: Date.now(), d: JSON.parse(d) });
    }
  }
  return out;
}
const img = await sharp({ create: { width: 900, height: 700, channels: 3, background: '#ccc' } }).jpeg().toBuffer();
const form = (extra = {}) => { const fd = new FormData(); fd.append('photo', new Blob([img], { type: 'image/jpeg' }), 'x.jpg'); for (const [k, v] of Object.entries(extra)) fd.append(k, v); return fd; };

const health = await (await fetch(`${BASE}/api/health`)).json();
ok(health.ok, `health ok (mock=${health.mock})`);

// validation
let r = await fetch(`${BASE}/api/guide`, { method: 'POST', body: (() => { const fd = new FormData(); fd.append('photo', new Blob(['hello'], { type: 'text/plain' }), 'a.txt'); return fd; })() });
ok(r.status === 400, 'non-image rejected (400)');
r = await fetch(`${BASE}/api/guide`, { method: 'POST', body: (() => { const fd = new FormData(); fd.append('photo', new Blob([Buffer.alloc(9 * 1024 * 1024)], { type: 'image/jpeg' }), 'big.jpg'); return fd; })() });
ok(r.status === 413, 'oversize rejected (413)');

// create + stream
const t0 = Date.now();
const { id } = await (await fetch(`${BASE}/api/guide`, { method: 'POST', body: form({ hint: 'weekly pill medication schedule' }) })).json();
ok(!!id, `POST /api/guide -> id ${id}`);
const evs = await events(await fetch(`${BASE}/api/guide/${id}/stream`));
const names = evs.map((e) => e.ev);
ok(names[0] === 'status' && names.includes('plan'), 'status then plan streamed');
ok(names.indexOf('plan') < names.indexOf('panel'), 'plan arrives before first panel');
const plan = evs.find((e) => e.ev === 'plan').d;
const panels = evs.filter((e) => e.ev === 'panel');
ok(plan.steps.length >= 4 && plan.steps.length <= 8, `plan has ${plan.steps.length} steps`);
ok(plan.steps.filter((s) => s.is_warning).length <= 1, 'at most 1 warning step');
ok(new Set(panels.map((p) => p.d.n)).size === plan.steps.length, 'every step got a panel');
ok(panels.some((p, i) => i > 0 && p.t > panels[0].t) || panels.length === 1, 'panels arrive incrementally');
ok(evs.filter((e) => e.ev === 'critic').length === plan.steps.length, 'critic event per panel');
ok(evs.some((e) => e.ev === 'critic' && e.d.retried), 'critic retry path exercised');
ok(names.at(-1) === 'done', `done (${((Date.now() - t0) / 1000).toFixed(1)}s total)`);
ok(plan.safety_category === 'medical', 'safety category surfaced');

// reopen
const g1 = await (await fetch(`${BASE}/api/guide/${id}`)).json();
ok(g1.steps.every((s) => s.panel?.url), 'GET /api/guide/:id has panel urls');
const reopen = await events(await fetch(`${BASE}/api/guide/${id}/stream`));
ok(reopen.filter((e) => e.ev === 'panel').length === plan.steps.length, 'reopen replays stored panels');
const share = await (await fetch(`${BASE}/g/${id}`)).text();
ok(share.includes('<img') && share.includes('Download PDF') && share.includes('Visual aid only') && share.includes('og:title'), 'GET /g/:id share page renders panels, pdf button, disclaimer, og tags');
ok((await fetch(`${BASE}/g/nope-nope`)).status === 404, 'unknown /g/:id is 404');
ok((await fetch(`${BASE}/og/${id}.png`)).headers.get('content-type') === 'image/png', 'og image renders');
const dl = await (await fetch(`${BASE}/api/demos`)).json();
ok(dl.demos.length >= 3 && dl.demos.every((d) => d.steps.length >= 4), 'GET /api/demos lists stored demos');

// pdf
const pdf = Buffer.from(await (await fetch(`${BASE}/api/guide/${id}/pdf`)).arrayBuffer());
ok(pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 5000, `pdf downloads (${pdf.length} bytes)`);
(await import('node:fs')).writeFileSync(process.env.PDF_OUT || '/tmp/flatpack-test.pdf', pdf);

// fix: only affected + dependents change
const hashes = {};
for (const s of g1.steps) hashes[s.n] = h(Buffer.from(await (await fetch(BASE + s.panel.url)).arrayBuffer()));
const fixEvs = await events(await fetch(`${BASE}/api/guide/${id}/step/2/fix`, { method: 'POST', body: form({ note: 'the lid is a sliding drawer' }) }));
const fx = fixEvs.find((e) => e.ev === 'fix')?.d;
ok(!!fx, `fix diagnosed: regenerate ${JSON.stringify(fx?.regenerate)}`);
const g2 = await (await fetch(`${BASE}/api/guide/${id}`)).json();
let changed = [], same = [];
for (const s of g2.steps) {
  const nh = h(Buffer.from(await (await fetch(BASE + s.panel.url)).arrayBuffer()));
  (nh !== hashes[s.n] ? changed : same).push(s.n);
}
ok(JSON.stringify(changed) === JSON.stringify(fx.regenerate), `only affected steps changed: ${changed}`);
ok(same.length === g2.steps.length - changed.length && same.length > 0, `untouched steps byte-identical: ${same}`);
ok(fixEvs.filter((e) => e.ev === 'panel').every((e) => fx.regenerate.includes(e.d.n)), 'fix stream only carried affected panels');
r = await fetch(`${BASE}/api/guide/${id}/step/2/fix`, { method: 'POST', body: new FormData() });
ok(r.status === 400, 'fix with no photo/note rejected');

// demo replay (no api)
const demo = await events(await fetch(`${BASE}/api/guide/demo-pill/stream?pace=0`));
ok(demo.filter((e) => e.ev === 'panel').length >= 4 && demo.at(-1).ev === 'done', 'demo-pill replays from disk');
r = await fetch(`${BASE}/api/guide/demo-pill/step/1/fix`, { method: 'POST', body: form({ note: 'x' }) });
ok(r.status === 403, 'demo guides are read-only');
ok((await fetch(`${BASE}/api/guide/..%2f..%2fetc/stream`)).status !== 200, 'path traversal blocked');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
