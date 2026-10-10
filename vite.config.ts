import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers', 'onnxruntime-web'] },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 4000 },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
