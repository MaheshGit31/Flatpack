/// Fallback sampler for browsers without MediaStreamTrackProcessor (Firefox/Safari have no usable display capture
/// for this app anyway, but Chromium variants may lack the API). A <video> element + a Worker-driven timer, so
/// the interval does not drift when the tab is in the background.
export class FallbackSampler {
  private video: HTMLVideoElement;
  private timer: Worker | null = null;
  private url: string | null = null;
  private busy = false;

  constructor(private stream: MediaStream, private intervalMs: number, private onBitmap: (b: ImageBitmap) => void) {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = stream;
  }

  async start(): Promise<void> {
    await this.video.play();
    const src = `setInterval(()=>postMessage(0),${Math.max(500, this.intervalMs)})`;
    this.url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    this.timer = new Worker(this.url);
    this.timer.onmessage = () => void this.tick();
  }

  private async tick(): Promise<void> {
    if (this.busy || this.video.readyState < 2 || this.video.videoWidth === 0) return;
    this.busy = true;
    try {
      this.onBitmap(await createImageBitmap(this.video));
    } finally {
      this.busy = false;
    }
  }

  stop(): void {
    this.timer?.terminate();
    if (this.url) URL.revokeObjectURL(this.url);
    this.video.pause();
    this.video.srcObject = null;
    for (const t of this.stream.getTracks()) t.stop();
  }
}
