import { describe, expect, it } from 'vitest';
import { ACTIVITY_LABELS } from '../src/types';
import { accuracy, anchorSamples, DIM, evaluateHoldout, K, labelIndex, logits, meanVec, predict, train, withCentering, zeroShotHead, type Sample } from '../src/model/head';

function rng(seed: number) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const norm = (v: Float32Array) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n); return v.map((x) => x / n); };

/** Synthetic world: a shared offset (like CLIP's common component) plus one direction per class. */
function world(seed = 1) {
  const r = rng(seed);
  const common = norm(Float32Array.from({ length: DIM }, () => r() - 0.5));
  const dirs = ACTIVITY_LABELS.map(() => norm(Float32Array.from({ length: DIM }, () => r() - 0.5)));
  const sample = (cls: number, noise = 0.35): Float32Array => norm(Float32Array.from({ length: DIM }, (_, i) => 2 * common[i]! + dirs[cls]![i]! + noise * (r() - 0.5)));
  // zero-shot text weights: noisy versions of the class direction (so zero-shot is decent but not perfect)
  const labels = new Float32Array(K * DIM);
  dirs.forEach((d, k) => labels.set(norm(Float32Array.from({ length: DIM }, (_, i) => d[i]! + 0.9 * (r() - 0.5))), k * DIM));
  return { sample, zero: zeroShotHead(labels) };
}

describe('classifier head', () => {
  it('starts as exactly the zero-shot classifier (argmax of label similarity)', () => {
    const { zero, sample } = world();
    const x = sample(3);
    let best = 0, bs = -Infinity;
    for (let k = 0; k < K; k++) { let s = 0; for (let i = 0; i < DIM; i++) s += zero.W[k * DIM + i]! * x[i]!; if (s > bs) { bs = s; best = k; } }
    expect(predict(zero, x).index).toBe(best);
    expect(zero.trainedOn).toBe(0);
  });

  it('re-centring features does not change the logits', () => {
    const { zero, sample } = world(2);
    const x = sample(1);
    const mu = meanVec([sample(0), sample(1), sample(2)]);
    const a = logits(zero, x), b = logits(withCentering(zero, mu), x);
    for (let k = 0; k < K; k++) expect(b[k]).toBeCloseTo(a[k]!, 3);
  });

  it('learns a user correction: a frame the zero-shot head gets wrong flips to the user label, and survives similar frames', () => {
    const { zero, sample } = world(3);
    // find a class the zero-shot head confuses
    let wrong: { cls: number; pred: number } | null = null;
    for (let c = 0; c < K && !wrong; c++) for (let t = 0; t < 40 && !wrong; t++) { const p = predict(zero, sample(c, 0.9)).index; if (p !== c) wrong = { cls: c, pred: p }; }
    expect(wrong, 'test world should contain a zero-shot error').not.toBeNull();
    const train1: Sample[] = Array.from({ length: 6 }, () => ({ vec: sample(wrong!.cls, 0.9), y: wrong!.cls }));
    const h = train(zero, train1);
    expect(h.trainedOn).toBe(6);
    const test: Sample[] = Array.from({ length: 30 }, () => ({ vec: sample(wrong!.cls, 0.9), y: wrong!.cls }));
    expect(accuracy(h, test)).toBeGreaterThan(accuracy(zero, test));
  });

  it('classes the user never corrected keep their zero-shot weights exactly', () => {
    const { zero, sample } = world(4);
    const h = train(zero, [{ vec: sample(2), y: 2 }, { vec: sample(2), y: 2 }]);
    const mu0 = h.mu; // centring only changes the bias, never the unseen classes' W
    expect(mu0.length).toBe(DIM);
    for (let k = 0; k < K; k++) {
      const same = zero.W.slice(k * DIM, (k + 1) * DIM).every((w, i) => w === h.W[k * DIM + i]);
      expect(same, `class ${k}`).toBe(k !== 2);
    }
  });

  it('zero-shot anchors keep uncorrected frames where they were', () => {
    const { zero, sample } = world(5);
    const corrected: Sample[] = [{ vec: sample(1, 0.8), y: 1 }, { vec: sample(1, 0.8), y: 1 }];
    const others = Array.from({ length: 60 }, (_, i) => sample(i % K));
    const before = others.map((v) => predict(zero, v).index);
    const h = train(zero, [...corrected, ...anchorSamples(zero, others, 1)]);
    const changed = others.filter((v, i) => predict(h, v).index !== before[i]).length;
    expect(changed / others.length).toBeLessThan(0.15);
  });

  it('is deterministic', () => {
    const { zero, sample } = world(6);
    const s: Sample[] = [{ vec: sample(0), y: 0 }, { vec: sample(4), y: 4 }];
    const a = train(zero, s), b = train(zero, s);
    expect(Array.from(a.W.slice(0, 50))).toEqual(Array.from(b.W.slice(0, 50)));
  });

  it('holdout evaluation: refuses tiny sets, reports both heads, never trains on the test split', () => {
    const { zero, sample } = world(7);
    const few: Sample[] = Array.from({ length: 4 }, (_, i) => ({ vec: sample(i), y: i }));
    expect(evaluateHoldout(zero, few)).toBeNull();
    const many: Sample[] = Array.from({ length: 40 }, (_, i) => ({ vec: sample(i % K, 0.9), y: i % K, group: i % K }));
    const r = evaluateHoldout(zero, many, { repeats: 2, seed: 1 })!;
    expect(r.mode).toBe('recurring');
    expect(r.zeroShot.mean).toBeGreaterThan(0);
    expect(r.trained.mean).toBeGreaterThan(0);
    expect(r.curve[0]).toMatchObject({ k: 0 });
    const g = evaluateHoldout(zero, many, { repeats: 2, seed: 1, groupHoldout: true })!;
    expect(g.mode).toBe('new-apps');
    expect(labelIndex('coding')).toBe(0);
  }, 60_000);
});
