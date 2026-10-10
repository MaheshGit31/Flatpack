/// Index worker. Per kept frame: OCR → redact (blur stored pixels) → CLIP on the REDACTED pixels → label → WebP → IndexedDB.
/// The un-redacted bitmap lives only in this function's scope and is never persisted.
import { getSettings, putFrameBundle } from '../store/db';
import { serve } from '../util/rpc';
import { loadClip, type ClipHandle } from '../models/clip';
import { loadOcr, type OcrHandle } from '../models/ocr';
import { matchesBlocklist, redactWords } from '../privacy/redact';
import { rgbaToGray, textLikelihood } from '../util/dhash';
import type { ModelProgress, NetEntry, OcrWord } from '../types';

interface WorkerScope {
  postMessage(m: unknown, t?: Transferable[]): void;
  addEventListener(t: 'message', fn: (e: MessageEvent) => void): void;
}

export interface ProcessArgs {
  bitmap: ImageBitmap;
  sessionId: string;
  seq: number;
  tMs: number;
  wall: number;
  hash: string;
}

let clip: ClipHandle | null = null;
let ocr: OcrHandle | null = null;
let ocrFailed = false;
let initP: Promise<unknown> | null = null;
let baseUrl = '';
let lastProgressAt = 0;

const TEXT_GATE = 0.004;
const CLIP_SIZE = 224;
const MOSAIC = 10; // px of the pixelation cell in the stored image

