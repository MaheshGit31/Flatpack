import { tokenize } from '../search/bm25';
import type { ActivityLabel, FrameRec } from '../types';

export interface Block {
  id: string;
  sessionId: string;
  frames: FrameRec[];
  startWall: number;
  endWall: number;
  startMs: number;
  activity: ActivityLabel;
  keywords: string[];
  label: string;
}

export interface BlockOpts { gapMs: number; simThreshold: number; minFrames: number }
export const DEFAULT_BLOCK_OPTS: BlockOpts = { gapMs: 5 * 60_000, simThreshold: 0.8, minFrames: 1 };

function cos(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/**
 * Split a time-ordered frame list into "what I was doing" blocks: a new block starts after a long gap, or when the frame's
 * embedding drifts away from the running block centroid on two consecutive frames (hysteresis stops one stray tab flipping it).
 */
export function segmentBlocks(frames: FrameRec[], vecs: Map<string, Float32Array>, o: BlockOpts = DEFAULT_BLOCK_OPTS): FrameRec[][] {
  const sorted = [...frames].sort((a, b) => a.wall - b.wall);
  const groups: FrameRec[][] = [];
  let cur: FrameRec[] = [];
  let centroid = null as Float32Array | null;
  let n = 0;
  let strikes = 0;
  const reset = () => { centroid = null; n = 0; strikes = 0; };
  const absorb = (v: Float32Array) => {
    if (!centroid) centroid = Float32Array.from(v);
    else for (let i = 0; i < v.length; i++) centroid[i] = (centroid[i]! * n + v[i]!) / (n + 1);
    n++;
  };
  for (const f of sorted) {
    const v = vecs.get(f.id);
    const last = cur[cur.length - 1];
    if (last && (f.sessionId !== last.sessionId || f.wall - last.wall > o.gapMs)) {
      groups.push(cur); cur = []; reset();
    }
    if (v && centroid) {
      let nrm = 0;
      const c0: Float32Array = centroid;
      for (let i = 0; i < c0.length; i++) nrm += c0[i]! * c0[i]!;
      const sim = cos(v, c0) / (Math.sqrt(nrm) || 1);
      if (sim < o.simThreshold) {
        strikes++;
        if (strikes >= 2) {
          // the break started at the first strike frame: move it into the new block
          const moved = cur.splice(cur.length - 1, 1);
          if (cur.length) groups.push(cur);
          cur = moved; reset();
          const mv = vecs.get(moved[0]!.id);
          if (mv) absorb(mv);
        }
      } else {
        strikes = 0;
      }
    }
    cur.push(f);
    if (v && strikes === 0) absorb(v);
  }
  if (cur.length) groups.push(cur);
  return groups.filter((g) => g.length >= o.minFrames);
}

function dominant(frames: FrameRec[]): ActivityLabel {
  const c = new Map<ActivityLabel, number>();
  for (const f of frames) c.set(f.activity, (c.get(f.activity) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

/** Label blocks: dominant activity + the most distinctive OCR words (tf-idf across blocks). */
export function labelBlocks(groups: FrameRec[][], textOf: (id: string) => string): Block[] {
  const docs = groups.map((g) => {
    const tf = new Map<string, number>();
    for (const f of g) for (const t of tokenize(textOf(f.id))) if (t.length > 3 && !/^\d+$/.test(t) && !t.includes('█')) tf.set(t, (tf.get(t) ?? 0) + 1);
    return tf;
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  return groups.map((g, i) => {
    const scored = [...docs[i]!.entries()].map(([t, f]) => [t, f * Math.log(1 + docs.length / (df.get(t) ?? 1))] as const).sort((a, b) => b[1] - a[1]);
    const keywords = scored.slice(0, 3).map((x) => x[0]);
    const activity = dominant(g);
    return {
      id: `${g[0]!.sessionId}:${g[0]!.seq}`,
      sessionId: g[0]!.sessionId,
      frames: g,
      startWall: g[0]!.wall,
      endWall: g[g.length - 1]!.wall,
      startMs: g[0]!.tMs,
      activity,
      keywords,
      label: keywords.length ? `${activity} · ${keywords.join(', ')}` : activity,
    };
  });
}
