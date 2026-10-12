/// Training worker: fits the classifier head and runs the holdout evaluation off the main thread.
import { serve } from '../util/rpc';
import { evaluateHoldout, train, type EvalResult, type Head, type Sample, type TrainOpts } from '../model/head';

interface WorkerScope {
  postMessage(m: unknown, t?: Transferable[]): void;
  addEventListener(t: 'message', fn: (e: MessageEvent) => void): void;
}

serve(self as unknown as WorkerScope, {
  train(a: { init: Head; samples: Sample[]; opts?: Partial<TrainOpts> & { mu?: Float32Array } }): Head {
    return train(a.init, a.samples, a.opts);
  },
  evaluate(a: { init: Head; samples: Sample[]; opts?: { repeats?: number; holdoutFraction?: number; seed?: number; groupHoldout?: boolean } }): EvalResult | null {
    return evaluateHoldout(a.init, a.samples, a.opts);
  },
});
