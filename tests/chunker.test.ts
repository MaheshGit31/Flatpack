import { describe, expect, it } from 'vitest';
import { SpeechChunker, SR, isHallucination, rms } from '../src/audio/chunker';

const tone = (sec: number, amp = 0.2) => Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / SR));
const quiet = (sec: number) => new Float32Array(Math.round(sec * SR));
const cat = (...a: Float32Array[]) => { const o = new Float32Array(a.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };

describe('SpeechChunker', () => {
  it('ignores silence entirely', () => {
    const c = new SpeechChunker();
    expect(c.push(quiet(10), 0)).toEqual([]);
    expect(c.flush()).toBeNull();
  });
  it('emits one chunk after speech followed by a long pause, with the right start time', () => {
    const c = new SpeechChunker();
    const out = c.push(cat(quiet(1), tone(3), quiet(2.5)), 5000);
    expect(out).toHaveLength(1);
    expect(out[0]!.startMs).toBeGreaterThan(5900);
    expect(out[0]!.startMs).toBeLessThan(6100);
    expect(out[0]!.speechMs).toBeGreaterThan(2800);
  });
  it('splits continuous speech at the max chunk length', () => {
    const c = new SpeechChunker();
    const out = c.push(tone(70), 0);
    expect(out.length).toBeGreaterThanOrEqual(2);
    for (const k of out) expect(k.samples.length / SR).toBeLessThanOrEqual(28.1);
  });
  it('drops blips shorter than the minimum speech duration', () => {
    const c = new SpeechChunker();
    expect(c.push(cat(tone(0.2), quiet(3)), 0)).toEqual([]);
  });
  it('handles odd-sized pushes (carry-over)', () => {
    const c = new SpeechChunker();
    const all = cat(tone(2), quiet(2.5));
    const out = [];
    for (let i = 0; i < all.length; i += 1234) out.push(...c.push(all.subarray(i, i + 1234), (i / SR) * 1000));
    expect(out).toHaveLength(1);
  });
  it('flush returns trailing speech on stop', () => {
    const c = new SpeechChunker();
    c.push(tone(3), 0);
    expect(c.flush()?.speechMs).toBeGreaterThan(2500);
  });
  it('rms + hallucination filter', () => {
    expect(rms(tone(1, 0.5))).toBeCloseTo(0.5 / Math.SQRT2, 1);
    expect(isHallucination('[BLANK_AUDIO]')).toBe(true);
    expect(isHallucination(' (music) ')).toBe(true);
    expect(isHallucination('...')).toBe(true);
    expect(isHallucination('ask not what your country can do for you')).toBe(false);
  });
});
