import { Bm25, tokenize } from './bm25';
import { rrf } from './rrf';
import type { FrameRec, MatchSignal, OcrRec, OcrWord, SearchFilters, SearchHit, SearchMode, TranscriptRec } from '../types';

const DIM = 512;
const SPEECH_PAD_MS = 8000;
export const VISUAL_MARGIN = 0.05;

export interface SearchOptions {
  q: string;
  qvec?: Float32Array | null; // CLIP text embedding of q (computed by the index worker)
  mode?: SearchMode;
  filters?: SearchFilters;
  limit?: number;
}

export class SearchEngine {
  private frames = new Map<string, FrameRec>();
  private idx = new Map<string, number>(); // frameId -> row in matrix
  private rows: string[] = [];
  private mat = new Float32Array(0);
  private ocrIdx = new Bm25();
  private speechIdx = new Bm25();
  private ocrWords = new Map<string, OcrWord[]>();
  private speech = new Map<string, { startMs: number; endMs: number; text: string }[]>();
  private segs: TranscriptRec[] = [];

  get size(): number { return this.frames.size; }

  clear(): void {
    this.frames.clear(); this.idx.clear(); this.rows = []; this.mat = new Float32Array(0);
    this.ocrIdx.clear(); this.speechIdx.clear(); this.ocrWords.clear(); this.speech.clear(); this.segs = [];
  }

  setAll(frames: FrameRec[], vecs: { frameId: string; vec: Float32Array }[], ocrs: OcrRec[], transcripts: TranscriptRec[]): void {
    this.clear();
    for (const f of frames) this.frames.set(f.id, f);
    const vmap = new Map(vecs.map((v) => [v.frameId, v.vec]));
    this.rows = frames.filter((f) => vmap.has(f.id)).map((f) => f.id);
    this.mat = new Float32Array(this.rows.length * DIM);
    this.rows.forEach((id, r) => { this.idx.set(id, r); this.mat.set(vmap.get(id)!, r * DIM); });
    for (const o of ocrs) if (this.frames.has(o.frameId)) { this.ocrIdx.add(o.frameId, o.text); this.ocrWords.set(o.frameId, o.words); }
    this.segs = transcripts;
    this.alignSpeech();
  }

  add(frame: FrameRec, vec: Float32Array, ocr?: OcrRec): void {
    this.frames.set(frame.id, frame);
    const r = this.rows.length;
    const next = new Float32Array((r + 1) * DIM);
    next.set(this.mat);
    next.set(vec, r * DIM);
    this.mat = next; // amortisation is unnecessary at this scale; keeps the code obvious
    this.rows.push(frame.id);
    this.idx.set(frame.id, r);
    if (ocr) { this.ocrIdx.add(frame.id, ocr.text); this.ocrWords.set(frame.id, ocr.words); }
    this.alignSpeech();
  }

  addTranscript(t: TranscriptRec): void {
    this.segs.push(t);
    this.alignSpeech();
  }

  /** Attach each speech segment to frames of the same session whose time falls in the segment (± pad). */
  private alignSpeech(): void {
    this.speech.clear();
    this.speechIdx.clear();
    if (!this.segs.length) return;
    for (const f of this.frames.values()) {
      const hits = this.segs.filter((s) => s.sessionId === f.sessionId && f.tMs >= s.startMs - SPEECH_PAD_MS && f.tMs <= s.endMs + SPEECH_PAD_MS);
      if (hits.length) {
        this.speech.set(f.id, hits.map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text })));
        this.speechIdx.add(f.id, hits.map((s) => s.text).join(' '));
      }
    }
  }

  private passes(f: FrameRec, flt?: SearchFilters): boolean {
    if (!flt) return true;
    if (flt.sessionId && f.sessionId !== flt.sessionId) return false;
    if (flt.fromWall && f.wall < flt.fromWall) return false;
    if (flt.toWall && f.wall > flt.toWall) return false;
    if (flt.activity && flt.activity !== 'any' && f.activity !== flt.activity) return false;
    if (flt.hasSpeech && !this.speech.has(f.id)) return false;
    return true;
  }

  /** Cosine ranking (vectors are L2-normalised so dot == cosine). Brute force over a flat Float32Array. */
  clipRank(q: Float32Array, flt?: SearchFilters): { id: string; score: number }[] {
    const out: { id: string; score: number }[] = [];
    for (let r = 0; r < this.rows.length; r++) {
      const id = this.rows[r]!;
      const f = this.frames.get(id)!;
      if (!this.passes(f, flt)) continue;
      let s = 0;
      const o = r * DIM;
      for (let i = 0; i < DIM; i++) s += q[i]! * this.mat[o + i]!;
      out.push({ id, score: s });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  search(o: SearchOptions): SearchHit[] {
    const { q, qvec, filters } = o;
    const mode = o.mode ?? 'fused';
    const limit = o.limit ?? 30;
    if (!q.trim()) return [];
    const lists: Record<string, string[]> = {};
    const scores: Record<string, Map<string, number>> = {};
    const terms = new Map<string, Set<string>>();

    if ((mode === 'fused' || mode === 'clip') && qvec) {
      let r = this.clipRank(qvec, filters).slice(0, 50);
      if (mode === 'fused' && r.length) {
        // CLIP always returns *something*; in the fused list keep only candidates close to the best visual match so weak matches don't pad the results
        const top = r[0]!.score;
        r = r.filter((x, i) => i < 3 || x.score >= top - VISUAL_MARGIN).slice(0, 15);
      }
      lists['visual'] = r.map((x) => x.id);
      scores['visual'] = new Map(r.map((x) => [x.id, x.score]));
    }
    if (mode === 'fused' || mode === 'ocr') {
      const r = this.ocrIdx.search(q, 50).filter((x) => { const f = this.frames.get(x.id); return f && this.passes(f, filters); });
      lists['text'] = r.map((x) => x.id);
      scores['text'] = new Map(r.map((x) => [x.id, x.score]));
      for (const x of r) terms.set(x.id, new Set(x.terms));
      if (mode === 'fused' && this.speechIdx.size) {
        const s = this.speechIdx.search(q, 50).filter((x) => { const f = this.frames.get(x.id); return f && this.passes(f, filters); });
        if (s.length) {
          lists['speech'] = s.map((x) => x.id);
          scores['speech'] = new Map(s.map((x) => [x.id, x.score]));
        }
      }
    }
    const fused = rrf(lists, 60).slice(0, limit);
    return fused.map((h) => {
      const f = this.frames.get(h.id)!;
      const signals: SearchHit['signals'] = {};
      for (const [name, rank] of Object.entries(h.ranks)) {
        signals[name as MatchSignal] = { rank, score: scores[name]?.get(h.id) ?? 0 };
      }
      return { frameId: h.id, sessionId: f.sessionId, score: h.score, signals, matchedWords: this.matched(h.id, terms.get(h.id)), speech: this.speech.get(h.id) ?? [] };
    });
  }

  private matched(id: string, t?: Set<string>): OcrWord[] {
    if (!t?.size) return [];
    const words = this.ocrWords.get(id) ?? [];
    return words.filter((w) => tokenize(w.t).some((x) => t.has(x)));
  }
}
