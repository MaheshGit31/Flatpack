import { createWorker, type Worker as TessWorker } from 'tesseract.js';
import type { OcrWord } from '../types';

export interface OcrHandle {
  recognize(canvas: OffscreenCanvas): Promise<{ text: string; words: OcrWord[] }>;
  terminate(): Promise<void>;
}

/** Tesseract.js with every asset served from our own origin (no CDN). */
export async function loadOcr(baseUrl: string): Promise<OcrHandle> {
  const dir = new URL('tesseract/', baseUrl).href;
  const worker: TessWorker = await createWorker('eng', 1, {
    workerPath: dir + 'worker.min.js',
    corePath: dir,
    langPath: dir,
    gzip: true,
    cacheMethod: 'none',
    workerBlobURL: false,
    logger: () => undefined, // never log content
  });
  // v7 defaults to a single-block mode that reads a whole screen as one paragraph and drops most of it; auto layout analysis (3) is what we want
  await worker.setParameters({ tessedit_pageseg_mode: '3' as never });
  return {
    async recognize(canvas) {
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const { data } = await worker.recognize(blob, {}, { blocks: true });
      const W = canvas.width;
      const H = canvas.height;
      const words: OcrWord[] = [];
      for (const b of data.blocks ?? [])
        for (const p of b.paragraphs)
          for (const l of p.lines)
            for (const w of l.words) {
              const t = w.text.trim();
              if (!t || w.confidence < 30) continue;
              words.push({ t, x: w.bbox.x0 / W, y: w.bbox.y0 / H, w: (w.bbox.x1 - w.bbox.x0) / W, h: (w.bbox.y1 - w.bbox.y0) / H, c: w.confidence });
            }
      return { text: data.text ?? '', words };
    },
    terminate: async () => { await worker.terminate(); },
  };
}
