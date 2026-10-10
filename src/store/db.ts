import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  DEFAULT_SETTINGS,
  type BlobRec,
  type FrameRec,
  type OcrRec,
  type SessionCounters,
  type SessionRec,
  type Settings,
  type TranscriptRec,
  type VecRec,
} from '../types';
import { dayKey } from '../util/format';

interface FlatpakDB extends DBSchema {
  sessions: { key: string; value: SessionRec; indexes: { byStart: number } };
  frames: { key: string; value: FrameRec; indexes: { bySession: string; byWall: number } };
  blobs: { key: string; value: BlobRec };
  vectors: { key: string; value: VecRec };
  ocr: { key: string; value: OcrRec };
  transcript: { key: string; value: TranscriptRec; indexes: { bySession: string } };
  settings: { key: string; value: { key: string; value: unknown } };
}

export const DB_NAME = 'flatpak';
export const DB_VERSION = 1;
const CHANNEL = 'flatpak-db';

let dbp: Promise<IDBPDatabase<FlatpakDB>> | null = null;

export function db(): Promise<IDBPDatabase<FlatpakDB>> {
  dbp ??= openDB<FlatpakDB>(DB_NAME, DB_VERSION, {
    upgrade(d) {
      const sessions = d.createObjectStore('sessions', { keyPath: 'id' });
      sessions.createIndex('byStart', 'startedAt');
      const frames = d.createObjectStore('frames', { keyPath: 'id' });
      frames.createIndex('bySession', 'sessionId');
      frames.createIndex('byWall', 'wall');
      d.createObjectStore('blobs', { keyPath: 'frameId' });
      d.createObjectStore('vectors', { keyPath: 'frameId' });
      d.createObjectStore('ocr', { keyPath: 'frameId' });
      const tr = d.createObjectStore('transcript', { keyPath: 'id' });
      tr.createIndex('bySession', 'sessionId');
      d.createObjectStore('settings', { keyPath: 'key' });
    },
  });
  return dbp;
}

/** Cross-context change notifications (main thread <-> workers). */
export type DbEvent =
  | { type: 'frame-added'; frameId: string }
  | { type: 'frames-deleted'; sessionId?: string; all?: boolean }
  | { type: 'transcript-added'; sessionId: string };

export function dbChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
}
function notify(ev: DbEvent): void {
  const ch = dbChannel();
  ch?.postMessage(ev);
  ch?.close();
}

// ---------- settings ----------
export async function getSettings(): Promise<Settings> {
  const d = await db();
  const rec = await d.get('settings', 'settings');
  return { ...DEFAULT_SETTINGS, ...((rec?.value as Partial<Settings> | undefined) ?? {}) };
}
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await (await db()).put('settings', { key: 'settings', value: next });
  return next;
}
export async function getKv<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('settings', `kv:${key}`))?.value as T | undefined;
}
export async function setKv(key: string, value: unknown): Promise<void> {
  await (await db()).put('settings', { key: `kv:${key}`, value });
}

// ---------- sessions ----------
export const emptyCounters = (): SessionCounters => ({ captured: 0, kept: 0, skippedDup: 0, skippedBlack: 0, skippedSensitive: 0, dropped: 0 });

export function newSessionId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function createSession(label?: string, at?: number, demo?: boolean): Promise<SessionRec> {
  const startedAt = at ?? Date.now();
  const rec: SessionRec = {
    id: newSessionId(),
    startedAt,
    endedAt: null,
    label: label ?? new Date(startedAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    counters: emptyCounters(),
    ...(demo ? { demo: true } : {}),
  };
  await (await db()).put('sessions', rec);
  return rec;
}
export async function updateSession(id: string, patch: Partial<SessionRec>): Promise<void> {
  const d = await db();
  const cur = await d.get('sessions', id);
  if (cur) await d.put('sessions', { ...cur, ...patch });
}
export async function listSessions(): Promise<SessionRec[]> {
  const all = await (await db()).getAllFromIndex('sessions', 'byStart');
  return all.reverse();
}
/** Sessions left open by a closed/crashed tab: close them at their last frame. */
export async function closeStaleSessions(exceptId?: string): Promise<void> {
  const d = await db();
  for (const s of await d.getAll('sessions')) {
    if (s.endedAt === null && s.id !== exceptId) {
      const frames = await d.getAllFromIndex('frames', 'bySession', s.id);
      const last = frames.reduce((m, f) => Math.max(m, f.wall), s.startedAt);
      await d.put('sessions', { ...s, endedAt: last });
    }
  }
}

// ---------- frames ----------
export interface FrameBundle {
  frame: FrameRec;
  blobs: BlobRec;
  vec: VecRec;
  ocr: OcrRec;
}

function isQuota(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22);
}

export async function putFrameBundle(b: FrameBundle): Promise<void> {
  const write = async () => {
    const d = await db();
    const tx = d.transaction(['frames', 'blobs', 'vectors', 'ocr'], 'readwrite');
    await Promise.all([tx.objectStore('frames').put(b.frame), tx.objectStore('blobs').put(b.blobs), tx.objectStore('vectors').put(b.vec), tx.objectStore('ocr').put(b.ocr), tx.done]);
  };
  try {
    await write();
  } catch (e) {
    if (!isQuota(e)) throw e;
    // storage full: evict the oldest ~5% of frames once, then retry
    await evictOldest(0.05);
    await write();
  }
  notify({ type: 'frame-added', frameId: b.frame.id });
}

