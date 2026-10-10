import { RpcClient } from '../util/rpc';
import type { ProcessArgs } from './index.worker';
import type { ModelProgress, NetEntry } from '../types';
import { setKv } from '../store/db';

export type IndexResult =
  | { status: 'stored'; frameId: string; bytes: number; indexMs: number; redactions: number }
  | { status: 'skipped-sensitive' }
  | { status: 'skipped-black' };

export type IndexEvent =
  | { type: 'models'; state: 'loading' | 'ready' | 'error'; message?: string; loadMs?: number; backend?: string }
  | { type: 'progress'; progress: ModelProgress }
  | { type: 'net'; entries: NetEntry[] }
  | { type: 'crash'; lost: number };

/** Owns the index worker: spawn, restart on crash, expose a promise API. */
export class IndexClient {
  private worker: Worker | null = null;
  private rpc: RpcClient | null = null;
  private listeners = new Set<(e: IndexEvent) => void>();
  private inflight = 0;
  private ready: Promise<void> | null = null;

  on(fn: (e: IndexEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: IndexEvent) {
    for (const l of this.listeners) l(e);
  }
  get pending(): number {
    return this.inflight;
  }

  private spawn(): void {
    this.worker?.terminate();
    const w = new Worker(new URL('./index.worker.ts', import.meta.url), { type: 'module', name: 'flatpak-index' });
    this.worker = w;
    this.rpc = new RpcClient(w, (type, payload) => {
      if (type === 'models') {
        const p = payload as { state: string; loadMs?: number; backend?: string };
        if (p.state === 'ready') {
          void setKv('models-ready-at', Date.now());
          if (p.loadMs) void setKv('model-load-ms', Math.round(p.loadMs));
          if (p.backend) void setKv('model-backend', p.backend);
        }
        this.emit({ type: 'models', ...(payload as object) } as IndexEvent);
      }
      else if (type === 'progress') this.emit({ type: 'progress', progress: payload as ModelProgress });
      else if (type === 'net') this.emit({ type: 'net', entries: payload as NetEntry[] });
    });
    w.addEventListener('error', () => this.crashed());
    w.addEventListener('messageerror', () => this.crashed());
  }

  private crashed(): void {
    const lost = this.inflight;
    this.rpc?.failAll('index worker crashed');
    this.inflight = 0;
    this.ready = null;
    this.emit({ type: 'crash', lost });
    this.spawn(); // capture keeps running; indexing resumes with a fresh worker
    void this.start();
  }

  /** Spawn (once) and warm the models. */
  start(): Promise<void> {
    if (!this.worker) this.spawn();
    this.ready ??= this.rpc!.call('init', { baseUrl: new URL('./', document.baseURI).href }).then(() => undefined).catch((e) => {
      this.ready = null;
      throw e;
    });
    return this.ready;
  }

  async process(a: ProcessArgs): Promise<IndexResult> {
    await this.start();
    this.inflight++;
    try {
      return await this.rpc!.call<IndexResult>('process', a, [a.bitmap]);
    } finally {
      this.inflight = Math.max(0, this.inflight - 1);
    }
  }

  async embedText(q: string): Promise<Float32Array> {
    await this.start();
    return this.rpc!.call<Float32Array>('embedText', { q });
  }

  call<T>(method: string, args?: unknown): Promise<T> {
    if (!this.worker) this.spawn();
    return this.rpc!.call<T>(method, args);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.rpc = null;
    this.ready = null;
  }
}

let shared: IndexClient | null = null;
export function indexClient(): IndexClient {
  shared ??= new IndexClient();
  return shared;
}
