import { useSyncExternalStore } from 'react';

export type View = 'playground' | 'matrix' | 'history' | 'wallet';
export interface Route { view: View; runId?: string }

const VIEWS: View[] = ['playground', 'matrix', 'history', 'wallet'];

/** Accepts `#playground/<id>` (the original link format) as well as `#/playground/<id>`. */
export function parseHash(hash: string): Route {
  const [first, second] = hash.replace(/^#\/?/, '').split('/');
  const view = (VIEWS as string[]).includes(first) ? (first as View) : 'playground';
  return { view, runId: view === 'playground' && second ? decodeURIComponent(second) : undefined };
}

export const routeHref = (r: Route) => `#${r.view}${r.runId ? `/${encodeURIComponent(r.runId)}` : ''}`;
export const runHref = (runId: string) => routeHref({ view: 'playground', runId });

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};
const snapshot = () => location.hash;

/** The current route; follows the back/forward buttons. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, snapshot);
  return parseHash(hash);
}

export function navigate(r: Route, opts: { replace?: boolean } = {}) {
  const href = routeHref(r);
  if (location.hash === href) return;
  if (opts.replace) {
    history.replaceState(null, '', href);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = href;
  }
}

export const openRun = (runId: string) => navigate({ view: 'playground', runId });