const emit = serve(self as unknown as WorkerScope, {
  init(a: { baseUrl: string; preferGpu?: boolean }) {
    baseUrl = a.baseUrl;
    initP ??= (async () => {
      emit('models', { state: 'loading' });
      try {
        const [c, o] = await Promise.all([
          loadClip((p: ModelProgress) => {
            const now = performance.now();
            if (now - lastProgressAt > 150 || p.pct >= 100) { lastProgressAt = now; emit('progress', p); }
          }, new URL('ort/', baseUrl).href, a.preferGpu ?? true),
          loadOcr(baseUrl).catch((e: unknown) => { ocrFailed = true; emit('models', { state: 'error', message: 'OCR unavailable: ' + (e instanceof Error ? e.message : String(e)) }); return null; }),
        ]);
        clip = c;
        ocr = o;
        emit('models', { state: 'ready', loadMs: c.loadMs, backend: c.backend });
      } catch (e) {
        initP = null;
        emit('models', { state: 'error', message: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    })();
    return initP.then(() => ({ ok: true, backend: clip?.backend, loadMs: clip?.loadMs, ocr: !!ocr }));
  },

  async embedText(a: { q: string }) {
    await initP;
    return clip!.embedText(a.q);
  },

  /** Resource timing from this worker (fetches made here are invisible to the page's observer). */
  net(): NetEntry[] {
    return (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map((e) => ({
      name: e.name, origin: new URL(e.name).origin, kind: e.initiatorType, startedAt: Math.round(performance.timeOrigin + e.startTime), bytes: e.transferSize, source: 'index-worker',
    }));
  },

  async process(a: ProcessArgs) {
    await initP;
    const t0 = performance.now();
    const settings = await getSettings();
    const { bitmap } = a;
    const w = bitmap.width;
    const h = bitmap.height;
    const canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('no 2d context');
    g.drawImage(bitmap, 0, 0);
    bitmap.close();

    // 1. OCR (only when the frame looks like it has text)
    let words: OcrWord[] = [];
    let rawText = '';
    const small = new OffscreenCanvas(256, 144).getContext('2d', { willReadFrequently: true })!;
    small.drawImage(canvas, 0, 0, 256, 144);
    const gray = rgbaToGray(small.getImageData(0, 0, 256, 144).data, 256, 144);
    const looksTexty = textLikelihood(gray, 256, 144) > TEXT_GATE;
    if (ocr && settings.ocrEnabled && looksTexty) {
      try {
        const r = await ocr.recognize(canvas);
        words = r.words;
        rawText = r.text;
      } catch {
        /* OCR failure must not lose the frame: continue with visual-only */
      }
    }

    // 2. blocklist: drop the WHOLE frame, store nothing
    const hitPhrase = matchesBlocklist(rawText, settings.blocklist);
    if (hitPhrase) return { status: 'skipped-sensitive' as const };

    // 3. redact: pixelate boxes in the pixels that will be stored
    const red = words.length ? redactWords(words) : { boxes: [], text: '', count: 0, hit: new Set<number>() };
    for (const b of red.boxes) pixelate(g, b.x * w, b.y * h, b.w * w, b.h * h);
    const storedText = words.length ? red.text : '';

    // 4. CLIP on the redacted pixels (whole frame squashed to 224², so nothing at the edges is cropped away)
    const sq = new OffscreenCanvas(CLIP_SIZE, CLIP_SIZE).getContext('2d', { willReadFrequently: true })!;
    sq.drawImage(canvas, 0, 0, CLIP_SIZE, CLIP_SIZE);
    const vec = await clip!.embedImage(sq.getImageData(0, 0, CLIP_SIZE, CLIP_SIZE).data, CLIP_SIZE, CLIP_SIZE);
    const { label, conf } = clip!.classify(vec);

    // 5. encode + store
    const full = await canvas.convertToBlob({ type: 'image/webp', quality: 0.7 });
    const tw = 320;
    const th = Math.round((h * tw) / w);
    const tc = new OffscreenCanvas(tw, th);
    tc.getContext('2d')!.drawImage(canvas, 0, 0, tw, th);
    const thumb = await tc.convertToBlob({ type: 'image/webp', quality: 0.7 });
    const frameId = `${a.sessionId}:${a.seq}`;
    const indexMs = performance.now() - t0;
    const keepWords = words.map((x, i) => (red.hit.has(i) ? { ...x, t: '█' } : x));
    await putFrameBundle({
      frame: { id: frameId, sessionId: a.sessionId, seq: a.seq, tMs: a.tMs, wall: a.wall, w, h, activity: label, activityConf: conf, hasText: storedText.trim().length > 0, redactions: red.count, fullBytes: full.size, thumbBytes: thumb.size, indexMs, hash: a.hash },
      blobs: { frameId, full, thumb },
      vec: { frameId, vec },
      ocr: { frameId, text: storedText, words: keepWords },
    });
    return { status: 'stored' as const, frameId, bytes: full.size + thumb.size, indexMs, redactions: red.count, ocrWords: words.length, activity: label };
  },
});

/** Mosaic a rectangle in place (irreversible: the source pixels are overwritten). */
function pixelate(g: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
  w = Math.ceil(w); h = Math.ceil(h);
  if (w < 2 || h < 2) return;
  const cw = Math.max(1, Math.round(w / MOSAIC));
  const ch = Math.max(1, Math.round(h / MOSAIC));
  const tmp = new OffscreenCanvas(cw, ch);
  const t = tmp.getContext('2d')!;
  t.drawImage(g.canvas, x, y, w, h, 0, 0, cw, ch);
  g.save();
  g.imageSmoothingEnabled = false;
  g.drawImage(tmp, 0, 0, cw, ch, x, y, w, h);
  g.restore();
  // second pass: flatten to the mean colour so even a 1-cell mosaic of a big glyph can't be read
  const d = g.getImageData(x, y, w, h);
  let r = 0, gg = 0, b = 0;
  const n = d.data.length / 4;
  for (let i = 0; i < d.data.length; i += 4) { r += d.data[i]!; gg += d.data[i + 1]!; b += d.data[i + 2]!; }
  g.fillStyle = `rgba(${Math.round(r / n)},${Math.round(gg / n)},${Math.round(b / n)},0.85)`;
  g.fillRect(x, y, w, h);
}

