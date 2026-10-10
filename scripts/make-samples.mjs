import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { SCENES } from './scenes.mjs';
mkdirSync('samples', { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
for (const s of SCENES) {
  await p.setContent(s.html);
  await p.screenshot({ path: `samples/${s.id}.png` });
}
writeFileSync('samples/scenes.json', JSON.stringify(SCENES.map(({ html, ...m }) => m), null, 1));
await b.close();
console.log('samples:', SCENES.length);
