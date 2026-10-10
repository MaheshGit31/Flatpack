/// Audio worker: PCM in (16 kHz mono) → energy VAD → 15–30 s speech chunks → Whisper tiny.en (wasm) → text-only transcript rows.
/// Raw audio is never stored; chunks live in memory only until transcribed.
import { pipeline, env } from '@huggingface/transformers';
import { putTranscript } from '../store/db';
import { SpeechChunker, isHallucination, type Chunk } from '../audio/chunker';
import { progressAggregator } from '../models/progress';
import { scrubText } from '../privacy/redact';
import { serve } from '../util/rpc';
import type { ModelProgress } from '../types';

interface WorkerScope { postMessage(m: unknown, t?: Transferable[]): void; addEventListener(t: 'message', fn: (e: MessageEvent) => void): void }

const MODEL = 'onnx-community/whisper-tiny.en';
type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;

let asr: Asr | null = null;
let loading: Promise<void> | null = null;
let baseUrl = '';
let session = '';
let nextId = 0;
let pending = 0;
let queue: Promise<void> = Promise.resolve();
const chunkers = new Map<string, SpeechChunker>(); // per source (tab / mic)
let sessionOffsetMs = 0;
let transcribed = 0;

function loadAsr(): Promise<void> {
  loading ??= (async () => {
    emit('audio-model', { state: 'loading' });
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    const wasm = env.backends.onnx.wasm;
    if (wasm) { wasm.wasmPaths = new URL('ort/', baseUrl).href; wasm.numThreads = 1; wasm.proxy = false; }
    const cb = progressAggregator((p: ModelProgress) => emit('progress', p), 'Whisper tiny.en (q8)');
    try {
      asr = (await pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8', device: 'wasm', progress_callback: cb })) as unknown as Asr;
      emit('audio-model', { state: 'ready' });
    } catch (e) {
      loading = null;
      emit('audio-model', { state: 'error', message: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  })();
  return loading;
}

async function transcribe(source: 'tab' | 'mic', c: Chunk): Promise<void> {
  await loadAsr();
  const out = await asr!(c.samples, { return_timestamps: true, chunk_length_s: 30 });
  const parts = out.chunks?.length ? out.chunks : [{ text: out.text, timestamp: [0, c.samples.length / 16000] as [number, number | null] }];
  for (const p of parts) {
    if (isHallucination(p.text)) continue;
    const t0 = c.startMs + p.timestamp[0] * 1000;
    const t1 = c.startMs + (p.timestamp[1] ?? c.samples.length / 16000) * 1000;
    const text = scrubText(p.text.trim());
    await putTranscript({ id: `${session}:a${nextId++}`, sessionId: session, startMs: Math.round(t0), endMs: Math.round(t1), source, text });
    transcribed++;
  }
  emit('transcribed', { count: transcribed });
}

function enqueue(source: 'tab' | 'mic', c: Chunk): void {
  pending++;
  emit('audio-queue', { pending });
  queue = queue.then(() => transcribe(source, c)).catch((e: unknown) => { emit('audio-error', { message: e instanceof Error ? e.message : String(e) }); }).finally(() => { pending--; emit('audio-queue', { pending }); });
}

const emit = serve(self as unknown as WorkerScope, {
  async init(a: { baseUrl: string }) { baseUrl = a.baseUrl; await loadAsr(); return { ok: true }; },
  begin(a: { sessionId: string; offsetMs?: number }) { session = a.sessionId; sessionOffsetMs = a.offsetMs ?? 0; nextId = 0; transcribed = 0; chunkers.clear(); return true; },
  pcm(a: { source: 'tab' | 'mic'; samples: Float32Array; tMs: number }) {
    let ch = chunkers.get(a.source);
    if (!ch) chunkers.set(a.source, (ch = new SpeechChunker()));
    for (const c of ch.push(a.samples, a.tMs + sessionOffsetMs)) enqueue(a.source, c);
    return true;
  },
  async end() {
    for (const [source, ch] of chunkers) { const c = ch.flush(); if (c) enqueue(source as 'tab' | 'mic', c); }
    await queue;
    return { transcribed };
  },
  /** Test hook: run a whole PCM buffer through the same path. */
  async transcribeBuffer(a: { sessionId: string; samples: Float32Array }) {
    session = a.sessionId; nextId = 0; transcribed = 0;
    const ch = new SpeechChunker();
    const cs = [...ch.push(a.samples, 0)];
    const tail = ch.flush();
    if (tail) cs.push(tail);
    for (const c of cs) await transcribe('mic', c);
    return { transcribed };
  },
});
