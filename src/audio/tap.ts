import { SR } from './chunker';

const WORKLET = `class Tap extends AudioWorkletProcessor{constructor(){super();this.buf=new Float32Array(4096);this.n=0}
process(inputs){const ch=inputs[0]&&inputs[0][0];if(!ch)return true;for(let i=0;i<ch.length;i++){this.buf[this.n++]=ch[i];if(this.n===this.buf.length){this.port.postMessage(this.buf.slice(0));this.n=0}}return true}}
registerProcessor('flatpak-tap',Tap);`;

/** Pulls 16 kHz mono PCM out of a MediaStream's audio track. Audio never leaves the page. */
export class AudioTap {
  private ctx: AudioContext | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;

  constructor(private stream: MediaStream, private onPcm: (samples: Float32Array, endedAtWall: number) => void) {}

  async start(): Promise<void> {
    const ctx = new AudioContext({ sampleRate: SR });
    this.ctx = ctx;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    this.src = ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(ctx, 'flatpak-tap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' });
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.onPcm(e.data, Date.now());
    this.src.connect(this.node);
    if (ctx.state === 'suspended') await ctx.resume();
  }

  async stop(): Promise<void> {
    this.src?.disconnect();
    this.node?.disconnect();
    if (this.node) this.node.port.onmessage = null;
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null; this.src = null; this.node = null;
  }
}
