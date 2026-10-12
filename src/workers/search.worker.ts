/// Search worker: owns the vector matrix + BM25 indexes; reads IndexedDB itself and follows change events.
import { allOcr, allVectors, dbChannel, getFrame, getOcr, listFrames, listTranscript, db } from '../store/db';
import { SearchEngine, type SearchOptions } from '../search/engine';
import { serve } from '../util/rpc';

interface WorkerScope {
  postMessage(m: unknown, t?: Transferable[]): void;
  addEventListener(t: 'message', fn: (e: MessageEvent) => void): void;
}

const engine = new SearchEngine();
let loaded: Promise<void> | null = null;

async function loadAll(): Promise<void> {
  const [frames, vecs, ocrs, tr] = await Promise.all([listFrames(), allVectors(), allOcr(), listTranscript()]);
  engine.setAll(frames, vecs, ocrs, tr);
  emit('size', engine.size);
}

const emit = serve(self as unknown as WorkerScope, {
  load() {
    loaded ??= loadAll();
    return loaded.then(() => engine.size);
  },
  reload() {
    loaded = loadAll();
    return loaded.then(() => engine.size);
  },
  async search(o: SearchOptions) {
    await (loaded ??= loadAll());
    return engine.search(o);
  },
  async stats() {
    await (loaded ??= loadAll());
    return { frames: engine.size };
  },
});

const ch = dbChannel();
if (ch) {
  ch.onmessage = async (e: MessageEvent<{ type: string; frameId?: string }>) => {
    if (!loaded) return;
    await loaded;
    const m = e.data;
    if (m.type === 'frame-added' && m.frameId) {
      const [f, o] = await Promise.all([getFrame(m.frameId), getOcr(m.frameId)]);
      const v = await (await db()).get('vectors', m.frameId);
      if (f && v) { engine.add(f, v.vec, o); emit('size', engine.size); }
    } else if (m.type === 'frames-deleted' || m.type === 'transcript-added' || m.type === 'labels-changed') {
      loaded = loadAll();
    }
  };
}
