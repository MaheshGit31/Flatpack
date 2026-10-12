// Builds public/demo/pack.bin + pack.json: a labelled set of CLIP embeddings (14 synthetic apps x 5 appearances) produced by the REAL pipeline.
// The Benchmark page uses it to compare the zero-shot labels with the trained head. It is read-only: nothing from it is written to the user's database.
// Usage: npm run build && npx vite preview --port 4173 &   then   node scripts/build-pack.mjs
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { SCENES, VARIANTS } from './scenes.mjs';
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, proxy, args: ['--ignore-certificate-errors'] });
const shots = await b.newPage({ viewport: { width: 1280, height: 720 } });
const app = await b.newPage();
await app.goto(process.env.APP_URL || 'http://localhost:4173/#/app/record');
await app.evaluate(() => window.__flatpak.indexClient().start());
const meta = [];
const vecs = [];
for (const [gi, s] of SCENES.entries()) {
  for (const v of VARIANTS) {
    await shots.setContent(s.html.replace('</style>', v.css + '</style>'));
    const png = (await shots.screenshot()).toString('base64');
    const r = await app.evaluate(async ({ png, name }) => {
      const f = window.__flatpak;
      const blob = new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: 'image/png' });
      const res = await f.importImages([{ name, blob }], { label: name, gapMs: 60000 });
      if (!res.stored) return null;
      const frames = await f.store.listFrames(res.session.id);
      const vs = await f.store.allVectors();
      const fr = frames[0];
      return { vec: Array.from(vs.find((x) => x.frameId === fr.id).vec), zs: fr.zsActivity ?? fr.activity };
    }, { png, name: `${s.id}-${v.id}` });
    if (!r) { console.log('dropped by privacy rules:', s.id, v.id); continue; }
    vecs.push(...r.vec);
    meta.push({ scene: s.id, variant: v.id, label: s.activity, group: gi, zeroShot: r.zs });
  }
}
writeFileSync('public/demo/pack.bin', Buffer.from(new Float32Array(vecs).buffer));
writeFileSync('public/demo/pack.json', JSON.stringify({ dim: 512, items: meta }));
const acc = meta.filter((m) => m.zeroShot === m.label).length / meta.length;
console.log('pack:', meta.length, 'frames; zero-shot label accuracy', (acc * 100).toFixed(1) + '%');
await b.close();
