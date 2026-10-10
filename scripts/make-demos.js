// Generates 3 stored demo guides from photos in /demo-inputs. Demo mode then replays them with ZERO API calls.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../src/config.js';
import { isMock } from '../src/gemini.js';
import { prepPhoto } from '../src/image.js';
import { ensureCharacter } from '../src/character.js';
import { createGuide, save } from '../src/store.js';
import { runGuide } from '../src/pipeline.js';

const DEMOS = [
  { key: 'pill', input: 'pill-schedule', hint: 'weekly pill schedule medication, how do I take these', title: 'Taking a weekly pill schedule' },
  { key: 'gadget', input: 'boxed-gadget', hint: 'boxed gadget, how do I set it up', title: 'Setting up a boxed gadget' },
  { key: 'form', input: 'paper-form', hint: 'paper form, how do I fill it in', title: 'Filling in a paper form' },
];

function findInput(name) {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const f = path.join(config.dirs.demoInputs, `${name}.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

await ensureCharacter();
fs.mkdirSync(config.dirs.demos, { recursive: true });
let made = 0;
for (const d of DEMOS) {
  let f = findInput(d.input);
  if (!f && isMock) { // placeholder input so mock demos work out of the box
    f = path.join(config.dirs.demoInputs, `${d.input}.png`);
    await sharp({ create: { width: 800, height: 800, channels: 3, background: '#eee' } }).png().toFile(f);
  }
  if (!f) { console.warn(`skip ${d.key}: drop ${d.input}.jpg into demo-inputs/`); continue; }
  const dir = path.join(config.dirs.demos, d.key);
  fs.rmSync(dir, { recursive: true, force: true });
  const guide = createGuide({ id: `demo-${d.key}`, hint: d.hint, photo: await prepPhoto(fs.readFileSync(f)) });
  console.log(`making demo ${d.key}...`);
  await runGuide(guide, (ev, data) => { if (ev === 'status' || ev === 'error') console.log('  ', ev, data.message || ''); if (ev === 'critic') console.log('   critic', data.n, data.passed, data.retried); });
  guide.title = d.title;
  save(guide);
  console.log(`  -> ${guide.status}`);
  made++;
}
console.log(`done, ${made} demo(s) in data/demos/`);
