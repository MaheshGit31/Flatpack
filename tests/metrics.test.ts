import { describe, expect, it } from 'vitest';
import { firstRelevantRank, mrr, recallAt, median } from '../src/eval/metrics';
import { DEMO_QUERIES } from '../src/eval/queries';
import { SCENES } from '../scripts/scenes.mjs';

describe('metrics', () => {
  const ranks = [1, 3, null, 6, 2];
  it('recall@k and MRR', () => {
    expect(recallAt(ranks, 1)).toBeCloseTo(0.2);
    expect(recallAt(ranks, 5)).toBeCloseTo(0.6);
    expect(mrr(ranks)).toBeCloseTo((1 + 1 / 3 + 0 + 1 / 6 + 1 / 2) / 5);
  });
  it('first relevant rank', () => {
    expect(firstRelevantRank(['a', 'b', 'c'], new Set(['c']))).toBe(3);
    expect(firstRelevantRank(['a'], new Set(['z']))).toBeNull();
  });
  it('median', () => { expect(median([5, 1, 3])).toBe(3); expect(median([1, 2, 3, 4])).toBe(2.5); });
  it('every labeled query points at a real scene', () => {
    const ids = new Set((SCENES as { id: string }[]).map((s) => s.id));
    for (const q of DEMO_QUERIES) for (const r of q.rel) expect(ids.has(r)).toBe(true);
    expect(DEMO_QUERIES.length).toBeGreaterThanOrEqual(40);
  });
});
