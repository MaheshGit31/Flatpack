import { createSession, updateSession } from '../store/db';
import { indexClient } from '../workers/client';
import { boxResize, dhash, rgbaToGray } from '../util/dhash';
import type { SessionRec } from '../types';

export async function hashBitmap(bm: ImageBitmap): Promise<string> {
  const c = new OffscreenCanvas(64, 36);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bm, 0, 0, 64, 36);
  const gray = rgbaToGray(g.getImageData(0, 0, 64, 36).data, 64, 36);
  return dhash(boxResize(gray, 64, 36, 9, 8), 9, 8);
}

export interface ImportItem { name: string; blob: Blob }

/** Run image files through the exact same pipeline as live capture (OCR → redact → CLIP → store). */
export async function importImages(items: ImportItem[], opts: { label?: string; startedAt?: number; gapMs?: number; demo?: boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<{ session: SessionRec; stored: number; skipped: number }> {
  const startedAt = opts.startedAt ?? Date.now();
  const gap = opts.gapMs ?? 3000;
  const session = await createSession(opts.label ?? `Imported ${new Date(startedAt).toLocaleString()}`, startedAt, opts.demo);
  const idx = indexClient();
  await idx.start();
  let stored = 0;
  let skipped = 0;
  for (let i = 0; i < items.length; i++) {
    const bm = await createImageBitmap(items[i]!.blob);
    const scale = Math.min(1, 1280 / bm.width);
    const sized = scale < 1 ? await createImageBitmap(bm, { resizeWidth: Math.round(bm.width * scale), resizeHeight: Math.round(bm.height * scale), resizeQuality: 'high' }) : bm;
    if (sized !== bm) bm.close();
    const hash = await hashBitmap(sized);
    const tMs = i * gap;
    const r = await idx.process({ bitmap: sized, sessionId: session.id, seq: i, tMs, wall: startedAt + tMs, hash });
    if (r.status === 'stored') stored++; else skipped++;
    opts.onProgress?.(i + 1, items.length);
  }
  await updateSession(session.id, { endedAt: startedAt + items.length * gap, counters: { captured: items.length, kept: stored, skippedDup: 0, skippedBlack: 0, skippedSensitive: skipped, dropped: 0 } });
  return { session, stored, skipped };
}
