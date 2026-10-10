import { useEffect, useState } from 'react';

export type AppPage = 'overview' | 'record' | 'search' | 'timeline' | 'ask' | 'privacy' | 'benchmark';
export type Route = { kind: 'landing' } | { kind: 'app'; page: AppPage };

export const APP_PAGES: AppPage[] = ['overview', 'record', 'search', 'timeline', 'ask', 'privacy', 'benchmark'];

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  if (!h.startsWith('app')) return { kind: 'landing' };
  const page = h.split('/')[1] ?? 'overview';
  return { kind: 'app', page: (APP_PAGES as string[]).includes(page) ? (page as AppPage) : 'overview' };
}
export const href = (page: AppPage): string => `#/app/${page}`;

export function useRoute(): Route {
  const [r, set] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const f = () => { set(parseHash(location.hash)); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return r;
}
