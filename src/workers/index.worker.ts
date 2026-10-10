/// Index worker (phase-1 skeleton: store only; CLIP / OCR / redaction are layered in by later phases).
import { putFrameBundle } from '../store/db';
import { serve } from '../util/rpc';

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

const emit = serve(self as unknown as WorkerScope, {
  async init() {
    return { ok: true };
  },
  async process(a: ProcessArgs) {
    const t0 = performance.now();
    const { bitmap } = a;
    const w = bitmap.width;
    const h = bitmap.height;
    const canvas = new OffscreenCanvas(w, h);
    const c = canvas.getContext('2d');
    if (!c) throw new Error('no 2d context');
    c.drawImage(bitmap, 0, 0);
    bitmap.close();
    const full = await canvas.convertToBlob({ type: 'image/webp', quality: 0.7 });
    const tw = 320;
    const th = Math.round((h * tw) / w);
    const tc = new OffscreenCanvas(tw, th);
    tc.getContext('2d')?.drawImage(canvas, 0, 0, tw, th);
    const thumb = await tc.convertToBlob({ type: 'image/webp', quality: 0.7 });
    const frameId = `${a.sessionId}:${a.seq}`;
    await putFrameBundle({
      frame: { id: frameId, sessionId: a.sessionId, seq: a.seq, tMs: a.tMs, wall: a.wall, w, h, activity: 'other', activityConf: 0, hasText: false, redactions: 0, fullBytes: full.size, thumbBytes: thumb.size, indexMs: performance.now() - t0, hash: a.hash },
      blobs: { frameId, full, thumb },
      vec: { frameId, vec: new Float32Array(512) },
      ocr: { frameId, text: '', words: [] },
    });
    emit('indexed', { frameId, bytes: full.size + thumb.size });
    return { frameId };
  },
});
