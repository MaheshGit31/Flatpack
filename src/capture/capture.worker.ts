/// Capture worker: reads the screen track off the main thread (so a hidden / backgrounded tab does not
/// throttle sampling), samples one frame per interval, dedupes with dHash + a coarse grid, and hands only the
/// frames worth keeping to the indexer.
import { dhash, gridChange, gridSignature, hamming, isBlackFrame, rgbaToGray } from '../util/dhash';
import type { CaptureIn, CaptureOut, CaptureStats } from './protocol';

interface WorkerScope {
  postMessage(m: unknown, t?: Transferable[]): void;
  onmessage: ((e: MessageEvent<CaptureIn>) => void) | null;
}
const ctx = self as unknown as WorkerScope;
const send = (m: CaptureOut, t?: Transferable[]) => ctx.postMessage(m, t ?? []);

let intervalMs = 3000;
let dedupeThreshold = 6;
let gridThreshold = 0.06;
let startWall = Date.now();
let maxWidth = 1280;
let paused = false;
let stopped = false;
let seq = 0;
let lastSample = 0;
let lastKeptHash: string | null = null;
let lastKeptGrid: Float32Array | null = null;
const stats: CaptureStats = { captured: 0, candidates: 0, skippedDup: 0, skippedBlack: 0, maxGapMs: 0 };

const HASH_W = 64;
const HASH_H = 36;
let small: OffscreenCanvas | null = null;

function postStats() {
  send({ type: 'stats', stats: { ...stats } });
}

async function handleSource(src: VideoFrame | ImageBitmap, w: number, h: number): Promise<void> {
  const scale = Math.min(1, maxWidth / w);
  const rw = Math.max(1, Math.round(w * scale));
  const rh = Math.max(1, Math.round(h * scale));
  const bmp = await createImageBitmap(src, { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'high' });
  small ??= new OffscreenCanvas(HASH_W, HASH_H);
  const c2d = small.getContext('2d', { willReadFrequently: true });
  if (!c2d) {
    bmp.close();
    return;
  }
  c2d.drawImage(bmp, 0, 0, HASH_W, HASH_H);
  const rgba = c2d.getImageData(0, 0, HASH_W, HASH_H).data;
  const gray = rgbaToGray(rgba, HASH_W, HASH_H);

  stats.captured++;
  if (isBlackFrame(gray)) {
    stats.skippedBlack++;
    bmp.close();
    postStats();
    return;
  }
  const hash = dhash(gray, HASH_W, HASH_H);
  const grid = gridSignature(gray, HASH_W, HASH_H);
  if (lastKeptHash !== null && lastKeptGrid !== null) {
    const dist = hamming(hash, lastKeptHash);
    const change = gridChange(grid, lastKeptGrid);
    if (dist < dedupeThreshold && change < gridThreshold) {
      stats.skippedDup++;
      bmp.close();
      postStats();
      return;
    }
  }
  lastKeptHash = hash;
  lastKeptGrid = grid;
  stats.candidates++;
  const wall = Date.now();
  send({ type: 'frame', bitmap: bmp, seq: seq++, tMs: wall - startWall, wall, hash }, [bmp]);
  postStats();
}

async function runProcessor(readable: ReadableStream<VideoFrame>): Promise<void> {
  send({ type: 'mode', mode: 'processor' });
  const reader = readable.getReader();
  try {
    for (;;) {
      const { value: frame, done } = await reader.read();
      if (done || stopped) break;
      if (!frame) continue;
      const now = performance.now();
      try {
        if (paused || now - lastSample < intervalMs) continue;
        if (lastSample > 0) stats.maxGapMs = Math.max(stats.maxGapMs, now - lastSample);
        lastSample = now;
        await handleSource(frame, frame.displayWidth, frame.displayHeight);
      } finally {
        frame.close();
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    send({ type: 'ended' });
  }
}

ctx.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'start':
      ({ intervalMs, dedupeThreshold, gridThreshold, startWall, maxWidth } = m);
      runProcessor(m.readable).catch((err: unknown) => send({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
      break;
    case 'init-fallback':
      ({ intervalMs, dedupeThreshold, gridThreshold, startWall, maxWidth } = m);
      send({ type: 'mode', mode: 'fallback' });
      break;
    case 'bitmap': {
      const b = m.bitmap;
      if (paused || stopped) {
        b.close();
        break;
      }
      handleSource(b, b.width, b.height)
        .catch((err: unknown) => send({ type: 'error', message: err instanceof Error ? err.message : String(err) }))
        .finally(() => b.close());
      break;
    }
    case 'settings':
      if (m.intervalMs !== undefined) intervalMs = m.intervalMs;
      if (m.dedupeThreshold !== undefined) dedupeThreshold = m.dedupeThreshold;
      if (m.gridThreshold !== undefined) gridThreshold = m.gridThreshold;
      break;
    case 'pause':
      paused = true;
      break;
    case 'resume':
      paused = false;
      lastSample = 0;
      break;
    case 'stop':
      stopped = true;
      send({ type: 'ended' });
      break;
  }
};