export async function evictOldest(fraction: number): Promise<number> {
  const d = await db();
  const all = await d.getAllFromIndex('frames', 'byWall');
  const n = Math.max(1, Math.floor(all.length * fraction));
  const ids = all.slice(0, n).map((f) => f.id);
  await deleteFrames(ids);
  return ids.length;
}

export async function deleteFrames(ids: string[]): Promise<void> {
  const d = await db();
  const tx = d.transaction(['frames', 'blobs', 'vectors', 'ocr'], 'readwrite');
  for (const id of ids) {
    tx.objectStore('frames').delete(id);
    tx.objectStore('blobs').delete(id);
    tx.objectStore('vectors').delete(id);
    tx.objectStore('ocr').delete(id);
  }
  await tx.done;
  notify({ type: 'frames-deleted' });
}

export async function getFrame(id: string): Promise<FrameRec | undefined> {
  return (await db()).get('frames', id);
}
export async function getBlobs(id: string): Promise<BlobRec | undefined> {
  return (await db()).get('blobs', id);
}
export async function getOcr(id: string): Promise<OcrRec | undefined> {
  return (await db()).get('ocr', id);
}
export async function listFrames(sessionId?: string): Promise<FrameRec[]> {
  const d = await db();
  const rows = sessionId ? await d.getAllFromIndex('frames', 'bySession', sessionId) : await d.getAllFromIndex('frames', 'byWall');
  return rows.sort((a, b) => a.wall - b.wall);
}
export async function allVectors(): Promise<VecRec[]> {
  return (await db()).getAll('vectors');
}
export async function allOcr(): Promise<OcrRec[]> {
  return (await db()).getAll('ocr');
}
export async function frameCount(): Promise<number> {
  return (await db()).count('frames');
}

// ---------- transcript ----------
export async function putTranscript(rec: TranscriptRec): Promise<void> {
  await (await db()).put('transcript', rec);
  notify({ type: 'transcript-added', sessionId: rec.sessionId });
}
export async function listTranscript(sessionId?: string): Promise<TranscriptRec[]> {
  const d = await db();
  const rows = sessionId ? await d.getAllFromIndex('transcript', 'bySession', sessionId) : await d.getAll('transcript');
  return rows.sort((a, b) => a.startMs - b.startMs);
}

// ---------- housekeeping ----------
export interface DayUsage {
  day: string;
  frames: number;
  bytes: number;
}
export async function storageByDay(): Promise<DayUsage[]> {
  const frames = await listFrames();
  const map = new Map<string, DayUsage>();
  for (const f of frames) {
    const k = dayKey(f.wall);
    const u = map.get(k) ?? { day: k, frames: 0, bytes: 0 };
    u.frames++;
    u.bytes += f.fullBytes + f.thumbBytes;
    map.set(k, u);
  }
  return [...map.values()].sort((a, b) => b.day.localeCompare(a.day));
}

export async function deleteSession(sessionId: string): Promise<void> {
  const d = await db();
  const ids = (await d.getAllKeysFromIndex('frames', 'bySession', sessionId)) as string[];
  const tx = d.transaction(['frames', 'blobs', 'vectors', 'ocr', 'transcript', 'sessions'], 'readwrite');
  for (const id of ids) {
    tx.objectStore('frames').delete(id);
    tx.objectStore('blobs').delete(id);
    tx.objectStore('vectors').delete(id);
    tx.objectStore('ocr').delete(id);
  }
  const tkeys = (await tx.objectStore('transcript').index('bySession').getAllKeys(sessionId)) as string[];
  for (const k of tkeys) tx.objectStore('transcript').delete(k);
  tx.objectStore('sessions').delete(sessionId);
  await tx.done;
  notify({ type: 'frames-deleted', sessionId });
}

export async function expireOld(days: number): Promise<number> {
  if (days <= 0) return 0;
  const cutoff = Date.now() - days * 86400000;
  const d = await db();
  const old = (await d.getAllFromIndex('frames', 'byWall')).filter((f) => f.wall < cutoff);
  if (old.length === 0) return 0;
  await deleteFrames(old.map((f) => f.id));
  // drop sessions that no longer have frames (and are finished)
  for (const s of await d.getAll('sessions')) {
    if (s.endedAt !== null && s.endedAt < cutoff && (await d.countFromIndex('frames', 'bySession', s.id)) === 0) await deleteSession(s.id);
  }
  return old.length;
}

/** Wipe IndexedDB. `models` also removes the Cache Storage entries transformers.js created (forces a re-download). */
export async function deleteEverything(opts: { models: boolean }): Promise<void> {
  const d = await db();
  const names = ['sessions', 'frames', 'blobs', 'vectors', 'ocr', 'transcript'] as const;
  const tx = d.transaction(['sessions', 'frames', 'blobs', 'vectors', 'ocr', 'transcript', 'settings'], 'readwrite');
  for (const n of names) tx.objectStore(n).clear();
  // keep user settings (consent, blocklist) but drop cached kv (label embeddings stay valid, benchmark labels go)
  const kvKeys = (await tx.objectStore('settings').getAllKeys()) as string[];
  for (const k of kvKeys) if (k.startsWith('kv:bench')) tx.objectStore('settings').delete(k);
  await tx.done;
  if (opts.models && typeof caches !== 'undefined') {
    for (const key of await caches.keys()) if (key.startsWith('transformers-cache') || key.startsWith('flatpak-')) await caches.delete(key);
  }
  notify({ type: 'frames-deleted', all: true });
}
