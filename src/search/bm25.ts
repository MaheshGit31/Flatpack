/** Small in-memory BM25 with prefix + typo tolerance. Fine for tens of thousands of short OCR docs. */
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'is', 'it', 'for', 'at', 'by', 'with', 'as']);

export function tokenize(s: string): string[] {
  return (s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+(?:[.'@-][a-z0-9]+)*/g) ?? [])
    .flatMap((t) => (/[.'@-]/.test(t) ? [t, ...t.split(/[.'@-]/)] : [t]))
    .filter((t) => t.length > 0 && !STOP.has(t));
}

/** Damerau-less bounded Levenshtein; returns > max when exceeded. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

interface Doc { len: number; tf: Map<string, number> }

export class Bm25 {
  private docs = new Map<string, Doc>();
  private df = new Map<string, number>();
  private totalLen = 0;
  constructor(private k1 = 1.2, private b = 0.75) {}

  get size(): number { return this.docs.size; }

  add(id: string, text: string): void {
    this.remove(id);
    const toks = tokenize(text);
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    this.docs.set(id, { len: toks.length, tf });
    this.totalLen += toks.length;
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
  }
  remove(id: string): void {
    const d = this.docs.get(id);
    if (!d) return;
    this.totalLen -= d.len;
    for (const t of d.tf.keys()) {
      const n = (this.df.get(t) ?? 1) - 1;
      if (n <= 0) this.df.delete(t); else this.df.set(t, n);
    }
    this.docs.delete(id);
  }
  clear(): void { this.docs.clear(); this.df.clear(); this.totalLen = 0; }

  /** Expand a query term into index terms with a weight: exact 1, prefix .8, typo .6 (len>=5 → 1 edit, len>=8 → 2). */
  expand(term: string): Map<string, number> {
    const out = new Map<string, number>();
    const maxEd = term.length >= 8 ? 2 : term.length >= 5 ? 1 : 0;
    for (const t of this.df.keys()) {
      if (t === term) out.set(t, 1);
      else if (term.length >= 3 && t.startsWith(term)) out.set(t, Math.max(out.get(t) ?? 0, 0.8));
      else if (maxEd && editDistance(term, t, maxEd) <= maxEd) out.set(t, Math.max(out.get(t) ?? 0, 0.6));
    }
    return out;
  }

  search(query: string, limit = 100): { id: string; score: number; terms: string[] }[] {
    const qt = [...new Set(tokenize(query))];
    if (!qt.length || !this.docs.size) return [];
    const N = this.docs.size;
    const avg = this.totalLen / N || 1;
    const expanded = qt.map((q) => this.expand(q));
    const scores = new Map<string, { score: number; terms: Set<string> }>();
    for (const exp of expanded) {
      for (const [term, w] of exp) {
        const df = this.df.get(term) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        for (const [id, d] of this.docs) {
          const f = d.tf.get(term);
          if (!f) continue;
          const s = w * idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / avg)));
          const e = scores.get(id) ?? { score: 0, terms: new Set<string>() };
          e.score += s;
          e.terms.add(term);
          scores.set(id, e);
        }
      }
    }
    // require every query term to match something when the query has 1-2 terms; otherwise soft AND via coverage bonus
    const need = qt.length <= 2 ? qt.length : Math.ceil(qt.length * 0.6);
    const out: { id: string; score: number; terms: string[] }[] = [];
    for (const [id, e] of scores) {
      let covered = 0;
      for (const exp of expanded) for (const t of exp.keys()) if (e.terms.has(t)) { covered++; break; }
      if (covered < need) continue;
      out.push({ id, score: e.score * (0.7 + 0.3 * (covered / qt.length)), terms: [...e.terms] });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
