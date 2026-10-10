export interface CaptureStartMsg {
  type: 'start';
  track: MediaStreamTrack;
  intervalMs: number;
  dedupeThreshold: number;
  gridThreshold: number;
  startWall: number;
  maxWidth: number;
}
export interface CaptureSettingsMsg {
  type: 'settings';
  intervalMs?: number;
  dedupeThreshold?: number;
  gridThreshold?: number;
}
export type CaptureIn =
  | CaptureStartMsg
  | CaptureSettingsMsg
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'init-fallback'; startWall: number; intervalMs: number; dedupeThreshold: number; gridThreshold: number; maxWidth: number }
  | { type: 'bitmap'; bitmap: ImageBitmap };

export interface CaptureStats {
  captured: number;
  candidates: number; // kept by dedupe, handed to indexing
  skippedDup: number;
  skippedBlack: number;
  maxGapMs: number;
}
export type CaptureOut =
  | { type: 'mode'; mode: 'processor' | 'fallback' }
  | { type: 'frame'; bitmap: ImageBitmap; seq: number; tMs: number; wall: number; hash: string }
  | { type: 'stats'; stats: CaptureStats }
  | { type: 'ended' }
  | { type: 'error'; message: string };
