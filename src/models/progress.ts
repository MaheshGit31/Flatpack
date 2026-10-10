import type { ModelProgress } from '../types';

/** Aggregate per-file download progress into one honest percentage. */
export function progressAggregator(emit: (p: ModelProgress) => void, model: string) {
  const files = new Map<string, { loaded: number; total: number }>();
  return (e: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (e.file && typeof e.total === 'number' && typeof e.loaded === 'number' && (e.status === 'progress' || e.status === 'done')) {
      files.set(e.file, { loaded: e.status === 'done' ? e.total : e.loaded, total: e.total });
    }
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    emit({ model, loaded, total, pct: total ? Math.min(100, (loaded / total) * 100) : 0, file: e.file ?? '' });
  };
}

