/** Tiny typed request/response layer over postMessage. No library, no surprises. */
export type Transferables = Transferable[];

interface Req {
  __rpc: 'req';
  id: number;
  method: string;
  args: unknown;
}
interface Res {
  __rpc: 'res';
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}
type Msg = Req | Res;

type PortLike = {
  postMessage(msg: unknown, transfer?: Transferables): void;
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
};

export class RpcClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(private port: PortLike, private onEvent?: (type: string, payload: unknown) => void) {
    port.addEventListener('message', (e: MessageEvent) => {
      const m = e.data as Msg | { __evt: string; payload: unknown };
      if (m && typeof m === 'object' && '__evt' in m) {
        this.onEvent?.(m.__evt, m.payload);
        return;
      }
      if (!m || (m as Msg).__rpc !== 'res') return;
      const res = m as Res;
      const p = this.pending.get(res.id);
      if (!p) return;
      this.pending.delete(res.id);
      if (res.ok) p.resolve(res.result);
      else p.reject(new Error(res.error ?? 'rpc error'));
    });
  }

  call<T = unknown>(method: string, args?: unknown, transfer?: Transferables): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.port.postMessage({ __rpc: 'req', id, method, args } satisfies Req, transfer ?? []);
    });
  }

  /** Reject everything in flight (worker died). */
  failAll(reason: string): void {
    for (const [, p] of this.pending) p.reject(new Error(reason));
    this.pending.clear();
  }
}

export type Handler = (args: any, transfer: Transferables) => unknown | Promise<unknown>;

/** Worker side: register handlers; returns `emit` for pushing events to the main thread. */
export function serve(scope: { postMessage(m: unknown, t?: Transferables): void; addEventListener(t: 'message', fn: (e: MessageEvent) => void): void }, handlers: Record<string, Handler>) {
  scope.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as Msg;
    if (!m || m.__rpc !== 'req') return;
    const h = handlers[m.method];
    if (!h) {
      scope.postMessage({ __rpc: 'res', id: m.id, ok: false, error: `unknown method ${m.method}` } satisfies Res);
      return;
    }
    const transfer: Transferables = [];
    Promise.resolve()
      .then(() => h(m.args, transfer))
      .then((result) => scope.postMessage({ __rpc: 'res', id: m.id, ok: true, result } satisfies Res, transfer))
      .catch((err: unknown) => scope.postMessage({ __rpc: 'res', id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies Res));
  });
  return (type: string, payload: unknown, transfer?: Transferables) => scope.postMessage({ __evt: type, payload }, transfer ?? []);
}
