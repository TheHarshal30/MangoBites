import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api, useLive, scenarioLabel, type Catalog, type ProtocolEvent, type Run } from '../api';
import { Inspector } from './Inspector';
import { SequenceDiagram } from './SequenceDiagram';
import { JsonView } from './JsonView';

const STAGES = [
  { key: 'issue', label: 'Issue', sub: 'OpenID4VCI' },
  { key: 'hold', label: 'Hold', sub: 'wallet stores VC' },
  { key: 'present', label: 'Present', sub: 'OpenID4VP' },
  { key: 'verify', label: 'Verify', sub: 'verdict' },
] as const;

export function RunView({ runId, catalog }: { runId: string; catalog: Catalog }) {
  const [run, setRun] = useState<Run>();
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string>();

  useEffect(() => { api.run(runId).then(setRun).catch((e) => setError(e.message)); }, [runId]);
  useLive((m) => {
    if (m.type === 'event' && m.event.runId === runId) {
      setRun((r) => (r && !r.events.some((e) => e.id === m.event.id) ? { ...r, events: [...r.events, m.event] } : r));
    }
    if (m.type === 'run' && m.run.id === runId) {
      setRun((r) => (r ? { ...r, ...m.run, events: r.events } : r));
      if (m.run.state !== 'running') api.run(runId).then((full) => setRun((r) => ({ ...full, events: mergeEvents(r?.events ?? [], full.events) })));
    }
  });

  if (error) return <div className="card p-6 text-sm text-red-600">Run {runId}: {error}</div>;
  if (!run) return <div className="card p-6 text-sm text-slate-500">Loading run…</div>;

  const name = (id: string) => catalog.parties.find((p) => p.id === id)?.name ?? id;
  const holdStatus = run.stages.issue.status === 'done' ? 'done' : run.stages.issue.status === 'failed' ? 'failed' : 'pending';
  const stageStatus = (k: string) => (k === 'hold' ? holdStatus : run.stages[k as keyof Run['stages']]?.status ?? 'pending');
  const selectedEvent = run.events.find((e) => e.id === selected);

  return (
    <div className="space-y-4">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
          <div className="min-w-0 flex-1">
            <div className="label">Run · {new Date(run.createdAt).toLocaleString()}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold">
              <span>{name(run.issuer)}</span><span className="text-slate-400">→</span>
              <span>{name(run.wallet)}</span><span className="text-slate-400">→</span>
              <span>{name(run.verifier)}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
              <span className="chip bg-slate-100 dark:bg-slate-800">{catalog.formats[run.format]?.label}</span>
              {run.proofType && <span className="chip bg-slate-100 dark:bg-slate-800">proof: {run.proofType}</span>}
              <span className={`chip ${run.tamper !== 'none' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-slate-100 dark:bg-slate-800'}`}>scenario: {scenarioLabel(run, catalog)}</span>
              {run.durationMs != null && <span className="chip bg-slate-100 dark:bg-slate-800">{(run.durationMs / 1000).toFixed(1)} s</span>}
            </div>
          </div>
          <Verdict run={run} />
        </div>
        <ol className="grid grid-cols-4 border-t border-slate-200 dark:border-slate-800">
          {STAGES.map((s, i) => {
            const st = stageStatus(s.key);
            return (
              <li key={s.key} className={`relative px-4 py-3 ${i ? 'border-l border-slate-200 dark:border-slate-800' : ''}`}>
                <div className="flex items-center gap-2">
                  <StageDot status={st} />
                  <span className="font-semibold">{s.label}</span>
                  <span className="hidden text-xs text-slate-500 sm:inline">{s.sub}</span>
                </div>
                {s.key !== 'hold' && run.stages[s.key as 'issue']?.detail && <div className="mt-1 truncate text-xs text-slate-500" title={run.stages[s.key as 'issue'].detail}>{run.stages[s.key as 'issue'].detail}</div>}
                {st === 'running' && <div className="absolute inset-x-0 bottom-0 h-0.5 animate-pulse bg-brand-500" />}
              </li>
            );
          })}
        </ol>
      </section>

      {run.interaction && run.state === 'running' && <ManualPanel run={run} />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <section className="card p-4">
            <div className="label mb-2">Protocol sequence (live)</div>
            <SequenceDiagram run={run} catalog={catalog} selectedId={selected} />
          </section>
          {(run.outcome || run.outcomeChecks || run.error) && <Checks run={run} />}
          {run.credential && (
            <section className="card p-4">
              <div className="label mb-2">Credential held by the wallet</div>
              <JsonView value={run.credential.summary} />
            </section>
          )}
        </div>
        <section className="card flex h-[calc(100vh-7rem)] min-h-[560px] flex-col overflow-hidden xl:sticky xl:top-20">
          <Inspector events={run.events} selectedId={selected} onSelect={setSelected} />
          {selectedEvent && <EventDetail event={selectedEvent} onClose={() => setSelected(undefined)} />}
        </section>
      </div>
    </div>
  );
}

function mergeEvents(a: ProtocolEvent[], b: ProtocolEvent[]) {
  const seen = new Set(a.map((e) => e.id));
  return [...a, ...b.filter((e) => !seen.has(e.id))].sort((x, y) => x.ts.localeCompare(y.ts));
}

function Verdict({ run }: { run: Run }) {
  if (run.state === 'running') {
    return <div className="rounded-xl bg-sky-50 px-5 py-3 text-center text-sky-800 dark:bg-sky-950 dark:text-sky-200"><div className="text-xs font-semibold uppercase">Running</div><div className="text-xl font-bold">…</div></div>;
  }
  const pass = run.result === 'PASS';
  const color = (v?: string) => (v === 'VALID' ? 'text-emerald-600' : v === 'EXPIRED' ? 'text-amber-600' : 'text-red-600');
  return (
    <div className="flex items-stretch gap-3">
      <div className="rounded-xl border border-slate-200 px-4 py-2 text-center dark:border-slate-800">
        <div className="label">Verifier said</div>
        <div className={`text-xl font-bold ${color(run.actual)}`}>{run.actual ?? '—'}</div>
        <div className="text-[11px] text-slate-500">expected {run.expected}</div>
      </div>
      <div className={`grid min-w-28 place-items-center rounded-xl px-5 py-2 text-center ${pass ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
        <div className="text-[11px] font-semibold uppercase opacity-90">Interop</div>
        <div className="text-2xl font-black">{pass ? 'PASS' : 'FAIL'}</div>
      </div>
    </div>
  );
}

function StageDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    done: 'bg-emerald-500', failed: 'bg-red-500', running: 'bg-sky-500 animate-pulse', waiting: 'bg-amber-500 animate-pulse', skipped: 'bg-slate-300 dark:bg-slate-600', pending: 'bg-slate-200 dark:bg-slate-700',
  };
  return <span className={`h-2.5 w-2.5 rounded-full ${map[status] ?? map.pending}`} title={status} />;
}

function Checks({ run }: { run: Run }) {
  const checks = run.outcome?.checks ?? run.outcomeChecks ?? [];
  return (
    <section className="card p-4">
      <div className="label mb-2">Verification checks</div>
      {run.error && <div className={`mb-3 rounded-lg p-3 text-sm ${run.result === 'PASS' ? 'bg-slate-100 dark:bg-slate-800' : 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'}`}>
        {run.failedStage && <b className="mr-1 uppercase">{run.failedStage}:</b>}{run.error}
      </div>}
      <ul className="space-y-1.5">
        {checks.map((c, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className={c.ok ? 'text-emerald-600' : 'text-red-600'}>{c.ok ? '✓' : '✗'}</span>
            <div className="min-w-0"><span className="font-medium">{c.name}</span>{c.detail && <div className="break-all text-xs text-slate-500">{c.detail}</div>}</div>
          </li>
        ))}
      </ul>
      {run.outcome?.claims && <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-slate-500">Claims the verifier saw</summary><JsonView value={run.outcome.claims} /></details>}
    </section>
  );
}

function ManualPanel({ run }: { run: Run }) {
  const i = run.interaction!;
  const waitingIssue = run.stages.issue.status === 'waiting';
  const uri = waitingIssue ? i.offerUri : i.authorizationRequestUri;
  return (
    <section className="card flex flex-wrap items-center gap-6 border-amber-300 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
      {uri && <div className="rounded-lg bg-white p-3"><QRCodeSVG value={uri} size={208} level="M" /></div>}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-lg font-semibold">{waitingIssue ? 'Scan the credential offer with Inji Wallet' : 'Scan the presentation request with Inji Wallet'}</div>
        <div className="text-sm text-slate-600 dark:text-slate-300">{i.prompt}</div>
        {waitingIssue && i.txCode && <div className="text-sm">Transaction code (PIN): <b className="font-mono text-lg tracking-widest">{i.txCode}</b></div>}
        <div className="break-all rounded bg-white/70 p-2 font-mono text-[11px] text-slate-500 dark:bg-slate-900">{uri}</div>
        {waitingIssue && <button className="btn-primary" onClick={() => api.signal(run.id)}>Credential received in the wallet →</button>}
      </div>
    </section>
  );
}

function EventDetail({ event, onClose }: { event: ProtocolEvent; onClose: () => void }) {
  return (
    <div className="h-[62%] shrink-0 overflow-auto border-t-2 border-brand-600 bg-slate-50 p-4 dark:bg-slate-950/40">
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{event.step}</div>
          <div className="text-xs text-slate-500">{event.summary}</div>
        </div>
        <button className="text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {event.request && (
        <div className="mb-3">
          <div className="label mb-1">Request · {event.request.method} {event.request.url}</div>
          {event.request.headers && Object.keys(event.request.headers).length > 0 && <JsonView value={event.request.headers} compact />}
          {event.request.body !== undefined && <JsonView value={event.request.body} />}
        </div>
      )}
      {event.response && (
        <div className="mb-3">
          <div className="label mb-1">Response · HTTP {event.response.status}{event.response.durationMs != null && ` · ${event.response.durationMs} ms`}</div>
          <JsonView value={event.response.body} />
        </div>
      )}
      {event.data && (
        <div>
          <div className="label mb-1">Decoded artefacts</div>
          <JsonView value={event.data} />
        </div>
      )}
    </div>
  );
}
