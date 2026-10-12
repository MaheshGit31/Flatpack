/// Main-thread orchestration for the trainable head: collect the user's corrected frames, train in a worker, persist, relabel.
import { ACTIVITY_LABELS, type ActivityLabel } from '../types';
import { allVectors, getHead, getKv, getZeroLabels, listFrames, relabelAll, saveHead, setUserLabels } from '../store/db';
import { RpcClient } from '../util/rpc';
import { anchorSamples, DEFAULT_ANCHOR, labelIndex, meanVec, zeroShotHead, type EvalResult, type Head, type Sample } from './head';
import { ACT_KEY, LABEL_KEY } from '../eval/bench';

let worker: Worker | null = null;
let rpc: RpcClient | null = null;
function client(): RpcClient {
  if (!rpc) {
    worker = new Worker(new URL('../workers/train.worker.ts', import.meta.url), { type: 'module', name: 'flatpak-train' });
    rpc = new RpcClient(worker);
  }
  return rpc;
}

export class NoLabelsError extends Error {}

export async function zeroHead(): Promise<Head> {
  const v = await getZeroLabels();
  if (!v) throw new NoLabelsError('Load the models once (record or import a screenshot) so the zero-shot labels exist.');
  return zeroShotHead(v);
}

/** The user's corrected frames as training samples. */
export async function labelledSamples(): Promise<Sample[]> {
  const [frames, vecs] = await Promise.all([listFrames(), allVectors()]);
  const vm = new Map(vecs.map((v) => [v.frameId, v.vec]));
  const out: Sample[] = [];
  for (const f of frames) {
    const v = vm.get(f.id);
    if (f.userActivity && v) out.push({ vec: v, y: labelIndex(f.userActivity) });
  }
  return out;
}

export interface HeadStatus { labelled: number; trainedOn: number; trainedAt: number | null; loss: number | null }
export async function headStatus(): Promise<HeadStatus> {
  const [h, s] = await Promise.all([getHead(), labelledSamples()]);
  return { labelled: s.length, trainedOn: h?.trainedOn ?? 0, trainedAt: h?.trainedAt ?? null, loss: h?.loss ?? null };
}

/** Train from zero-shot on all corrections (hard labels) + every other frame as a zero-shot anchor, persist the weights, relabel every frame. */
export async function retrain(): Promise<{ trainedOn: number; relabelled: number; loss: number | null; ms: number }> {
  const t0 = performance.now();
  const init = await zeroHead();
  const [frames, vecs] = await Promise.all([listFrames(), allVectors()]);
  const vm = new Map(vecs.map((v) => [v.frameId, v.vec]));
  const hard: Sample[] = [];
  const free: Float32Array[] = [];
  for (const f of frames) {
    const v = vm.get(f.id);
    if (!v) continue;
    if (f.userActivity) hard.push({ vec: v, y: labelIndex(f.userActivity) });
    else free.push(v);
  }
  if (!hard.length) { await saveHead(null); return { trainedOn: 0, relabelled: await relabelAll(init), loss: null, ms: 0 }; }
  const samples = [...hard, ...anchorSamples(init, free, DEFAULT_ANCHOR)];
  const head = await client().call<Head>('train', { init, samples, opts: { mu: meanVec([...vm.values()]) } });
  head.trainedOn = hard.length;
  await saveHead(head);
  const relabelled = await relabelAll(head);
  return { trainedOn: hard.length, relabelled, loss: head.loss, ms: performance.now() - t0 };
}

/** Forget the training: back to pure zero-shot labels (the user's corrections are kept). */
export async function resetHead(): Promise<number> {
  await saveHead(null);
  return relabelAll(await zeroHead());
}

export async function correctBlock(frameIds: string[], label: ActivityLabel | null): Promise<void> {
  await setUserLabels(frameIds, label);
}

export type EvalOpts = { repeats?: number; holdoutFraction?: number; groupHoldout?: boolean };
export async function evaluateSamples(samples: Sample[], opts?: EvalOpts): Promise<EvalResult | null> {
  return client().call<EvalResult | null>('evaluate', { init: await zeroHead(), samples, opts });
}
export async function evaluateUserFrames(opts?: EvalOpts): Promise<EvalResult | null> {
  return evaluateSamples(await labelledSamples(), opts);
}

/** The shipped labelled pack: 70 real CLIP embeddings (14 synthetic apps x 5 appearances). Read-only, never written to the user's database. */
export async function loadPack(base = new URL('./', document.baseURI).href): Promise<Sample[]> {
  const [meta, bin] = await Promise.all([fetch(new URL('demo/pack.json', base)).then((r) => r.json() as Promise<{ dim: number; items: { label: ActivityLabel; group: number }[] }>), fetch(new URL('demo/pack.bin', base)).then((r) => r.arrayBuffer())]);
  const all = new Float32Array(bin);
  return meta.items.map((it, i) => ({ vec: all.slice(i * meta.dim, (i + 1) * meta.dim), y: labelIndex(it.label), group: it.group }));
}

/** Demo only: copy the ground-truth labels that ship with the demo data into user labels, as a stand-in for real corrections. */
export async function labelDemoFromGroundTruth(): Promise<number> {
  const [labels, expected, frames] = await Promise.all([getKv<Record<string, string>>(LABEL_KEY), getKv<Record<string, ActivityLabel>>(ACT_KEY), listFrames()]);
  if (!labels || !expected) return 0;
  const by = new Map<ActivityLabel, string[]>();
  for (const f of frames) {
    const truth = expected[labels[f.id] ?? ''];
    if (truth && (ACTIVITY_LABELS as readonly string[]).includes(truth)) by.set(truth, [...(by.get(truth) ?? []), f.id]);
  }
  let n = 0;
  for (const [l, ids] of by) { await setUserLabels(ids, l); n += ids.length; }
  return n;
}
