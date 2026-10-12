import {
  env,
  AutoTokenizer,
  AutoProcessor,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
} from '@huggingface/transformers';
import { ACTIVITY_LABELS, type ActivityLabel, type ModelProgress } from '../types';
import { progressAggregator } from './progress';

const REPO = 'Xenova/clip-vit-base-patch32';

export const ACTIVITY_PROMPTS: Record<ActivityLabel, string[]> = {
  coding: ['a screenshot of a code editor with source code', 'a screenshot of a terminal or stack trace', 'a screenshot of a programming IDE'],
  video: ['a screenshot of a video player', 'a screenshot of a streaming video website', 'a movie playing in full screen'],
  documents: ['a screenshot of a text document or article', 'a screenshot of a PDF or word processor', 'a screenshot of a web page full of text'],
  slides: ['a screenshot of a presentation slide', 'a slide deck with a big title', 'a PowerPoint slide'],
  chat: ['a screenshot of a chat messaging app', 'a screenshot of a group conversation with message bubbles', 'a screenshot of Slack or Discord'],
  shopping: ['a screenshot of an online store with product prices', 'a screenshot of a shopping cart and checkout page', 'a product listing page'],
  social: ['a screenshot of a social media feed', 'a screenshot of a social network profile with posts', 'a screenshot of Twitter or Instagram'],
  maps: ['a screenshot of a map with roads and a route', 'a screenshot of Google Maps', 'a satellite map view'],
  email: ['a screenshot of an email inbox', 'a screenshot of an email message being read', 'a screenshot of Gmail'],
  other: ['a screenshot of a desktop with windows', 'a screenshot of a settings page', 'a screenshot of a dashboard with charts'],
};

export interface ClipHandle {
  backend: 'webgpu' | 'wasm';
  loadMs: number;
  embedImage(rgba: Uint8ClampedArray, w: number, h: number): Promise<Float32Array>;
  embedText(q: string): Promise<Float32Array>;
  classify(vec: Float32Array): { label: ActivityLabel; conf: number };
  /** zero-shot label embeddings, flat K*512 in ACTIVITY_LABELS order: the initial weights of the trainable head */
  labelVecs: Float32Array;
}

export function l2(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  n = Math.sqrt(n) || 1;
  const o = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) o[i] = v[i]! / n;
  return o;
}
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export async function loadClip(onProgress: (p: ModelProgress) => void, wasmBase: string, preferGpu = true): Promise<ClipHandle> {
  const t0 = performance.now();
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.wasmPaths = wasmBase;
    wasm.numThreads = 1; // no SharedArrayBuffer / cross-origin isolation needed
    wasm.proxy = false;
  }
  const cb = progressAggregator(onProgress, 'CLIP ViT-B/32 (q8)');
  let hasGpu = false;
  if (preferGpu && typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      hasGpu = !!(await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter());
    } catch {
      hasGpu = false;
    }
  }

  async function build(device: 'webgpu' | 'wasm') {
    const opts = { dtype: 'q8' as const, device, progress_callback: cb };
    const [tokenizer, processor, text, vision] = await Promise.all([
      AutoTokenizer.from_pretrained(REPO, { progress_callback: cb }),
      AutoProcessor.from_pretrained(REPO, { progress_callback: cb }),
      CLIPTextModelWithProjection.from_pretrained(REPO, opts),
      CLIPVisionModelWithProjection.from_pretrained(REPO, opts),
    ]);
    return { tokenizer, processor, text, vision };
  }

  let backend: 'webgpu' | 'wasm' = hasGpu ? 'webgpu' : 'wasm';
  let m;
  try {
    m = await build(backend);
    if (backend === 'webgpu') {
      // smoke test: a q8 graph can fail on some GPUs at first run, not at load
      const probe = await m.vision(await m.processor(new RawImage(new Uint8ClampedArray(224 * 224 * 4), 224, 224, 4)));
      if (!probe['image_embeds']) throw new Error('webgpu probe failed');
    }
  } catch {
    backend = 'wasm';
    m = await build('wasm');
  }
  const { tokenizer, processor, text, vision } = m;

  const embedText = async (q: string): Promise<Float32Array> => {
    const inputs = tokenizer([q], { padding: true, truncation: true });
    const out = await text(inputs);
    const t = out['text_embeds'] as { data: Float32Array };
    return l2(Float32Array.from(t.data));
  };
  const embedImage = async (rgba: Uint8ClampedArray, w: number, h: number): Promise<Float32Array> => {
    const img = new RawImage(rgba, w, h, 4);
    const out = await vision(await processor(img));
    const t = out['image_embeds'] as { data: Float32Array };
    return l2(Float32Array.from(t.data));
  };

  // zero-shot label embeddings: mean of prompt embeddings per label (computed once per load, ~30 short strings)
  const labelVecs = new Map<ActivityLabel, Float32Array>();
  for (const label of ACTIVITY_LABELS) {
    const vs: Float32Array[] = [];
    for (const p of ACTIVITY_PROMPTS[label]) vs.push(await embedText(p));
    const mean = new Float32Array(512);
    for (const v of vs) for (let i = 0; i < 512; i++) mean[i]! += v[i]! / vs.length;
    labelVecs.set(label, l2(mean));
  }
  const classify = (vec: Float32Array): { label: ActivityLabel; conf: number } => {
    const scores = ACTIVITY_LABELS.map((l) => 100 * dot(vec, labelVecs.get(l)!)); // CLIP logit scale
    const mx = Math.max(...scores);
    const exps = scores.map((s) => Math.exp(s - mx));
    const z = exps.reduce((a, b) => a + b, 0);
    let bi = 0;
    exps.forEach((e, i) => { if (e > exps[bi]!) bi = i; });
    return { label: ACTIVITY_LABELS[bi]!, conf: exps[bi]! / z };
  };

  const flat = new Float32Array(ACTIVITY_LABELS.length * 512);
  ACTIVITY_LABELS.forEach((l, i) => flat.set(labelVecs.get(l)!, i * 512));
  return { backend, loadMs: performance.now() - t0, embedImage, embedText, classify, labelVecs: flat };
}
