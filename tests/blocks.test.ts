import { describe, expect, it } from 'vitest';
import { segmentBlocks, labelBlocks } from '../src/timeline/blocks';
import type { FrameRec } from '../src/types';

const unit = (i: number): Float32Array => { const v = new Float32Array(8); v[i] = 1; return v; };
const near = (i: number, e = 0.05): Float32Array => { const v = unit(i); v[(i + 1) % 8] = e; return v; };
let seq = 0;
const F = (wall: number, act: FrameRec['activity'] = 'coding', sid = 's'): FrameRec => ({ id: `${sid}:${seq}`, sessionId: sid, seq: seq++, tMs: wall, wall, w: 1, h: 1, activity: act, activityConf: 1, hasText: true, redactions: 0, fullBytes: 1, thumbBytes: 1, indexMs: 1, hash: '0' });

describe('timeline blocks', () => {
  it('splits on time gaps', () => {
    const a = [F(0), F(3000), F(6000), F(10 * 60_000), F(10 * 60_000 + 3000)];
    const vecs = new Map(a.map((f) => [f.id, near(0)]));
    expect(segmentBlocks(a, vecs).map((g) => g.length)).toEqual([3, 2]);
  });
  it('splits on embedding drift but ignores a single stray frame', () => {
    const a = [F(0), F(3000), F(6000), F(9000), F(12000), F(15000), F(18000), F(21000)];
    const v = [near(0), near(0), near(0), near(0), unit(5), unit(5), unit(5), unit(5)];
    const vecs = new Map(a.map((f, i) => [f.id, v[i]!]));
    expect(segmentBlocks(a, vecs).map((g) => g.length)).toEqual([4, 4]);
    const b = [F(100_000), F(103_000), F(106_000), F(109_000)];
    const bv = [near(0), unit(5), near(0), near(0)];
    expect(segmentBlocks(b, new Map(b.map((f, i) => [f.id, bv[i]!]))).map((g) => g.length)).toEqual([4]);
  });
  it('splits on session change', () => {
    const a = [F(0, 'coding', 'x'), F(1000, 'coding', 'y')];
    expect(segmentBlocks(a, new Map(a.map((f) => [f.id, near(0)])))).toHaveLength(2);
  });
  it('labels with dominant activity and distinctive keywords', () => {
    const g1 = [F(0, 'coding'), F(1, 'coding'), F(2, 'video')];
    const g2 = [F(3, 'shopping')];
    const text: Record<string, string> = { [g1[0]!.id]: 'invoice calculator invoice', [g1[1]!.id]: 'invoice total', [g2[0]!.id]: 'headphones cart checkout' };
    const out = labelBlocks([g1, g2], (id) => text[id] ?? '');
    expect(out[0]!.activity).toBe('coding');
    expect(out[0]!.keywords[0]).toBe('invoice');
    expect(out[1]!.label.startsWith('shopping')).toBe(true);
  });
});
