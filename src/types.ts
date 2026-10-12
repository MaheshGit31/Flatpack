export const ACTIVITY_LABELS = ['coding', 'video', 'documents', 'slides', 'chat', 'shopping', 'social', 'maps', 'email', 'other'] as const;
export type ActivityLabel = (typeof ACTIVITY_LABELS)[number];

export interface SessionCounters {
  captured: number; // frames sampled from the screen
  kept: number; // frames that survived dedupe + privacy and were stored
  skippedDup: number;
  skippedBlack: number;
  skippedSensitive: number; // dropped because a blocklist term was seen
  dropped: number; // dropped because indexing was overloaded (never stored unredacted)
}

export interface SessionRec {
  id: string;
  startedAt: number; // wall clock ms
  endedAt: number | null;
  label: string;
  counters: SessionCounters;
  demo?: boolean;
}

export interface FrameRec {
  id: string; // `${sessionId}:${seq}`
  sessionId: string;
  seq: number;
  tMs: number; // ms since session start
  wall: number; // wall clock ms
  w: number;
  h: number;
  activity: ActivityLabel; // what the current classifier says (trained head if one exists, else zero-shot); equals userActivity when the user corrected it
  activityConf: number;
  zsActivity?: ActivityLabel; // pure zero-shot label at index time
  userActivity?: ActivityLabel; // set when the user corrected a Timeline block: the training signal
  hasText: boolean;
  redactions: number;
  fullBytes: number;
  thumbBytes: number;
  indexMs: number;
  hash: string;
}

export interface BlobRec {
  frameId: string;
  full: Blob;
  thumb: Blob;
}

export interface VecRec {
  frameId: string;
  vec: Float32Array;
}

/** Coordinates are normalised to 0..1 of the stored frame. */
export interface OcrWord {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
  c: number;
}

export interface OcrRec {
  frameId: string;
  text: string;
  words: OcrWord[];
}

export interface TranscriptRec {
  id: string;
  sessionId: string;
  startMs: number;
  endMs: number;
  source: 'tab' | 'mic';
  text: string;
}

export interface Settings {
  intervalMs: number;
  dedupeThreshold: number; // max Hamming distance (of 64) still considered "same"
  gridThreshold: number; // fraction of grid cells that must change to force keep
  expiryDays: number; // 0 = never
  blocklist: string[]; // frames containing any of these are dropped entirely
  ocrEnabled: boolean;
  audioFeature: boolean; // phase 3 feature flag
  consentAcceptedAt: number | null;
  audioConsentAcceptedAt: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  intervalMs: 3000,
  dedupeThreshold: 6,
  gridThreshold: 0.06,
  expiryDays: 7,
  blocklist: ['private key', 'seed phrase', 'recovery phrase', 'one-time password', 'otp code'],
  ocrEnabled: true,
  audioFeature: false,
  consentAcceptedAt: null,
  audioConsentAcceptedAt: null,
};

export type SearchMode = 'fused' | 'clip' | 'ocr';
export type MatchSignal = 'visual' | 'text' | 'speech';

export interface SearchFilters {
  fromWall?: number;
  toWall?: number;
  activity?: ActivityLabel | 'any';
  hasSpeech?: boolean;
  sessionId?: string;
}

export interface SearchHit {
  frameId: string;
  sessionId: string;
  score: number; // fused RRF score
  signals: Partial<Record<MatchSignal, { rank: number; score: number }>>;
  matchedWords: OcrWord[]; // OCR words that matched the query (for highlight overlay)
  speech: { startMs: number; endMs: number; text: string }[];
}

/** Messages from workers to the main thread. Kept loose on purpose: each worker file narrows its own. */
export interface ModelProgress {
  model: string;
  file: string;
  pct: number; // 0..100
  loaded: number;
  total: number;
}

export interface NetEntry {
  name: string;
  origin: string;
  kind: string;
  startedAt: number; // epoch ms
  bytes: number;
  source: string; // which thread reported it
}
