import { RpcClient } from '../util/rpc';
import type { SearchHit, SearchFilters, SearchMode } from '../types';
import { indexClient } from '../workers/client';

export class SearchClient {
  private worker: Worker | null = null;
  private rpc: RpcClient | null = null;
  private sizeListeners = new Set<(n: number) => void>();

  private ensure(): RpcClient {
    if (!this.rpc) {
      this.worker = new Worker(new URL('../workers/search.worker.ts', import.meta.url), { type: 'module', name: 'flatpak-search' });
      this.rpc = new RpcClient(this.worker, (t, p) => { if (t === 'size') for (const l of this.sizeListeners) l(p as number); });
    }
    return this.rpc;
  }
  onSize(fn: (n: number) => void): () => void {
    this.sizeListeners.add(fn);
    return () => this.sizeListeners.delete(fn);
  }
  load(): Promise<number> { return this.ensure().call<number>('load'); }
  reload(): Promise<number> { return this.ensure().call<number>('reload'); }

  async search(q: string, mode: SearchMode, filters: SearchFilters, limit = 30): Promise<{ hits: SearchHit[]; ms: number; embedMs: number }> {
    const t0 = performance.now();
    let qvec: Float32Array | null = null;
    if (mode !== 'ocr' && q.trim()) qvec = await indexClient().embedText(q);
    const t1 = performance.now();
    const hits = await this.ensure().call<SearchHit[]>('search', { q, qvec, mode, filters, limit });
    return { hits, ms: performance.now() - t0, embedMs: t1 - t0 };
  }
}

let shared: SearchClient | null = null;
export function searchClient(): SearchClient {
  shared ??= new SearchClient();
  return shared;
}
