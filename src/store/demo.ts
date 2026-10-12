import { db, setKv, dbChannel, getZeroLabels } from './db';
import { ACT_KEY, LABEL_KEY } from '../eval/bench';
import type { ActivityLabel, OcrWord, SessionRec } from '../types';

export interface DemoFrame { scene: string; seq: number; tMs: number; activity: ActivityLabel; activityConf: number; w: number; h: number; hasText: boolean; redactions: number; hash: string; indexMs: number; text: string; words: OcrWord[]; full: string; thumb: string; vecRow: number }
export interface DemoSession { label: string; daysAgo: number; hour: number; minute: number; frames: DemoFrame[]; skipped: { scene: string; reason: string }[] }
export interface DemoManifest { version: 1; dim: number; sessions: DemoSession[]; expected: Record<string, ActivityLabel> }

/** Import the pre-indexed demo sessions (built with the real pipeline by scripts/build-demo.mjs). Static files, same origin. */
export async function loadDemo(base = new URL('./', document.baseURI).href): Promise<{ frames: number; sessions: number }> {
  const manifest = (await (await fetch(new URL('demo/manifest.json', base))).json()) as DemoManifest;
  const vecBuf = await (await fetch(new URL('demo/vectors.bin', base))).arrayBuffer();
  const d = await db();
  const labels: Record<string, string> = {};
  let nFrames = 0;
  for (let si = 0; si < manifest.sessions.length; si++) {
    const s = manifest.sessions[si]!;
    const startedAt = new Date(Date.now() - s.daysAgo * 86_400_000).setHours(s.hour, s.minute, 0, 0);
    const id = `demo-${si + 1}`;
    const last = s.frames[s.frames.length - 1];
    const rec: SessionRec = { id, startedAt, endedAt: startedAt + (last?.tMs ?? 0) + 3000, label: s.label, demo: true, counters: { captured: s.frames.length + s.skipped.length, kept: s.frames.length, skippedDup: 0, skippedBlack: 0, skippedSensitive: s.skipped.length, dropped: 0 } };
    await d.put('sessions', rec);
    for (const f of s.frames) {
      const [full, thumb] = await Promise.all([fetch(new URL('demo/' + f.full, base)).then((r) => r.blob()), fetch(new URL('demo/' + f.thumb, base)).then((r) => r.blob())]);
      const frameId = `${id}:${f.seq}`;
      const tx = d.transaction(['frames', 'blobs', 'vectors', 'ocr'], 'readwrite');
      tx.objectStore('frames').put({ id: frameId, sessionId: id, seq: f.seq, tMs: f.tMs, wall: startedAt + f.tMs, w: f.w, h: f.h, activity: f.activity, activityConf: f.activityConf, zsActivity: f.activity, hasText: f.hasText, redactions: f.redactions, fullBytes: full.size, thumbBytes: thumb.size, indexMs: f.indexMs, hash: f.hash });
      tx.objectStore('blobs').put({ frameId, full, thumb });
      tx.objectStore('vectors').put({ frameId, vec: new Float32Array(vecBuf.slice(f.vecRow * manifest.dim * 4, (f.vecRow + 1) * manifest.dim * 4)) });
      tx.objectStore('ocr').put({ frameId, text: f.text, words: f.words });
      await tx.done;
      labels[frameId] = f.scene;
      nFrames++;
    }
  }
  // zero-shot label embeddings (same CLIP text encoder) so the trainable head works without loading the models
  if (!(await getZeroLabels())) {
    try { const r = await fetch(new URL('demo/labels.bin', base)); if (r.ok) await setKv('zs-labels', new Float32Array(await r.arrayBuffer())); } catch { /* optional */ }
  }
  await setKv(LABEL_KEY, labels);
  await setKv(ACT_KEY, manifest.expected);
  const ch = dbChannel();
  ch?.postMessage({ type: 'frames-deleted' }); // makes the search worker reload
  ch?.close();
  return { frames: nFrames, sessions: manifest.sessions.length };
}
