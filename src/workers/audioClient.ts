import { RpcClient } from '../util/rpc';
import type { ModelProgress } from '../types';

export type AudioEvent = { type: 'audio-model'; state: string; message?: string } | { type: 'progress'; progress: ModelProgress } | { type: 'transcribed'; count: number } | { type: 'audio-queue'; pending: number } | { type: 'audio-error'; message: string };

export class AudioClient {
  private worker: Worker | null = null;
  private rpc: RpcClient | null = null;
  private listeners = new Set<(e: AudioEvent) => void>();
  on(fn: (e: AudioEvent) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private ensure(): RpcClient {
    if (!this.rpc) {
      this.worker = new Worker(new URL('./audio.worker.ts', import.meta.url), { type: 'module', name: 'flatpak-audio' });
      this.rpc = new RpcClient(this.worker, (type, payload) => {
        const e = type === 'progress' ? { type, progress: payload } : { type, ...(payload as object) };
        for (const l of this.listeners) l(e as AudioEvent);
      });
    }
    return this.rpc;
  }
  init(): Promise<unknown> { return this.ensure().call('init', { baseUrl: new URL('./', document.baseURI).href }); }
  begin(sessionId: string): Promise<unknown> { return this.ensure().call('begin', { sessionId }); }
  pcm(source: 'tab' | 'mic', samples: Float32Array, tMs: number): void { void this.ensure().call('pcm', { source, samples, tMs }, [samples.buffer]); }
  end(): Promise<{ transcribed: number }> { return this.ensure().call('end'); }
  call<T>(m: string, a?: unknown, t?: Transferable[]): Promise<T> { return this.ensure().call<T>(m, a, t); }
  dispose(): void { this.worker?.terminate(); this.worker = null; this.rpc = null; }
}
let shared: AudioClient | null = null;
export function audioClient(): AudioClient { shared ??= new AudioClient(); return shared; }
