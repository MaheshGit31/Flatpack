/// A small trainable classifier head on top of CLIP image embeddings: multinomial logistic regression (softmax regression).
///   logits_k = SCALE * <W_k, x> + b_k      (x is the L2-normalised 512-d image embedding)
/// It starts as EXACTLY the zero-shot classifier (W_k = the CLIP text embedding of label k, b = 0, SCALE = CLIP's logit scale),
/// then is trained with Adam on the user's corrected labels. An L2 penalty pulls W back toward the zero-shot weights, so a handful
/// of corrections nudges the model instead of wrecking classes the user never touched. Pure TypeScript: runs in a worker, unit-tested in node.
import { ACTIVITY_LABELS, type ActivityLabel } from '../types';

export const SCALE = 100;
export const DIM = 512;
export const K = ACTIVITY_LABELS.length;

export interface Head {
  W: Float32Array; // K*DIM, row-major
  b: Float32Array; // K
  /** feature centring vector: CLIP image embeddings share a big common component, so the head works on x - mu (b absorbs W·mu, so the zero-shot behaviour is unchanged) */
  mu: Float32Array;
  /** how many labelled frames this head was trained on (0 = still the zero-shot classifier) */
  trainedOn: number;
  trainedAt: number | null;
  loss: number | null;
}
export interface Sample { vec: Float32Array; y: number; /** soft target (probabilities) instead of the hard label y: used for unlabeled anchor frames */ soft?: Float32Array; /** sample weight, default 1 */ w?: number; /** optional app/scene id: with groupHoldout, a whole group is held out together */ group?: number }
export interface TrainOpts { epochs: number; lr: number; lambda: number; seed?: number }
export const DEFAULT_ANCHOR = 1;
export const DEFAULT_TRAIN: TrainOpts = { epochs: 150, lr: 2, lambda: 0.003 };

export function zeroShotHead(labelVecs: Float32Array): Head {
  if (labelVecs.length !== K * DIM) throw new Error(`expected ${K}x${DIM} label vectors`);
  return { W: Float32Array.from(labelVecs), b: new Float32Array(K), mu: new Float32Array(DIM), trainedOn: 0, trainedAt: null, loss: null };
}
export const cloneHead = (h: Head): Head => ({ ...h, W: Float32Array.from(h.W), b: Float32Array.from(h.b), mu: Float32Array.from(h.mu) });

export function meanVec(xs: Float32Array[]): Float32Array {
  const m = new Float32Array(DIM);
  for (const x of xs) for (let i = 0; i < DIM; i++) m[i]! += x[i]! / xs.length;
  return m;
}
/** Same classifier, re-expressed on centred features: logits_k = SCALE*W_k·(x - mu) + b_k with b_k = SCALE*W_k·mu + b_k(old). Identical outputs. */
export function withCentering(h: Head, mu: Float32Array): Head {
  const o = cloneHead(h);
  for (let k = 0; k < K; k++) {
    let d = 0;
    for (let i = 0; i < DIM; i++) d += o.W[k * DIM + i]! * (mu[i]! - h.mu[i]!);
    o.b[k]! += SCALE * d;
  }
  o.mu = Float32Array.from(mu);
  return o;
}

export function logits(h: Head, x: Float32Array): Float32Array {
  const z = new Float32Array(K);
  for (let k = 0; k < K; k++) {
    let s = 0;
    const o = k * DIM;
    for (let i = 0; i < DIM; i++) s += h.W[o + i]! * (x[i]! - h.mu[i]!);
    z[k] = SCALE * s + h.b[k]!;
  }
  return z;
}
export function softmax(z: Float32Array): Float32Array {
  let mx = -Infinity;
  for (const v of z) if (v > mx) mx = v;
  const p = new Float32Array(z.length);
  let sum = 0;
  for (let i = 0; i < z.length; i++) { p[i] = Math.exp(z[i]! - mx); sum += p[i]!; }
  for (let i = 0; i < p.length; i++) p[i]! /= sum;
  return p;
}
export function predict(h: Head, x: Float32Array): { label: ActivityLabel; conf: number; index: number } {
  const p = softmax(logits(h, x));
  let bi = 0;
  for (let i = 1; i < p.length; i++) if (p[i]! > p[bi]!) bi = i;
  return { label: ACTIVITY_LABELS[bi]!, conf: p[bi]!, index: bi };
}
export const labelIndex = (l: ActivityLabel): number => ACTIVITY_LABELS.indexOf(l);

