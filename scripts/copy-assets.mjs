// Copies the runtime wasm/worker files we serve ourselves (so nothing is fetched from a CDN at runtime).
// Runs before dev/build. Safe to run repeatedly.
import { cpSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => resolve(root, 'node_modules', p);

// onnxruntime-web runtime (the transformers.js web build loads these from env.backends.onnx.wasm.wasmPaths)
const ortSrc = nm('onnxruntime-web/dist');
const ortDst = resolve(root, 'public/ort');
mkdirSync(ortDst, { recursive: true });
let n = 0;
if (existsSync(ortSrc)) {
  for (const f of readdirSync(ortSrc)) {
    if (/^ort-wasm-simd-threaded.*\.(wasm|mjs)$/.test(f)) { cpSync(resolve(ortSrc, f), resolve(ortDst, f)); n++; }
  }
}

// tesseract.js worker + wasm cores (lstm only). traineddata is committed under public/tesseract.
const tessDst = resolve(root, 'public/tesseract');
mkdirSync(tessDst, { recursive: true });
const tw = nm('tesseract.js/dist/worker.min.js');
if (existsSync(tw)) { cpSync(tw, resolve(tessDst, 'worker.min.js')); n++; }
const core = nm('tesseract.js-core');
if (existsSync(core)) {
  for (const f of readdirSync(core)) {
    if (/lstm\.(wasm\.js|js)$/.test(f)) { cpSync(resolve(core, f), resolve(tessDst, f)); n++; }
  }
}
console.log(`[copy-assets] copied ${n} files`);
