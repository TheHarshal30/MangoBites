import { useMemo, useState } from 'react';
import { api, scenarioLabel, type Catalog, type RunSummary } from '../api';

interface Props { catalog: Catalog; runs: RunSummary[]; onOpenRun: (id: string) => void }

export function HistoryView({ catalog, runs, onOpenRun }: Props) {
  const [f, setF] = useState({ issuer: '', verifier: '', format: '', result: '', scenario: '', version: '' });
  const name = (id: string) => catalog.parties.find((p) => p.id === id)?.name ?? id;
  const versionsOf = (r: RunSummary) => Object.entries(r.versions ?? {}).filter(([, v]) => v !== 'playground').map(([k, v]) => `${name(k)} ${v}`);
  const allVersions = useMemo(() => [...new Set(runs.flatMap(versionsOf))].sort(), [runs]);

  const filtered = runs.filter((r) =>
    (!f.issuer || r.issuer === f.issuer) && (!f.verifier || r.verifier === f.verifier) && (!f.format || r.format === f.format) &&
    (!f.result || (f.result === 'running' ? r.state === 'running' : r.result === f.result)) &&
    (!f.scenario || scenarioLabel(r, catalog) === f.scenario) && (!f.version || versionsOf(r).includes(f.version)));

  const done = filtered.filter((r) => r.state !== 'running');
  const pass = done.filter((r) => r.result === 'PASS').length;
  const avgMs = done.length ? done.reduce((a, r) => a + (r.durationMs ?? 0), 0) / done.length : 0;
  const select = (key: keyof typeof f, label: string, options: Array<[string, string]>) => (
    <label className="text-xs">
      <div className="label mb-1">{label}</div>
      <select className="w-full rounded-md border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700" value={f[key]} onChange={(e) => setF((x) => ({ ...x, [key]: e.target.value }))}>
        <option value="">All</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Runs" value={String(done.length)} />
        <Stat label="Pass rate" value={done.length ? `${Math.round((100 * pass) / done.length)}%` : '—'} tone={pass === done.length ? 'good' : 'bad'} />
        <Stat label="Failures" value={String(done.length - pass)} tone={done.length - pass ? 'bad' : 'good'} />
        <Stat label="Avg duration" value={avgMs ? `${(avgMs / 1000).toFixed(1)} s` : '—'} />
      </div>

      <section className="card p-4">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {select('issuer', 'Issuer', catalog.parties.filter((p) => p.role === 'issuer').map((p) => [p.id, p.name]))}
          {select('verifier', 'Verifier', catalog.parties.filter((p) => p.role === 'verifier').map((p) => [p.id, p.name]))}
          {select('format', 'Format', Object.entries(catalog.formats).map(([k, v]) => [k, v.short]))}
          {select('scenario', 'Scenario', ['Happy path', 'Expired credential', ...Object.entries(catalog.tamperModes).filter(([k]) => k !== 'none').map(([, v]) => v.label)].map((s) => [s, s]))}
          {select('version', 'Module version', allVersions.map((v) => [v, v]))}
          {select('result', 'Outcome', [['PASS', 'Pass'], ['FAIL', 'Fail'], ['running', 'Running']])}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <div className="label">{filtered.length} runs</div>
          <a className="btn-ghost ml-auto py-1 text-xs" href="/api/report.md" target="_blank" rel="noreferrer">Report (.md)</a>
          <button className="btn-ghost ml-2 py-1 text-xs" onClick={() => { if (confirm('Delete all run history?')) api.clearRuns().then(() => location.reload()); }}>Clear history</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-slate-50 text-left text-xs dark:bg-slate-900/60">
              <tr>{['When', 'Issuer', 'Wallet', 'Verifier', 'Format', 'Proof', 'Scenario', 'Expected', 'Actual', 'Result', 'Detail'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.slice(0, 400).map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => onOpenRun(r.id)}>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">{name(r.issuer)}</td>
                  <td className="px-3 py-2">{name(r.wallet)}</td>
                  <td className="px-3 py-2">{name(r.verifier)}</td>
                  <td className="px-3 py-2">{catalog.formats[r.format]?.short}</td>
                  <td className="px-3 py-2 text-xs">{r.proofType ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">{scenarioLabel(r, catalog)}</td>
                  <td className="px-3 py-2 text-xs">{r.expected}</td>
                  <td className="px-3 py-2 text-xs">{r.actual ?? '—'}</td>
                  <td className="px-3 py-2">
                    {r.state === 'running' ? <span className="chip bg-sky-100 text-sky-800">running</span>
                      : <span className={`chip ${r.result === 'PASS' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'}`}>{r.result}</span>}
                  </td>
                  <td className="max-w-80 truncate px-3 py-2 text-xs text-slate-500" title={r.error}>{r.result === 'PASS' ? '' : r.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="p-8 text-center text-sm text-slate-500">No runs match these filters.</div>}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-600' : ''}`}>{value}</div>
    </div>
  );
}
