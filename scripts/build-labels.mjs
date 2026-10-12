// Writes public/demo/labels.bin: the zero-shot label embeddings (10 x 512 float32, ACTIVITY_LABELS order) from the real CLIP text encoder.
// Run against a served build:  npm run build && npx vite preview --port 4173 &  then  node scripts/build-labels.mjs
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, proxy, args: ['--ignore-certificate-errors'] });
const p = await b.newPage();
await p.goto(process.env.APP_URL || 'http://localhost:4173/#/app/record');
const arr = await p.evaluate(async () => {
  const f = window.__flatpak;
  await f.indexClient().start();
  return Array.from(await f.indexClient().call('zsLabels'));
});
writeFileSync('public/demo/labels.bin', Buffer.from(new Float32Array(arr).buffer));
console.log('wrote public/demo/labels.bin', arr.length, 'floats');
await b.close();
