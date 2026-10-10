/** Energy VAD + chunker. Pure, so it is unit-tested. Feeds Whisper 15–30 s windows of speech (never audio storage). */
export const SR = 16000;

export interface Chunk { startMs: number; samples: Float32Array; speechMs: number }

export interface ChunkerOpts { maxChunkSec: number; flushSilenceSec: number; minSpeechMs: number; frameMs: number; floor: number }
export const DEFAULT_CHUNKER: ChunkerOpts = { maxChunkSec: 28, flushSilenceSec: 1.6, minSpeechMs: 600, frameMs: 20, floor: 0.008 };

export function rms(a: Float32Array, from = 0, to = a.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i]! * a[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
}

export class SpeechChunker {
  private buf: Float32Array[] = [];
  private len = 0;
  private startMs = 0;
  private speechFrames = 0;
  private silenceFrames = 0;
  private noise = 0.003; // running noise-floor estimate
  private started = false;
  private carry = new Float32Array(0);
  private readonly frame: number;

  constructor(private o: ChunkerOpts = DEFAULT_CHUNKER) {
    this.frame = Math.round((SR * o.frameMs) / 1000);
  }

  /** Push PCM that begins at `tMs` (session clock). Returns zero or more completed chunks. */
  push(pcm: Float32Array, tMs: number): Chunk[] {
    const out: Chunk[] = [];
    let data = pcm;
    if (this.carry.length) { const m = new Float32Array(this.carry.length + pcm.length); m.set(this.carry); m.set(pcm, this.carry.length); data = m; tMs -= (this.carry.length / SR) * 1000; }
    const n = Math.floor(data.length / this.frame);
    for (let f = 0; f < n; f++) {
      const seg = data.subarray(f * this.frame, (f + 1) * this.frame);
      const e = rms(seg);
      const speaking = e > Math.max(this.o.floor, this.noise * 3);
      if (!speaking) this.noise = this.noise * 0.98 + e * 0.02;
      const at = tMs + f * this.o.frameMs;
      if (speaking) {
        if (!this.started) { this.started = true; this.startMs = at; }
        this.speechFrames++;
        this.silenceFrames = 0;
      } else if (this.started) {
        this.silenceFrames++;
      }
      if (this.started) { this.buf.push(seg.slice()); this.len += seg.length; }
      const silentSec = (this.silenceFrames * this.o.frameMs) / 1000;
      if (this.started && (silentSec >= this.o.flushSilenceSec || this.len / SR >= this.o.maxChunkSec)) {
        const c = this.flush();
        if (c) out.push(c);
      }
    }
    this.carry = data.slice(n * this.frame);
    return out;
  }

  /** Emit whatever is buffered (on stop). */
  flush(): Chunk | null {
    const speechMs = this.speechFrames * this.o.frameMs;
    let res: Chunk | null = null;
    if (this.started && speechMs >= this.o.minSpeechMs) {
      const samples = new Float32Array(this.len);
      let o = 0;
      for (const b of this.buf) { samples.set(b, o); o += b.length; }
      res = { startMs: this.startMs, samples, speechMs };
    }
    this.buf = []; this.len = 0; this.speechFrames = 0; this.silenceFrames = 0; this.started = false;
    return res;
  }
}

/** Whisper emits these on near-silence; they are not speech. */
export function isHallucination(t: string): boolean {
  const s = t.trim();
  if (!s) return true;
  if (/^[\[(].*[\])]$/.test(s)) return true; // [BLANK_AUDIO], (music)
  if (!/[a-z]{2}/i.test(s)) return true;
  return false;
}