/** Full-batch gradient descent on cross-entropy with weight decay toward the zero-shot weights W0. Deterministic.
 *  - Features are centred first (see Head.mu); `mu` defaults to the mean of the training vectors.
 *  - `lr` is a step size in LOGIT units (the W update is lr/SCALE * d * x~), so it does not depend on the embedding scale.
 *  - Plain GD, not Adam, on purpose: Adam moves every weight by ~lr whatever the gradient, which drags classes the user never
 *    corrected away from their zero-shot weights. With GD a class only moves when it carries loss. */
export function train(init: Head, samples: Sample[], opts: Partial<TrainOpts> & { mu?: Float32Array } = {}): Head {
  const o = { ...DEFAULT_TRAIN, ...opts };
  if (!samples.length) return cloneHead(init);
  const h = withCentering(init, opts.mu ?? meanVec(samples.map((s) => s.vec)));
  const W0 = Float32Array.from(h.W);
  // classes the user has never corrected keep their zero-shot weights: only classes with a real label are allowed to move
  const seen = new Set(samples.filter((x) => !x.soft).map((x) => x.y));
  const wsum = samples.reduce((a, s) => a + (s.w ?? 1), 0);
  const n = samples.length;
  const xs = samples.map((s) => { const c = new Float32Array(DIM); for (let i = 0; i < DIM; i++) c[i] = s.vec[i]! - h.mu[i]!; return c; });
  let loss = 0;
  for (let t = 1; t <= o.epochs; t++) {
    const gW = new Float32Array(K * DIM);
    const gB = new Float32Array(K);
    loss = 0;
    for (let si = 0; si < n; si++) {
      const s = samples[si]!, x = xs[si]!;
      const p = softmax(logits(h, s.vec));
      const w = s.w ?? 1;
      for (let k = 0; k < K; k++) { const tk = s.soft ? s.soft[k]! : k === s.y ? 1 : 0; if (tk > 0) loss -= (w * tk * Math.log(Math.max(p[k]!, 1e-12))) / wsum; }
      for (let k = 0; k < K; k++) {
        const tk = s.soft ? s.soft[k]! : k === s.y ? 1 : 0;
        const d = (w * (p[k]! - tk)) / wsum; // dL/dlogit_k
        gB[k]! += d;
        const off = k * DIM;
        for (let i = 0; i < DIM; i++) gW[off + i]! += d * x[i]!;
      }
    }
    let reg = 0;
    for (let i = 0; i < gW.length; i++) {
      if (!seen.has(Math.floor(i / DIM))) continue;
      const dw = h.W[i]! - W0[i]!;
      reg += dw * dw;
      h.W[i]! -= (o.lr / SCALE) * gW[i]! + o.lr * o.lambda * dw;
    }
    loss += 0.5 * o.lambda * reg * SCALE * SCALE;
    for (const k of seen) h.b[k]! -= o.lr * 0.1 * gB[k]!;
  }
  h.trainedOn = n;
  h.trainedAt = Date.now();
  h.loss = loss;
  return h;
}

/** Unlabeled frames as soft anchors: their zero-shot probabilities, so training can only move them where a correction says so. */
export function anchorSamples(zero: Head, vecs: Float32Array[], w: number): Sample[] {
  return vecs.map((vec) => { const soft = softmax(logits(zero, vec)); let y = 0; for (let k = 1; k < K; k++) if (soft[k]! > soft[y]!) y = k; return { vec, y, soft, w }; });
}

export const accuracy = (h: Head, xs: Sample[]): number => (xs.length ? xs.filter((s) => predict(h, s.vec).index === s.y).length / xs.length : NaN);

