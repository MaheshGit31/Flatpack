import { searchClient } from '../search/client';
import { getKv, listFrames, listSessions, setKv } from '../store/db';
import { DEMO_QUERIES, type LabeledQuery } from './queries';
import { firstRelevantRank, median, mrr, recallAt } from './metrics';
import type { ActivityLabel, SearchMode } from '../types';

export interface ModeResult { recall1: number; recall5: number; mrr: number; medianSearchMs: number }
export interface BenchResult {
  at: number;
  queries: number;
  frames: number;
  modes: Record<SearchMode, ModeResult>;
  byKind: Record<string, Record<SearchMode, { recall5: number; n: number }>>;
  perQuery: { q: string; kind: string; ranks: Record<SearchMode, number | null> }[];
  pipeline: { medianIndexMs: number; keptVsCaptured: string; mbPerHourKept: number; modelLoadMs: number | null; backend: string | null };
  activityAccuracy: number | null;
  networkRequestsAfterLoad: number | null;
}

/** frameId -> scene id, stored when the demo is imported (user-labelled mode can write the same key). */
export const LABEL_KEY = 'bench-labels';
export const ACT_KEY = 'bench-activity';

export async function runBenchmark(queries: LabeledQuery[] = DEMO_QUERIES, onProgress?: (done: number, total: number) => void): Promise<BenchResult> {
  const labels = (await getKv<Record<string, string>>(LABEL_KEY)) ?? {};
  const frames = (await listFrames()).filter((f) => labels[f.id]);
  const sc = searchClient();
  await sc.load();
  const modes: SearchMode[] = ['clip', 'ocr', 'fused'];
  const ranks: Record<SearchMode, (number | null)[]> = { clip: [], ocr: [], fused: [] };
  const times: Record<SearchMode, number[]> = { clip: [], ocr: [], fused: [] };
  const perQuery: BenchResult['perQuery'] = [];
  const usable = queries.filter((q) => q.rel.some((r) => Object.values(labels).includes(r)));
  let done = 0;
  for (const q of usable) {
    const rel = new Set(Object.entries(labels).filter(([, s]) => q.rel.includes(s)).map(([id]) => id));
    const row: Record<SearchMode, number | null> = { clip: null, ocr: null, fused: null };
    for (const mode of modes) {
      const r = await sc.search(q.q, mode, {}, 20);
      row[mode] = firstRelevantRank(r.hits.map((h) => h.frameId), rel);
      ranks[mode].push(row[mode]);
      times[mode].push(r.ms - (mode === 'ocr' ? 0 : 0));
    }
    perQuery.push({ q: q.q, kind: q.kind, ranks: row });
    onProgress?.(++done, usable.length);
  }
  const agg = (m: SearchMode): ModeResult => ({ recall1: recallAt(ranks[m], 1), recall5: recallAt(ranks[m], 5), mrr: mrr(ranks[m]), medianSearchMs: median(times[m]) });
  const byKind: BenchResult['byKind'] = {};
  for (const kind of ['text', 'visual', 'mixed']) {
    const idx = perQuery.map((p, i) => (p.kind === kind ? i : -1)).filter((i) => i >= 0);
    byKind[kind] = {} as Record<SearchMode, { recall5: number; n: number }>;
    for (const m of modes) byKind[kind]![m] = { recall5: recallAt(idx.map((i) => ranks[m][i]!), 5), n: idx.length };
  }
  const sessions = await listSessions();
  const captured = sessions.reduce((s, x) => s + x.counters.captured, 0);
  const kept = sessions.reduce((s, x) => s + x.counters.kept, 0);
  const meanBytes = frames.length ? frames.reduce((s, f) => s + f.fullBytes + f.thumbBytes, 0) / frames.length : 0;
  const acts = (await getKv<Record<string, ActivityLabel>>(ACT_KEY)) ?? {};
  const actKeys = frames.filter((f) => acts[labels[f.id]!]);
  const net = await networkRequestsAfterLoad();
  return {
    at: Date.now(),
    queries: usable.length,
    frames: frames.length,
    modes: { clip: agg('clip'), ocr: agg('ocr'), fused: agg('fused') },
    byKind,
    perQuery,
    pipeline: {
      medianIndexMs: median(frames.map((f) => f.indexMs)),
      keptVsCaptured: captured ? `${kept} / ${captured}` : 'n/a (imported images)',
      mbPerHourKept: (meanBytes * 1200) / 1e6, // 3 s sampling => 1200 frames/hour, if every one were kept
      modelLoadMs: await getKv<number>('model-load-ms') ?? null,
      backend: (await getKv<string>('model-backend')) ?? null,
    },
    activityAccuracy: actKeys.length ? actKeys.filter((f) => f.activity === acts[labels[f.id]!]).length / actKeys.length : null,
    networkRequestsAfterLoad: net,
  };
}

/** Number of network requests (any thread) that started after the models finished loading. */
async function networkRequestsAfterLoad(): Promise<number | null> {
  const ready = await getKv<number>('models-ready-at');
  if (!ready) return null;
  const { collectNet } = await import('../privacy/netaudit');
  const all = await collectNet();
  return all.filter((e) => e.startedAt > ready + 500 && !e.name.startsWith('data:') && !e.name.startsWith('blob:')).length;
}

export async function saveBenchmark(r: BenchResult): Promise<void> {
  await setKv('bench-last', r);
}
