import { useEffect, useState } from 'react';
import { api, useRuns, type Catalog } from './api';
import { Playground } from './components/Playground';
import { MatrixView } from './components/MatrixView';
import { HistoryView } from './components/HistoryView';
import { WalletView } from './components/WalletView';

type Tab = 'playground' | 'matrix' | 'history' | 'wallet';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'playground', label: 'Playground' },
  { id: 'matrix', label: 'Interop matrix' },
  { id: 'history', label: 'Run history' },
  { id: 'wallet', label: 'Wallet' },
];

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<Tab>(() => (location.hash.slice(1).split('/')[0] as Tab) || 'playground');
  const [openRunId, setOpenRunId] = useState<string | undefined>(() => location.hash.split('/')[1]);
  const [runs] = useRuns();

  const refresh = () => api.catalog().then((c) => { setCatalog(c); setError(undefined); }).catch((e) => setError(e.message));
  useEffect(() => { refresh(); const t = setInterval(refresh, 15000); return () => clearInterval(t); }, []);
  useEffect(() => { location.hash = openRunId && tab === 'playground' ? `${tab}/${openRunId}` : tab; }, [tab, openRunId]);

  const openRun = (id: string) => { setOpenRunId(id); setTab('playground'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const toggleTheme = () => {
    const dark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-black text-white">IP</div>
            <div>
              <div className="text-[15px] font-bold leading-tight">Inji Interop Playground</div>
              <div className="text-[11px] text-slate-500">issue → hold → present → verify · OpenID4VCI / OpenID4VP</div>
            </div>
          </div>
          <nav className="flex gap-1">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${tab === t.id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {catalog && <ServiceHealth catalog={catalog} />}
            <button onClick={toggleTheme} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Toggle theme" aria-label="Toggle theme">◐</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-5">
        {error && <div className="card mb-4 border-red-300 p-4 text-sm text-red-700 dark:text-red-300">Cannot reach the playground API: {error}</div>}
        {!catalog ? <div className="p-10 text-center text-slate-500">Loading catalog…</div> : (
          <>
            {tab === 'playground' && <Playground catalog={catalog} runs={runs} openRunId={openRunId} onOpenRun={setOpenRunId} />}
            {tab === 'matrix' && <MatrixView catalog={catalog} runs={runs} onOpenRun={openRun} />}
            {tab === 'history' && <HistoryView catalog={catalog} runs={runs} onOpenRun={openRun} />}
            {tab === 'wallet' && <WalletView />}
          </>
        )}
      </main>
    </div>
  );
}

function ServiceHealth({ catalog }: { catalog: Catalog }) {
  const items = [
    { id: 'inji-certify', label: 'Certify' },
    { id: 'inji-verify', label: 'Verify' },
  ].map((s) => ({ ...s, health: catalog.parties.find((p) => p.id === s.id)?.health }));
  return (
    <div className="flex gap-2">
      {items.map((s) => (
        <span key={s.id} title={s.health?.detail}
          className={`chip ${s.health?.up ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${s.health?.up ? 'bg-emerald-500' : 'bg-red-500'}`} />
          Inji {s.label}
        </span>
      ))}
    </div>
  );
}
