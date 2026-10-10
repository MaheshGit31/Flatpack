/** Session clock: every frame / audio chunk is stamped relative to session start AND with wall-clock time. */
export interface TimeSource {
  now(): number;
}
export const systemTime: TimeSource = { now: () => Date.now() };

export class SessionClock {
  readonly startWall: number;
  private pausedTotal = 0;
  private pausedAt: number | null = null;

  constructor(private readonly src: TimeSource = systemTime, startWall?: number) {
    this.startWall = startWall ?? src.now();
  }

  /** ms since session start (wall elapsed, pauses included so the timeline keeps real gaps). */
  tMs(): number {
    return this.src.now() - this.startWall;
  }

  /** ms of actual recording time (pauses excluded). */
  activeMs(): number {
    const now = this.pausedAt ?? this.src.now();
    return now - this.startWall - this.pausedTotal;
  }

  wall(): number {
    return this.src.now();
  }

  pause(): void {
    if (this.pausedAt === null) this.pausedAt = this.src.now();
  }

  resume(): void {
    if (this.pausedAt !== null) {
      this.pausedTotal += this.src.now() - this.pausedAt;
      this.pausedAt = null;
    }
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  stamp(): { tMs: number; wall: number } {
    const wall = this.src.now();
    return { tMs: wall - this.startWall, wall };
  }
}

/** Map an absolute wall time back to ms-into-session. */
export function wallToSessionMs(wall: number, sessionStartWall: number): number {
  return wall - sessionStartWall;
}
