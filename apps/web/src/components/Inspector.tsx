import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProtocolEvent } from '../api';
import { exchangeNumbers } from './SequenceDiagram';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'OpenID4VCI', label: 'Issuance' },
  { id: 'OpenID4VP', label: 'Presentation' },
  { id: 'http', label: 'HTTP only' },
] as const;

const ROLE_COLORS: Record<string, string> = {
  issuer: 'text-orange-600 dark:text-orange-400',
  wallet: 'text-indigo-600 dark:text-indigo-400',
  verifier: 'text-teal-600 dark:text-teal-400',
  playground: 'text-slate-500',
};

export function Inspector({ events, selectedId, onSelect }: { events: ProtocolEvent[]; selectedId?: string; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const nums = useMemo(() => exchangeNumbers(events), [events]);
  const t0 = events[0] ? Date.parse(events[0].ts) : 0;
  const listRef = useRef<HTMLDivElement>(null);
  const shown = events.filter((e) => filter === 'all' || (filter === 'http' ? e.kind === 'http' : e.step.startsWith(filter)));

  useEffect(() => {
    const el = listRef.current;
    if (el && !selectedId) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
        <div className="label mr-auto">Protocol inspector · {events.length} events</div>
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`rounded-md px-2 py-1 text-xs font-medium ${filter === f.id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
            {f.label}
          </button>
        ))}
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
        {shown.length === 0 && <div className="p-6 text-center text-sm text-slate-500">Waiting for protocol messages…</div>}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800/70">
          {shown.map((e) => {
            const status = e.response?.status;
            const bad = e.kind === 'error' || (status !== undefined && status >= 400);
            return (
              <li key={e.id}>
                <button onClick={() => onSelect(e.id)}
                  className={`flex w-full items-start gap-3 px-4 py-2 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800/50 ${selectedId === e.id ? 'bg-brand-50 dark:bg-brand-700/15' : ''}`}>
                  <span className="w-12 shrink-0 pt-0.5 text-right font-mono text-[11px] text-slate-400">+{((Date.parse(e.ts) - t0) / 1000).toFixed(2)}s</span>
                  <span className="w-7 shrink-0 pt-0.5 font-mono text-[11px] text-slate-400">{nums.get(e.id) ? `[${nums.get(e.id)}]` : ''}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2">
                      <span className="font-medium">{e.step}</span>
                      {status !== undefined && <span className={`chip ${bad ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'}`}>{status}</span>}
                      {e.kind === 'error' && <span className="chip bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">error</span>}
                      {e.kind === 'await' && <span className="chip bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">waiting</span>}
                      {e.data && <span className="chip bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">decoded</span>}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      <span className={ROLE_COLORS[e.from]}>{e.from}</span>{e.from !== e.to && <> → <span className={ROLE_COLORS[e.to]}>{e.to}</span></>} · {e.summary}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
