// Downloads a short public-domain speech clip (JFK, 11 s) used by the audio e2e test. Not shipped in the app.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('test-assets', { recursive: true });
if (!existsSync('test-assets/jfk.wav')) {
  const r = await fetch('https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav');
  if (!r.ok) throw new Error('download failed: ' + r.status);
  writeFileSync('test-assets/jfk.wav', Buffer.from(await r.arrayBuffer()));
}
console.log('test-assets/jfk.wav ready');