// ---------- evaluation on a labelled holdout ----------
export interface EvalResult {
  /** 'recurring': random split, the same apps appear in train and test. 'new-apps': whole groups are held out, so the test apps were never seen in training. */
  mode: 'recurring' | 'new-apps';
  labelled: number;
  classes: number;
  repeats: number;
  holdoutFraction: number;
  zeroShot: { mean: number; min: number; max: number };
  trained: { mean: number; min: number; max: number };
  /** held-out accuracy as a function of how many labelled frames the head was trained on (k = 0 is zero-shot) */
  curve: { k: number; mean: number; n: number }[];
}

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const summarize = (xs: number[]) => ({ mean: xs.reduce((a, b) => a + b, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs) });

/** Repeated random holdout over the user's labelled frames. Zero-shot is the untouched initial head; "trained" is that head after training on the train split only. */
export function evaluateHoldout(zero: Head, labelled: Sample[], opts: { repeats?: number; holdoutFraction?: number; train?: Partial<TrainOpts>; seed?: number; groupHoldout?: boolean; anchorWeight?: number; correctedShare?: number } = {}): EvalResult | null {
  const repeats = opts.repeats ?? 20;
  const frac = opts.holdoutFraction ?? 0.4;
  if (labelled.length < 6) return null;
  const rnd = mulberry32(opts.seed ?? 7);
  const mu = meanVec(labelled.map((s) => s.vec)); // label-free statistic of the user's own frames
  const zs: number[] = [], tr: number[] = [];
  const byK = new Map<number, number[]>();
  const nTest = Math.max(2, Math.round(labelled.length * frac));
  const ks = [0, 4, 8, 16, 32].filter((k) => k <= labelled.length - nTest);
  const groups = [...new Set(labelled.map((s) => s.group ?? -1))];
  const aw = opts.anchorWeight ?? DEFAULT_ANCHOR;
  const share = opts.correctedShare ?? 0.5;
  // the head is trained on `k` corrected frames plus the remaining pool frames as zero-shot anchors (their true labels are never used)
  const fit = (pool: Sample[], k: number) => train(zero, [...pool.slice(0, k), ...anchorSamples(zero, pool.slice(k).map((x) => x.vec), aw)], { ...opts.train, mu });
  for (let r = 0; r < repeats; r++) {
    let test: Sample[], pool: Sample[];
    if (opts.groupHoldout && groups.length > 2) {
      const g = [...groups];
      for (let i = g.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [g[i], g[j]] = [g[j]!, g[i]!]; }
      const held = new Set(g.slice(0, Math.max(1, Math.round(g.length * frac))));
      test = labelled.filter((x) => held.has(x.group ?? -1));
      pool = labelled.filter((x) => !held.has(x.group ?? -1));
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
    } else {
      const idx = labelled.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j]!, idx[i]!]; }
      test = idx.slice(0, nTest).map((i) => labelled[i]!);
      pool = idx.slice(nTest).map((i) => labelled[i]!);
    }
    zs.push(accuracy(zero, test));
    tr.push(accuracy(fit(pool, Math.max(1, Math.round(pool.length * share))), test));
    for (const k of ks) {
      if (k === 0) { byK.set(0, [...(byK.get(0) ?? []), accuracy(zero, test)]); continue; }
      if (k > pool.length) continue;
      byK.set(k, [...(byK.get(k) ?? []), accuracy(fit(pool, k), test)]);
    }
  }
  return {
    mode: opts.groupHoldout && groups.length > 2 ? 'new-apps' : 'recurring',
    labelled: labelled.length,
    classes: new Set(labelled.map((s) => s.y)).size,
    repeats,
    holdoutFraction: frac,
    zeroShot: summarize(zs),
    trained: summarize(tr),
    curve: ks.filter((k) => byK.has(k)).map((k) => ({ k, mean: byK.get(k)!.reduce((a, b) => a + b, 0) / byK.get(k)!.length, n: nTest })),
  };
}
