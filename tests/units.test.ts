import { describe, expect, it } from 'vitest';
import { dhash, hamming, rgbaToGray, gridSignature, gridChange, isBlackFrame, textLikelihood } from '../src/util/dhash';
import { SessionClock, wallToSessionMs } from '../src/util/clock';
import { luhn, findSensitive, redactWords, matchesBlocklist, scrubText } from '../src/privacy/redact';
import { rrf } from '../src/search/rrf';
import { Bm25, tokenize, editDistance } from '../src/search/bm25';
import type { FrameRec, OcrWord } from '../src/types';

function img(w: number, h: number, f: (x: number, y: number) => number): Float32Array {
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = f(x, y);
  return g;
}

describe('dHash', () => {
  const a = img(64, 36, (x, y) => (x * 4 + y * 2) % 256);
  it('is 16 hex chars and deterministic', () => {
    expect(dhash(a, 64, 36)).toMatch(/^[0-9a-f]{16}$/);
    expect(dhash(a, 64, 36)).toBe(dhash(a, 64, 36));
  });
  it('tiny noise stays within a few bits, different image far away', () => {
    const noisy = a.map((v, i) => v + (i % 3));
    const other = img(64, 36, (x, y) => ((x * 37) ^ (y * 91)) % 256);
    expect(hamming(dhash(a, 64, 36), dhash(noisy, 64, 36))).toBeLessThanOrEqual(6);
    expect(hamming(dhash(a, 64, 36), dhash(other, 64, 36))).toBeGreaterThan(12);
  });
  it('hamming basics', () => {
    expect(hamming('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hamming('00000000000000f0', '0000000000000000')).toBe(4);
  });
  it('black + static detection and grid change', () => {
    const black = new Float32Array(64 * 36);
    expect(isBlackFrame(black)).toBe(true);
    expect(isBlackFrame(a)).toBe(false);
    const g1 = gridSignature(a, 64, 36);
    expect(gridChange(g1, g1)).toBe(0);
    const g2 = gridSignature(img(64, 36, () => 255), 64, 36);
    expect(gridChange(g1, g2)).toBeGreaterThan(0.5);
  });
  it('rgba -> gray and text likelihood', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    const g = rgbaToGray(rgba, 2, 1);
    expect(g[0]).toBeGreaterThan(250);
    expect(g[1]).toBeLessThan(5);
    const flat = new Float32Array(64 * 36).fill(120);
    const texty = img(64, 36, (x, y) => ((x >> 1) + y) % 2 ? 0 : 255);
    expect(textLikelihood(texty, 64, 36)).toBeGreaterThan(textLikelihood(flat, 64, 36));
  });
});

describe('session clock', () => {
  it('stamps relative and wall time and excludes pauses from active time', () => {
    let now = 1_000_000;
    const c = new SessionClock({ now: () => now });
    now += 5000;
    expect(c.stamp()).toEqual({ tMs: 5000, wall: 1_005_000 });
    c.pause();
    now += 10_000;
    expect(c.paused).toBe(true);
    c.resume();
    now += 2000;
    expect(c.tMs()).toBe(17_000);
    expect(c.activeMs()).toBe(7000);
    expect(wallToSessionMs(1_017_000, c.startWall)).toBe(17_000);
  });
});

describe('luhn + redaction', () => {
  it('luhn', () => {
    expect(luhn('4242424242424242')).toBe(true);
    expect(luhn('4242424242424241')).toBe(false);
    expect(luhn('1234')).toBe(false);
  });
  it('finds cards (spaced/dashed), emails, phones, ssn, secrets', () => {
    const kinds = (t: string) => findSensitive(t).map((s) => s.kind);
    expect(kinds('pay with 4242 4242 4242 4242 now')).toEqual(['card']);
    expect(kinds('4242-4242-4242-4242')).toEqual(['card']);
    expect(kinds('mail me at jane.doe@example.com ok')).toEqual(['email']);
    expect(kinds('call (415) 555-0132 today')).toEqual(['phone']);
    expect(kinds('ssn 123-45-6789')).toContain('ssn');
    expect(kinds('key sk-abcdefghijklmnopqrstuvwx1234')).toEqual(['secret']);
    expect(kinds('password: hunter2')).toEqual(['labelled']);
  });
  it('does not flag ordinary numbers', () => {
    expect(findSensitive('order 4242424242424241 total 1234567890123')).toEqual([]);
    expect(findSensitive('version 1.2.3 released 2026-10-09')).toEqual([]);
  });
  const W = (t: string, x: number, y: number, w = 0.06): OcrWord => ({ t, x, y, w, h: 0.03, c: 90 });
  it('maps a card split over words to boxes and scrubs the text', () => {
    const words = [W('Card', 0.1, 0.1), W('4242', 0.2, 0.1), W('4242', 0.27, 0.1), W('4242', 0.34, 0.1), W('4242', 0.41, 0.1), W('Thanks', 0.1, 0.2)];
    const r = redactWords(words);
    expect([...r.hit].sort()).toEqual([1, 2, 3, 4]);
    expect(r.count).toBe(1);
    expect(r.text).not.toMatch(/4242/);
    expect(r.text).toContain('Thanks');
    expect(r.boxes).toHaveLength(4);
  });
  it('blurs the value after a password label, incl. next line', () => {
    const same = redactWords([W('Password:', 0.1, 0.1), W('hunter2', 0.25, 0.1), W('Login', 0.1, 0.3)]);
    expect([...same.hit]).toEqual([1]);
    const next = redactWords([W('API', 0.1, 0.1), W('key', 0.14, 0.1), W('Token', 0.1, 0.2), W('abc123xyz', 0.1, 0.24), W('footer', 0.1, 0.8)]);
    expect(next.hit.has(3)).toBe(true);
    expect(next.hit.has(4)).toBe(false);
  });
  it('blurs OCR-split emails and CVC values', () => {
    const r = redactWords([W('Email', 0.1, 0.1), W('jane.doe', 0.2, 0.1), W('@example.com', 0.27, 0.1, 0.1), W('CVC', 0.1, 0.2), W('123', 0.16, 0.2)]);
    expect([...r.hit].sort()).toEqual([1, 2, 4]);
  });
  it('label value does not bleed into the next column', () => {
    const r = redactWords([W('CVC', 0.1, 0.2, 0.05), W('123', 0.16, 0.2, 0.04), W('Shipping', 0.6, 0.2, 0.1)]);
    expect([...r.hit]).toEqual([1]);
  });
  it('blocklist + transcript scrub', () => {
    expect(matchesBlocklist('Your Seed Phrase is below', ['seed phrase'])).toBe('seed phrase');
    expect(matchesBlocklist('hello', ['seed phrase'])).toBeNull();
    expect(scrubText('write to a@b.co please')).toBe('write to [redacted] please');
  });
});

describe('RRF', () => {
  it('fuses with k=60 and records ranks', () => {
    const r = rrf({ clip: ['a', 'b', 'c'], ocr: ['b', 'c', 'd'] });
    expect(r[0]!.id).toBe('b');
    expect(r[0]!.score).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(r[0]!.ranks).toEqual({ clip: 2, ocr: 1 });
    expect(r.map((x) => x.id)).toEqual(['b', 'c', 'a', 'd']);
  });
  it('single list preserves order', () => {
    expect(rrf({ x: ['q', 'w', 'e'] }).map((x) => x.id)).toEqual(['q', 'w', 'e']);
  });
});

describe('BM25', () => {
  const idx = new Bm25();
  idx.add('1', 'Traceback most recent call last: TypeError cannot read properties of undefined reading length');
  idx.add('2', 'Pricing: Pro plan $29 per month, Team plan $99 per month, billed annually');
  idx.add('3', 'Quarterly revenue dashboard: revenue up 12 percent, churn down');
  it('tokenizes', () => {
    expect(tokenize('Hello, World! user@x.io')).toContain('hello');
    expect(tokenize('The cat')).toEqual(['cat']);
  });
  it('edit distance', () => {
    expect(editDistance('pricing', 'pricing', 2)).toBe(0);
    expect(editDistance('pricng', 'pricing', 2)).toBe(1);
    expect(editDistance('abc', 'xyzxyz', 1)).toBeGreaterThan(1);
  });
  it('exact, prefix and typo matching', () => {
    expect(idx.search('pricing')[0]!.id).toBe('2');
    expect(idx.search('pric')[0]!.id).toBe('2');
    expect(idx.search('pricng')[0]!.id).toBe('2');
    expect(idx.search('traceback typeerror')[0]!.id).toBe('1');
    expect(idx.search('zzzzzz')).toEqual([]);
  });
  it('remove', () => {
    idx.remove('2');
    expect(idx.search('pricing')).toEqual([]);
  });
});

import { SearchEngine, VISUAL_MARGIN } from '../src/search/engine';
describe('SearchEngine (fused)', () => {
  const fr = (id: string, tMs = 0): FrameRec => ({ id, sessionId: 's', seq: 0, tMs, wall: 1000 + tMs, w: 1, h: 1, activity: 'other', activityConf: 1, hasText: true, redactions: 0, fullBytes: 1, thumbBytes: 1, indexMs: 1, hash: '0' });
  const vec = (i: number, j = -1): Float32Array => { const v = new Float32Array(512); v[i] = 1; if (j >= 0) v[j] = 0.3; const n = Math.hypot(...v); return v.map((x) => x / n); };
  it('fuses visual and text, trims weak visual padding, reports per-signal ranks', () => {
    const e = new SearchEngine();
    e.setAll([fr('a'), fr('b'), fr('c'), fr('d'), fr('e')], [{ frameId: 'a', vec: vec(0) }, { frameId: 'b', vec: vec(1) }, { frameId: 'c', vec: vec(2) }, { frameId: 'd', vec: vec(3) }, { frameId: 'e', vec: vec(4) }],
      [{ frameId: 'b', text: 'pricing plans starter pro', words: [{ t: 'pricing', x: 0, y: 0, w: 0.1, h: 0.05, c: 90 }] }, { frameId: 'c', text: 'unrelated words here', words: [] }], []);
    const q = vec(0, 1);
    const hits = e.search({ q: 'pricing', qvec: q });
    expect(hits[0]!.frameId).toBe('b'); // text rank 1 + visual rank 2 beats visual-only rank 1
    expect(hits[0]!.signals.text?.rank).toBe(1);
    expect(hits[0]!.signals.visual?.rank).toBe(2);
    expect(hits[0]!.matchedWords).toHaveLength(1);
    expect(hits.length).toBeLessThan(5); // far-away visual frames are trimmed
    expect(VISUAL_MARGIN).toBeGreaterThan(0);
    expect(e.search({ q: 'pricing', qvec: q, mode: 'ocr' }).map((h) => h.frameId)).toEqual(['b']);
    expect(e.search({ q: 'pricing', qvec: q, mode: 'clip' })).toHaveLength(5);
  });
  it('filters by activity, time and speech; aligns transcript to frames', () => {
    const e = new SearchEngine();
    const f1 = { ...fr('x', 0), activity: 'coding' as const };
    const f2 = fr('y', 60_000);
    e.setAll([f1, f2], [{ frameId: 'x', vec: vec(0) }, { frameId: 'y', vec: vec(1) }], [], [{ id: 't', sessionId: 's', startMs: 55_000, endMs: 58_000, source: 'mic', text: 'launch party at six' }]);
    expect(e.search({ q: 'launch party', qvec: vec(5), filters: { hasSpeech: true } }).map((h) => h.frameId)).toEqual(['y']);
    expect(e.search({ q: 'launch party', qvec: vec(5) })[0]!.signals.speech?.rank).toBe(1);
    expect(e.search({ q: 'x', qvec: vec(0), mode: 'clip', filters: { activity: 'coding' } }).map((h) => h.frameId)).toEqual(['x']);
    expect(e.search({ q: 'x', qvec: vec(0), mode: 'clip', filters: { fromWall: 50_000 } }).map((h) => h.frameId)).toEqual(['y']);
  });
});
