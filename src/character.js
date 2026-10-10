import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { CHARACTER_PROMPT } from './style.js';
import { generateImage, isMock, text } from './gemini.js';
import * as mock from './mock.js';

const file = path.join(config.dirs.assets, 'character.png');
const marker = path.join(config.dirs.assets, 'character.mock');

let cached = null;

export async function generateCharacter() {
  fs.mkdirSync(config.dirs.assets, { recursive: true });
  const out = isMock ? await mock.character() : await generateImage({ parts: [text(CHARACTER_PROMPT)], meta: {} });
  fs.writeFileSync(file, out.data);
  if (isMock) fs.writeFileSync(marker, 'placeholder');
  else fs.rmSync(marker, { force: true });
  cached = null;
  return file;
}

/** Generate once on first boot, reuse forever. A mock placeholder is replaced once a real key exists. */
export async function ensureCharacter() {
  const exists = fs.existsSync(file);
  const isPlaceholder = fs.existsSync(marker);
  if (!exists || (isPlaceholder && !isMock)) {
    console.log('[character] generating reference figure...');
    await generateCharacter();
  }
  cached = fs.readFileSync(file);
  return cached;
}

export async function getCharacter() {
  return cached ?? ensureCharacter();
}
