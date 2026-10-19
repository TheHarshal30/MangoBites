import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, useConnection, useRuns, type Catalog, type ConnectionState, type Party, type RunSummary } from '../api';

export interface SweepProgress { batchId: string; total: number; done: number }

interface AppData {
  catalog: Catalog | null;
  catalogError?: string;
  refreshCatalog: () => Promise<void>;
  runs: RunSummary[];
  runsLoaded: boolean;
  reloadRuns: () => void;
  /** The matrix sweep in progress, if any. */
  sweep: SweepProgress | null;
  setSweep: (s: SweepProgress | null) => void;
  connection: ConnectionState;
}

const Ctx = createContext<AppData | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string>();
  const { runs, loaded: runsLoaded, reload: reloadRuns } = useRuns();
  const [sweep, setSweep] = useState<SweepProgress | null>(null);
  const connection = useConnection();

  const refreshCatalog = useCallback(
    () => api.catalog().then((c) => { setCatalog(c); setCatalogError(undefined); }).catch((e: Error) => setCatalogError(e.message)),
    [],
  );
  useEffect(() => {
    refreshCatalog();
    const t = setInterval(refreshCatalog, 15_000);
    return () => clearInterval(t);
  }, [refreshCatalog]);

  // Poll sweep progress quickly while one runs, slowly otherwise (one may be started from another tab).
  const sweepRef = useRef(sweep);
  sweepRef.current = sweep;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const poll = async () => {
      try { const p = await api.matrix(); if (!cancelled) setSweep(p); } catch { /* keep last */ }
      if (!cancelled) timer = setTimeout(poll, sweepRef.current ? 1500 : 8000);
    };
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  const value = useMemo<AppData>(() => ({ catalog, catalogError, refreshCatalog, runs, runsLoaded, reloadRuns, sweep, setSweep, connection }),
    [catalog, catalogError, refreshCatalog, runs, runsLoaded, reloadRuns, sweep, connection]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

/** For views rendered after the catalog has loaded. */
export function useCatalog() {
  const { catalog } = useApp();
  if (!catalog) throw new Error('Catalog not loaded');
  return catalog;
}

export function usePartyLookup() {
  const catalog = useCatalog();
  return useMemo(() => {
    const byId = new Map(catalog.parties.map((p) => [p.id, p]));
    return {
      party: (id: string): Party | undefined => byId.get(id),
      name: (id: string) => byId.get(id)?.name ?? id,
    };
  }, [catalog]);
}
