import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** After the build: write dist/precache.json (what "Prepare for offline" fetches) and stamp dist/sw.js with a build id. */
function offlineManifest() {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  return {
    name: 'flatpak-offline-manifest',
    apply: 'build' as const,
    closeBundle() {
      const dist = 'dist';
      const files = walk(dist).map((f) => relative(dist, f).split('\\').join('/'));
      // the big runtime files are fetched (and cached) the first time the models load; everything else is precached explicitly
      const skip = /^(sw\.js|precache\.json)$|^ort\/|^assets\/ort-wasm|^tesseract\/(?!eng\.traineddata\.gz)|^samples\//;
      const urls = files.filter((f) => !skip.test(f)).map((f) => (f === 'index.html' ? './' : './' + f));
      const id = createHash('sha1').update(urls.join('|') + files.map((f) => statSync(join(dist, f)).size).join(',')).digest('hex').slice(0, 10);
      writeFileSync(join(dist, 'precache.json'), JSON.stringify({ build: id, urls }));
      const sw = readFileSync(join(dist, 'sw.js'), 'utf8').replace('__BUILD_ID__', id);
      writeFileSync(join(dist, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), offlineManifest()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers', 'onnxruntime-web'] },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 4000 },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true, allowedHosts: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
