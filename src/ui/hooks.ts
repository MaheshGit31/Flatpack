import { useEffect, useState } from 'react';
import { getBlobs, getFrame, getOcr } from '../store/db';
import { indexClient, type IndexEvent } from '../workers/client';
import type { FrameRec, OcrRec } from '../types';

export interface ModelsState { state: 'idle' | 'loading' | 'ready' | 'error'; pct: number; loaded: number; total: number; file: string; backend: string | null; loadMs: number | null; message: string | null }

let current: ModelsState = { state: 'idle', pct: 0, loaded: 0, total: 0, file: '', backend: null, loadMs: null, message: null };
const subs = new Set<(s: ModelsState) => void>();
let wired = false;
function wire(): void {
  if (wired) return;
  wired = true;
  indexClient().on((e: IndexEvent) => {
    if (e.type === 'models') current = { ...current, state: e.state, backend: e.backend ?? current.backend, loadMs: e.loadMs ?? current.loadMs, message: e.message ?? null, pct: e.state === 'ready' ? 100 : current.pct };
    else if (e.type === 'progress') current = { ...current, state: 'loading', pct: e.progress.pct, loaded: e.progress.loaded, total: e.progress.total, file: e.progress.file };
    else if (e.type === 'crash') current = { ...current, message: `index worker restarted (${e.lost} frame(s) lost)` };
    else return;
    for (const s of subs) s(current);
  });
}
export function useModels(): ModelsState {
  wire();
  const [s, set] = useState(current);
  useEffect(() => { subs.add(set); set(current); return () => { subs.delete(set); }; }, []);
  return s;
}

/** Object-URL for a stored frame image (full or thumb), revoked on change/unmount. */
export function useFrameImage(frameId: string | null, kind: 'full' | 'thumb'): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!frameId) { setUrl(''); return; }
    let u = '';
    let alive = true;
    void getBlobs(frameId).then((b) => { if (alive && b) setUrl((u = URL.createObjectURL(kind === 'full' ? b.full : b.thumb))); });
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [frameId, kind]);
  return url;
}

export function useFrame(frameId: string | null): { frame: FrameRec | null; ocr: OcrRec | null } {
  const [r, set] = useState<{ frame: FrameRec | null; ocr: OcrRec | null }>({ frame: null, ocr: null });
  useEffect(() => {
    let alive = true;
    if (!frameId) { set({ frame: null, ocr: null }); return; }
    void Promise.all([getFrame(frameId), getOcr(frameId)]).then(([frame, ocr]) => { if (alive) set({ frame: frame ?? null, ocr: ocr ?? null }); });
    return () => { alive = false; };
  }, [frameId]);
  return r;
}
