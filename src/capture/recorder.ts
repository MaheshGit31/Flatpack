import { SessionClock } from '../util/clock';
import { closeStaleSessions, createSession, emptyCounters, getSettings, updateSession } from '../store/db';
import { indexClient } from '../workers/client';
import type { SessionCounters, SessionRec, Settings } from '../types';
import type { CaptureIn, CaptureOut, CaptureStats } from './protocol';
import { FallbackSampler } from './fallback';

export type RecPhase = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

export interface LiveStats extends SessionCounters {
  indexed: number;
  bytes: number;
  queue: number;
  maxGapMs: number;
  captureOnly: boolean;
  mode: 'processor' | 'fallback' | '-';
  redactions: number;
  workerRestarts: number;
}

export interface RecorderState {
  phase: RecPhase;
  session: SessionRec | null;
  stats: LiveStats;
  error: string | null;
  elapsedMs: number;
  audioTracks: number;
}

const MAX_QUEUE = 12; // frames in flight to the indexer; beyond this we drop (never store unredacted)
const CAPTURE_ONLY_AT = 4;

const zeroStats = (): LiveStats => ({ ...emptyCounters(), indexed: 0, bytes: 0, queue: 0, maxGapMs: 0, captureOnly: false, mode: '-', redactions: 0, workerRestarts: 0 });

export function browserSupport(): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) reasons.push('Screen capture (getDisplayMedia) is not available. Use desktop Chrome or Edge.');
  if (typeof Worker === 'undefined') reasons.push('Web Workers are not available.');
  if (typeof OffscreenCanvas === 'undefined') reasons.push('OffscreenCanvas is not available.');
  if (typeof indexedDB === 'undefined') reasons.push('IndexedDB is not available (private mode in some browsers).');
  if (typeof createImageBitmap === 'undefined') reasons.push('createImageBitmap is not available.');
  return { ok: reasons.length === 0, reasons };
}

