import type { OcrWord } from '../types';

/** Luhn checksum over a digit string. */
export function luhn(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export type SensitiveKind = 'card' | 'email' | 'phone' | 'ssn' | 'secret' | 'labelled';
export interface Span { start: number; end: number; kind: SensitiveKind }

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// 12-19 digits with optional single spaces/dashes between groups
const CARD = /(?<![\d])(?:\d[ -]?){11,18}\d(?![\d])/g;
const PHONE = /(?<![\w])\+\d{10,14}(?![\w])|(?<![\w])(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)[ .-]?\d{3}[ .-]?\d{4}|\d{3}[ .-]\d{3}[ .-]\d{4})(?![\w])/g;
const SSN = /(?<![\d])\d{3}-\d{2}-\d{4}(?![\d])/g;
// well-known secret shapes
const SECRET = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|AIza[0-9A-Za-z_-]{30,})\b/g;
export const LABEL_RE = /^(?:cvc2?|cvv2?|pin|password|passwd|pwd|passcode|secret|token|api[_-]?key|apikey|ssn|private[_-]?key|access[_-]?key|credentials?)[:=]?$/i;
const LABEL_IN_WORD = /(?<=(?:password|passwd|secret|token|api[_-]?key|apikey)\s{0,3}[:=]\s{0,3})\S+/gi;

/** Find sensitive spans in plain text (no layout). */
export function findSensitive(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(EMAIL)) out.push({ start: m.index!, end: m.index! + m[0].length, kind: 'email' });
  for (const m of text.matchAll(SSN)) out.push({ start: m.index!, end: m.index! + m[0].length, kind: 'ssn' });
  for (const m of text.matchAll(CARD)) {
    const digits = m[0].replace(/[ -]/g, '');
    if (luhn(digits)) out.push({ start: m.index!, end: m.index! + m[0].length, kind: 'card' });
  }
  for (const m of text.matchAll(PHONE)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 13 && !luhn(digits)) out.push({ start: m.index!, end: m.index! + m[0].length, kind: 'phone' });
  }
  for (const m of text.matchAll(SECRET)) out.push({ start: m.index!, end: m.index! + m[0].length, kind: 'secret' });
  for (const m of text.matchAll(LABEL_IN_WORD)) out.push({ start: m.index!, end: m.index! + m[0].length, kind: 'labelled' });
  return merge(out);
}

function merge(spans: Span[]): Span[] {
  const s = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Span[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
    else out.push({ ...x });
  }
  return out;
}

export interface RedactionResult {
  /** words whose boxes must be blurred, indices into the input array */
  hit: Set<number>;
  boxes: { x: number; y: number; w: number; h: number }[];
  /** OCR text with sensitive spans replaced */
  text: string;
  count: number;
}

const PAD = 0.004;

/**
 * Redact on OCR words (normalised boxes). Text is rebuilt from the words so character spans map back to words,
 * even when a card number is split over several words. Also handles "password: hunter2" where the label and
 * value are separate words, and labels with the value on the next line.
 */
export function redactWords(words: OcrWord[]): RedactionResult {
  const hit = new Set<number>();
  // sort reading order but keep original indices
  const order = words.map((_, i) => i).sort((a, b) => {
    const wa = words[a]!, wb = words[b]!;
    const dy = (wa.y + wa.h / 2) - (wb.y + wb.h / 2);
    const lineH = Math.min(wa.h, wb.h) * 0.6;
    return Math.abs(dy) > lineH ? dy : wa.x - wb.x;
  });
  let text = '';
  const ranges: { idx: number; start: number; end: number }[] = [];
  for (const idx of order) {
    if (text) text += ' ';
    const start = text.length;
    text += words[idx]!.t;
    ranges.push({ idx, start, end: text.length });
  }
  for (const sp of findSensitive(text)) {
    for (const r of ranges) if (r.start < sp.end && r.end > sp.start) hit.add(r.idx);
  }
  // e-mail addresses that OCR split around the @ ("jane.doe" "@example.com"): word-level rule
  for (let k = 0; k < order.length; k++) {
    const i = order[k]!;
    if (!words[i]!.t.includes('@')) continue;
    hit.add(i);
    const w = words[i]!;
    const gap = w.h * 1.2;
    const adj = (a: OcrWord, b: OcrWord) => Math.abs(a.y - b.y) < a.h * 0.7 && b.x - (a.x + a.w) < gap && b.x >= a.x;
    if (w.t.startsWith('@') && k > 0 && adj(words[order[k - 1]!]!, w)) hit.add(order[k - 1]!);
    if (w.t.endsWith('@') && k + 1 < order.length && adj(w, words[order[k + 1]!]!)) hit.add(order[k + 1]!);
  }
  // label followed by value: blur the next two words on the line (or first word of the next line)
  for (let k = 0; k < order.length; k++) {
    const w = words[order[k]!]!;
    if (!LABEL_RE.test(w.t.replace(/[^\w:=_-]/g, ''))) continue;
    let taken = 0;
    let prev = w;
    for (let j = k + 1; j < order.length && taken < 2; j++) {
      const n = words[order[j]!]!;
      const sameLine = Math.abs((n.y + n.h / 2) - (w.y + w.h / 2)) < w.h * 0.8 && n.x - (prev.x + prev.w) < w.h * 2.5; // adjacent only: never bleed into the next column
      const nextLine = !sameLine && n.y > w.y && n.y - w.y < w.h * 3.2 && taken === 0;
      if (sameLine || nextLine) {
        if (/^[:=]$/.test(n.t)) continue;
        hit.add(order[j]!);
        prev = n;
        taken++;
        if (nextLine) break;
      } else if (n.y > w.y + w.h * 3.2) break;
    }
  }
  const boxes = [...hit].map((i) => {
    const w = words[i]!;
    return { x: Math.max(0, w.x - PAD), y: Math.max(0, w.y - PAD), w: w.w + 2 * PAD, h: w.h + 2 * PAD };
  });
  // text with replacements, same ordering as `text`
  let scrubbed = '';
  for (const r of ranges) {
    if (scrubbed) scrubbed += ' ';
    scrubbed += hit.has(r.idx) ? '█'.repeat(Math.min(8, Math.max(3, r.end - r.start))) : text.slice(r.start, r.end);
  }
  return { hit, boxes, text: scrubbed, count: hit.size ? countGroups(boxes) : 0 };
}

function countGroups(boxes: { x: number; y: number; w: number; h: number }[]): number {
  // adjacent boxes on a line count once
  const s = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  let n = 0;
  let prev: (typeof s)[number] | null = null;
  for (const b of s) {
    if (!prev || Math.abs(b.y - prev.y) > b.h * 0.7 || b.x - (prev.x + prev.w) > b.h * 2.5) n++;
    prev = b;
  }
  return n;
}

/** Does the page text contain any blocklist phrase (case-insensitive)? */
export function matchesBlocklist(text: string, blocklist: string[]): string | null {
  const t = text.toLowerCase();
  for (const b of blocklist) {
    const p = b.trim().toLowerCase();
    if (p && t.includes(p)) return b;
  }
  return null;
}

/** Scrub plain text (e.g. transcript) of sensitive spans. */
export function scrubText(text: string): string {
  const spans = findSensitive(text);
  if (!spans.length) return text;
  let out = '';
  let pos = 0;
  for (const s of spans) { out += text.slice(pos, s.start) + '[redacted]'; pos = s.end; }
  return out + text.slice(pos);
}
