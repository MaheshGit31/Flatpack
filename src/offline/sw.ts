// Client side of the offline layer: register the worker, prepare the cache, toggle the simulated airplane mode, report status.
import { useEffect, useState } from 'react';

const supported = () => 'serviceWorker' in navigator && typeof caches !== 'undefined';

export function registerSW(): void {
  if (!import.meta.env.PROD || !supported()) return;
  void navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href).catch(() => undefined);
}

async function ask<T>(msg: object): Promise<T | null> {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  const sw = reg?.active;
  if (!sw) return null;
  return new Promise<T>((res) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => res(e.data as T);
    sw.postMessage(msg, [ch.port2]);
  });
}

export async function getAirplane(): Promise<boolean> {
  return (await ask<{ on: boolean }>({ type: 'airplane?' }))?.on ?? false;
}
export async function setAirplane(on: boolean): Promise<void> {
  await ask({ type: 'airplane', on });
  window.dispatchEvent(new CustomEvent('flatpak-airplane', { detail: on }));
}

export interface Readiness { worker: boolean; shell: boolean; shellCount: number; models: boolean; modelFiles: number; build: string | null }

export async function readiness(): Promise<Readiness> {
  const r: Readiness = { worker: false, shell: false, shellCount: 0, models: false, modelFiles: 0, build: null };
  if (!supported()) return r;
  r.worker = !!(await navigator.serviceWorker.getRegistration())?.active && !!navigator.serviceWorker.controller;
  for (const k of await caches.keys()) {
    if (k.startsWith('flatpak-rt-')) { r.shellCount = (await (await caches.open(k)).keys()).length; r.build = k.slice(11); r.shell = r.shellCount > 5; }
    if (k.startsWith('transformers-cache')) { r.modelFiles += (await (await caches.open(k)).keys()).length; }
  }
  r.models = r.modelFiles >= 3;
  return r;
}

/** Fetch every file in precache.json (the worker caches each response), so a cold reload works with no network. */
export async function prepareOffline(onProgress?: (done: number, total: number) => void): Promise<void> {
  const man = (await (await fetch(new URL('precache.json', document.baseURI).href, { cache: 'no-store' })).json()) as { urls: string[] };
  let done = 0;
  await Promise.all(man.urls.map((u) => fetch(new URL(u, document.baseURI).href).then((r) => r.arrayBuffer()).catch(() => undefined).finally(() => onProgress?.(++done, man.urls.length))));
}

/** Live network state. `simulated` = airplane mode toggled in-app. */
export function useNetwork(): { online: boolean; simulated: boolean } {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [simulated, setSim] = useState(false);
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    const sim = (e: Event) => setSim(!!(e as CustomEvent<boolean>).detail);
    const msg = (e: MessageEvent) => { if (e.data?.type === 'airplane') setSim(!!e.data.on); };
    window.addEventListener('online', up); window.addEventListener('offline', down); window.addEventListener('flatpak-airplane', sim);
    navigator.serviceWorker?.addEventListener('message', msg);
    void getAirplane().then(setSim);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); window.removeEventListener('flatpak-airplane', sim); navigator.serviceWorker?.removeEventListener('message', msg); };
  }, []);
  return { online: online && !simulated, simulated };
}
