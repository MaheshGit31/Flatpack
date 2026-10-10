import { indexClient } from '../workers/client';
import type { NetEntry } from '../types';

function mainEntries(): NetEntry[] {
  return (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map((e) => ({
    name: e.name,
    origin: safeOrigin(e.name),
    kind: e.initiatorType,
    startedAt: Math.round(performance.timeOrigin + e.startTime),
    bytes: e.transferSize,
    source: 'page',
  }));
}
function safeOrigin(u: string): string {
  try { return new URL(u).origin; } catch { return 'unknown'; }
}

/** Everything the page and the index worker (CLIP + OCR host) requested. */
export async function collectNet(): Promise<NetEntry[]> {
  const out = mainEntries();
  try {
    out.push(...(await indexClient().call<NetEntry[]>('net')));
  } catch {
    /* worker not started yet */
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

export interface NetSummary {
  total: number;
  external: NetEntry[];
  sameOrigin: number;
  afterReady: { total: number; external: number };
}

export function summarize(entries: NetEntry[], readyAt: number | null, selfOrigin = location.origin): NetSummary {
  const ext = entries.filter((e) => e.origin !== selfOrigin && !e.name.startsWith('data:') && !e.name.startsWith('blob:'));
  const after = entries.filter((e) => readyAt !== null && e.startedAt > readyAt + 500 && !e.name.startsWith('data:') && !e.name.startsWith('blob:'));
  return {
    total: entries.length,
    external: ext,
    sameOrigin: entries.length - ext.length,
    afterReady: { total: after.length, external: after.filter((e) => e.origin !== selfOrigin).length },
  };
}