export class Recorder {
  private state: RecorderState = { phase: 'idle', session: null, stats: zeroStats(), error: null, elapsedMs: 0, audioTracks: 0 };
  private listeners = new Set<() => void>();
  private worker: Worker | null = null;
  private fallback: FallbackSampler | null = null;
  private stream: MediaStream | null = null;
  private clock: SessionClock | null = null;
  private settings: Settings | null = null;
  private tick: number | null = null;
  private lastCapture: CaptureStats = { captured: 0, candidates: 0, skippedDup: 0, skippedBlack: 0, maxGapMs: 0 };
  private base: SessionCounters = emptyCounters();
  private tapped: ((s: MediaStream) => void) | null = null;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): RecorderState => this.state;

  /** Phase 3 hook: receives the live stream so the audio pipeline can tap its audio tracks. */
  onStream(fn: ((s: MediaStream) => void) | null): void {
    this.tapped = fn;
  }
  get currentSession(): SessionRec | null {
    return this.state.session;
  }
  get sessionClock(): SessionClock | null {
    return this.clock;
  }

  private set(patch: Partial<RecorderState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
  private setStats(patch: Partial<LiveStats>): void {
    this.set({ stats: { ...this.state.stats, ...patch } });
  }

  async start(opts: { systemAudio?: boolean } = {}): Promise<void> {
    if (this.state.phase !== 'idle') return;
    this.set({ phase: 'starting', error: null });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 5, max: 15 } }, audio: !!opts.systemAudio });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      this.set({ phase: 'idle', error: name === 'NotAllowedError' ? 'Screen sharing was cancelled or denied. Nothing was recorded.' : `Could not start capture: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    try {
      this.settings = await getSettings();
      const session = await createSession();
      await closeStaleSessions(session.id);
      this.clock = new SessionClock(undefined, session.startedAt);
      this.base = emptyCounters();
      this.lastCapture = { captured: 0, candidates: 0, skippedDup: 0, skippedBlack: 0, maxGapMs: 0 };
      this.stream = stream;
      this.set({ session, stats: zeroStats(), audioTracks: stream.getAudioTracks().length });
      void indexClient().start().catch(() => undefined);
      const video = stream.getVideoTracks()[0];
      if (!video) throw new Error('no video track in the shared stream');
      video.addEventListener('ended', () => void this.stop());
      this.startCapture(video);
      this.tapped?.(stream);
      this.tick = window.setInterval(() => this.onTick(), 1000);
      this.set({ phase: 'recording' });
    } catch (e) {
      for (const t of stream.getTracks()) t.stop();
      this.set({ phase: 'idle', error: e instanceof Error ? e.message : String(e) });
    }
  }

  private startCapture(video: MediaStreamTrack): void {
    const s = this.settings!;
    const clock = this.clock!;
    const sid = this.state.session!.id;
    const startMsg: CaptureIn = { type: 'start', track: video.clone(), intervalMs: s.intervalMs, dedupeThreshold: s.dedupeThreshold, gridThreshold: s.gridThreshold, startWall: clock.startWall, maxWidth: 1280 };
    const worker = new Worker(new URL('./capture.worker.ts', import.meta.url), { type: 'module', name: 'flatpak-capture' });
    this.worker = worker;
    worker.onmessage = (e: MessageEvent<CaptureOut>) => this.onWorker(e.data, sid);
    worker.onerror = () => this.restartCapture(video);
    const canProcess = typeof MediaStreamTrackProcessor !== 'undefined';
    if (canProcess) {
      try {
        const t = (startMsg as Extract<CaptureIn, { type: 'start' }>).track;
        worker.postMessage(startMsg, [t]);
        return;
      } catch {
        /* DataCloneError: track not transferable here, use the fallback */
      }
    }
    worker.postMessage({ type: 'init-fallback', startWall: clock.startWall, intervalMs: s.intervalMs, dedupeThreshold: s.dedupeThreshold, gridThreshold: s.gridThreshold, maxWidth: 1280 } satisfies CaptureIn);
    this.fallback = new FallbackSampler(new MediaStream([video.clone()]), s.intervalMs, (bitmap) => worker.postMessage({ type: 'bitmap', bitmap } satisfies CaptureIn, [bitmap]));
    void this.fallback.start().catch((e: unknown) => this.set({ error: `Fallback capture failed: ${e instanceof Error ? e.message : String(e)}` }));
  }

  private restartCapture(video: MediaStreamTrack): void {
    if (this.state.phase === 'idle' || this.state.phase === 'stopping') return;
    this.worker?.terminate();
    this.fallback?.stop();
    this.fallback = null;
    this.base = { ...this.base, captured: this.base.captured + this.lastCapture.captured, skippedDup: this.base.skippedDup + this.lastCapture.skippedDup, skippedBlack: this.base.skippedBlack + this.lastCapture.skippedBlack };
    this.lastCapture = { captured: 0, candidates: 0, skippedDup: 0, skippedBlack: 0, maxGapMs: 0 };
    this.setStats({ workerRestarts: this.state.stats.workerRestarts + 1 });
    if (video.readyState === 'live') this.startCapture(video);
  }

  private onWorker(m: CaptureOut, sessionId: string): void {
    switch (m.type) {
      case 'mode':
        this.setStats({ mode: m.mode });
        break;
      case 'stats':
        this.lastCapture = m.stats;
        this.setStats({
          captured: this.base.captured + m.stats.captured,
          skippedDup: this.base.skippedDup + m.stats.skippedDup,
          skippedBlack: this.base.skippedBlack + m.stats.skippedBlack,
          maxGapMs: Math.max(this.state.stats.maxGapMs, m.stats.maxGapMs),
        });
        break;
      case 'frame': {
        const idx = indexClient();
        if (idx.pending >= MAX_QUEUE) {
          // overloaded: drop rather than persist an unredacted frame
          m.bitmap.close();
          this.setStats({ dropped: this.state.stats.dropped + 1, captureOnly: true, queue: idx.pending });
          break;
        }
        this.setStats({ queue: idx.pending + 1, captureOnly: idx.pending + 1 >= CAPTURE_ONLY_AT });
        idx
          .process({ bitmap: m.bitmap, sessionId, seq: m.seq, tMs: m.tMs, wall: m.wall, hash: m.hash })
          .then((r) => {
            const st = this.state.stats;
            if (r.status === 'stored') this.setStats({ kept: st.kept + 1, indexed: st.indexed + 1, bytes: st.bytes + r.bytes, redactions: st.redactions + r.redactions });
            else if (r.status === 'skipped-sensitive') this.setStats({ skippedSensitive: st.skippedSensitive + 1 });
            else this.setStats({ skippedBlack: st.skippedBlack + 1 });
          })
          .catch(() => this.setStats({ dropped: this.state.stats.dropped + 1 }))
          .finally(() => this.setStats({ queue: idx.pending, captureOnly: idx.pending >= CAPTURE_ONLY_AT }));
        break;
      }
      case 'ended':
        void this.stop();
        break;
      case 'error':
        this.set({ error: m.message });
        break;
    }
  }

  private onTick(): void {
    if (!this.clock) return;
    this.set({ elapsedMs: this.clock.activeMs() });
    void this.persistCounters();
  }

  private async persistCounters(): Promise<void> {
    const s = this.state.session;
    if (!s) return;
    const { captured, kept, skippedDup, skippedBlack, skippedSensitive, dropped } = this.state.stats;
    await updateSession(s.id, { counters: { captured, kept, skippedDup, skippedBlack, skippedSensitive, dropped } });
  }

  pause(): void {
    if (this.state.phase !== 'recording') return;
    this.clock?.pause();
    this.worker?.postMessage({ type: 'pause' } satisfies CaptureIn);
    for (const t of this.stream?.getAudioTracks() ?? []) t.enabled = false;
    this.set({ phase: 'paused' });
  }
  resume(): void {
    if (this.state.phase !== 'paused') return;
    this.clock?.resume();
    this.worker?.postMessage({ type: 'resume' } satisfies CaptureIn);
    for (const t of this.stream?.getAudioTracks() ?? []) t.enabled = true;
    this.set({ phase: 'recording' });
  }
  toggle(): void {
    if (this.state.phase === 'recording') this.pause();
    else if (this.state.phase === 'paused') this.resume();
  }

  async stop(): Promise<void> {
    if (this.state.phase === 'idle' || this.state.phase === 'stopping') return;
    this.set({ phase: 'stopping' });
    if (this.tick !== null) clearInterval(this.tick);
    this.tick = null;
    this.worker?.postMessage({ type: 'stop' } satisfies CaptureIn);
    this.worker?.terminate();
    this.worker = null;
    this.fallback?.stop();
    this.fallback = null;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.tapped?.(new MediaStream());
    await this.persistCounters();
    const s = this.state.session;
    if (s) await updateSession(s.id, { endedAt: Date.now() });
    this.set({ phase: 'idle', audioTracks: 0 });
  }
}

let shared: Recorder | null = null;
export function recorder(): Recorder {
  shared ??= new Recorder();
  return shared;
}
