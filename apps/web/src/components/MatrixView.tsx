import { useEffect, useMemo, useState } from 'react';
import { api, type Catalog, type Format, type RunSummary } from '../api';

interface Props { catalog: Catalog; runs: RunSummary[]; onOpenRun: (id: string) => void }

export function MatrixView({ catalog, runs, onOpenRun }: Props) {
  const [scenarios, setScenarios] = useState<string[]>(catalog.scenarios.map((s) => s.id));
  const [progress, setProgress] = useState<{ batchId: string; total: number; done: number } | null>(null);
  const [batch, setBatch] = useState<string>('latest');
  const [error, setError] = useState<string>();

  useEffect(() => {
    const poll = () => api.matrix().then(setProgress).catch(() => {});
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, []);

  const batches = useMemo(() => [...new Set(runs.map((r) => r.batchId).filter(Boolean) as string[])].sort().reverse(), [runs]);
  const scope = useMemo(() => {
    if (batch === 'all') return runs;
    const b = batch === 'latest' ? batches[0] : batch;
    return b ? runs.filter((r) => r.batchId === b) : runs;
  }, [runs, batch, batches]);

  const start = async () => {
    setError(undefined);
    try {
      const p = await api.startMatrix({ scenarios });
      setProgress(p);
      setBatch('latest');
    } catch (e: any) { setError(e.message); }
  };

  const issuers = catalog.parties.filter((p) => p.role === 'issuer');
  const verifiers = catalog.parties.filter((p) => p.role === 'verifier' && p.mode === 'auto');
  const scenarioOf = (r: RunSummary) => catalog.scenarios.find((s) => s.tamper === r.tamper && s.expired === r.expired)?.id ?? 'happy';
  const latestFor = (i: string, v: string, f: Format, s: string) =>
    scope.filter((r) => r.issuer === i && r.verifier === v && r.format === f && scenarioOf(r) === s && r.state !== 'running')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  const done = scope.filter((r) => r.state !== 'running');
  const passed = done.filter((r) => r.result === 'PASS').length;
  const reportHref = `/api/report.md${batch === 'all' ? '' : `?batch=${encodeURIComponent(batch === 'latest' ? batches[0] ?? '' : batch)}`}`;

  return (
    <div className="space-y-5">
      <section className="card p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold">Interoperability sweep</div>
            <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-400">
              Runs every issuer × verifier × format × scenario the Reference Wallet can drive, one after another, against the live services.
              A cell passes when the verifier reaches the verdict the scenario calls for: <b>VALID</b> for the happy path, <b>EXPIRED</b> for an expired credential, and <b>INVALID</b> for every tamper.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              {catalog.scenarios.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={scenarios.includes(s.id)} onChange={(e) => setScenarios((x) => (e.target.checked ? [...x, s.id] : x.filter((y) => y !== s.id)))} />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button className="btn-primary" disabled={!!progress || scenarios.length === 0} onClick={start}>{progress ? 'Sweep running…' : '▶ Run full sweep'}</button>
            {error && <div className="text-xs text-red-600">{error}</div>}
          </div>
        </div>
        {progress && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-slate-500"><span>{progress.batchId}</span><span>{progress.done} / {progress.total}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"><div className="h-full bg-brand-600 transition-all" style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} /></div>
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="label">Showing</div>
          <select className="rounded-md border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-slate-700" value={batch} onChange={(e) => setBatch(e.target.value)}>
            <option value="latest">Latest sweep{batches[0] ? ` (${batches[0]})` : ''}</option>
            <option value="all">All runs (latest per cell)</option>
            {batches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <div className="text-sm text-slate-600 dark:text-slate-300"><b className="text-emerald-600">{passed}</b> pass · <b className="text-red-600">{done.length - passed}</b> fail · {done.length} runs</div>
          <a className="btn-ghost ml-auto py-1.5 text-xs" href={reportHref} target="_blank" rel="noreferrer">Download report (.md)</a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="bg-slate-50 text-left dark:bg-slate-900/60">
                <th className="px-4 py-2 font-semibold">Issuer</th>
                <th className="px-3 py-2 font-semibold">Format</th>
                {verifiers.map((v) => <th key={v.id} className="px-3 py-2 font-semibold">{v.name}<div className="text-[11px] font-normal text-slate-500">{v.vendor === 'Inji' ? `Inji v${v.version}` : 'non-Inji'}</div></th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {issuers.flatMap((i) => (Object.keys(catalog.formats) as Format[]).filter((f) => i.formats.includes(f)).map((f) => (
                <tr key={`${i.id}-${f}`}>
                  <td className="px-4 py-2.5 font-medium">{i.name}<div className="text-[11px] font-normal text-slate-500">{i.vendor === 'Inji' ? `Inji v${i.version}` : 'non-Inji'}</div></td>
                  <td className="px-3 py-2.5">{catalog.formats[f].short}</td>
                  {verifiers.map((v) => (
                    <td key={v.id} className="px-3 py-2.5">
                      {!v.formats.includes(f) ? <span className="text-xs text-slate-400">not supported</span> : (
                        <div className="flex flex-wrap gap-1">
                          {catalog.scenarios.map((s) => {
                            const r = latestFor(i.id, v.id, f, s.id);
                            if (!r) return <span key={s.id} title={`${s.label}: not run`} className="grid h-6 w-6 place-items-center rounded bg-slate-100 text-[10px] text-slate-400 dark:bg-slate-800">·</span>;
                            return (
                              <button key={s.id} onClick={() => onOpenRun(r.id)}
                                title={`${s.label}: ${r.result} (verifier said ${r.actual ?? r.failedStage ?? 'error'}, expected ${r.expected})${r.error ? `\n${r.error}` : ''}`}
                                className={`grid h-6 min-w-6 place-items-center rounded px-1 text-[10px] font-bold text-white ${r.result === 'PASS' ? 'bg-emerald-600' : 'bg-red-600'}`}>
                                {shortScenario(s.id)}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              )))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500 dark:border-slate-800">
          {catalog.scenarios.map((s) => <span key={s.id}><b>{shortScenario(s.id)}</b> {s.label}</span>)}
          <span>· green = verifier reached the expected verdict · click a cell to open its run</span>
        </div>
      </section>
    </div>
  );
}

function shortScenario(id: string) {
  return ({ happy: 'OK', expired: 'EXP', 'bad-signature': 'SIG', 'wrong-type': 'TYP', replay: 'RPL', 'wrong-holder': 'HLD' } as Record<string, string>)[id] ?? id;
}
