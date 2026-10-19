import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpRight, Ban, Check, CircleCheck, CircleX, Download, Gauge, Grid3x3, LoaderCircle, Play, Plus, Radio, X,
} from 'lucide-react';
import { api, withoutSuperseded, type Catalog, type Format, type Party, type RunSummary, type Tamper } from '../api';
import { useApp, useCatalog, usePartyLookup } from '../lib/app';
import { SCENARIOS, SCENARIO_IDS, scenarioOf, type ScenarioId } from '../lib/flow';
import { formatDuration, pluralize, relativeTime } from '../lib/format';
import { runHref } from '../lib/router';
import { Tooltip, useToast } from './overlays';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Select, Skeleton, Spinner, Stat, buttonClass, cn } from './ui';
import { FlowLabel, FormatBadge, ScenarioBadge, StatusIcon, VendorBadge, versionLabel } from './domain';

/** The matrix is always driven by the headless Reference Wallet. */
const SWEEP_WALLET = 'playground-wallet';

// ── Batches ──────────────────────────────────────────────────────────────────

/** Batch ids look like `batch-2026-10-18T00:47:40-3d04`; the timestamp is UTC. */
function batchTime(id: string) {
  const m = /^batch-(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/.exec(id);
  const t = m ? Date.parse(`${m[1]}Z`) : NaN;
  return Number.isNaN(t) ? undefined : t;
}
const BATCH_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const batchLabel = (id: string) => { const t = batchTime(id); return t == null ? id : BATCH_DATE.format(t); };

// ── Matrix model ─────────────────────────────────────────────────────────────

type Cell =
  | { kind: 'result'; run: RunSummary }
  | { kind: 'running'; run: RunSummary }
  | { kind: 'na'; reason: string }
  | { kind: 'empty' };

interface Group { verifier: Party; supported: boolean; cells: Cell[] }
interface Row { format: Format; groups: Group[] }
interface IssuerBlock { issuer: Party; rows: Row[] }
interface Failure { run: RunSummary; issuer: Party; verifier: Party; format: Format; scenario: ScenarioId; order: number[] }

const cellKey = (issuer: string, verifier: string, format: string, scenario: string) => `${issuer}|${verifier}|${format}|${scenario}`;

/** Why a scenario can't run for this issuer / verifier / format (mirrors the server's input validation). */
function notApplicable(catalog: Catalog, issuer: Party, verifier: Party, wallet: Party | undefined, f: Format, s: ScenarioId) {
  const short = catalog.formats[f]?.short ?? f;
  if (wallet && !wallet.formats.includes(f)) return `The Reference Wallet doesn’t handle ${short} credentials`;
  if (s === 'happy') return undefined;
  if (s === 'expired') return issuer.expiredIssuance?.includes(f) ? undefined : `${issuer.name} can’t issue an already-expired ${short} credential`;
  if (!catalog.tamperModes[s as Tamper]?.formats.includes(f)) return `The Reference Wallet can’t apply this tamper to ${short} credentials`;
  if (verifier.id === 'inji-verify-direct' && (s === 'replay' || s === 'wrong-holder')) return 'VC upload verifies the bare credential, so there is no holder proof to tamper with';
  return undefined;
}

function buildMatrix(catalog: Catalog, scenarios: ScenarioId[], scoped: RunSummary[]) {
  // Latest finished run per cell; a still-running run only shows where nothing has finished yet.
  const finished = new Map<string, RunSummary>();
  const running = new Map<string, RunSummary>();
  for (const r of scoped) {
    const map = r.state === 'running' ? running : finished;
    const k = cellKey(r.issuer, r.verifier, r.format, scenarioOf(r));
    const cur = map.get(k);
    if (!cur || r.createdAt > cur.createdAt) map.set(k, r);
  }

  const formats = Object.keys(catalog.formats) as Format[];
  const issuers = catalog.parties.filter((p) => p.role === 'issuer');
  const verifiers = catalog.parties.filter((p) => p.role === 'verifier' && p.mode === 'auto');
  const wallet = catalog.parties.find((p) => p.id === SWEEP_WALLET);

  let passed = 0, failed = 0, active = 0, applicable = 0, covered = 0;
  const applicableBy = Object.fromEntries(scenarios.map((s) => [s, 0])) as Record<ScenarioId, number>;
  const failures: Failure[] = [];
  const tally = Object.fromEntries(verifiers.map((v) => [v.id, { passed: 0, failed: 0 }]));

  const blocks: IssuerBlock[] = issuers.map((issuer, ii) => ({
    issuer,
    rows: formats.filter((f) => issuer.formats.includes(f)).map((format) => ({
      format,
      groups: verifiers.map((verifier, vi) => {
        const supported = verifier.formats.includes(format);
        const cells = scenarios.map((scenario, si): Cell => {
          if (!supported) return { kind: 'empty' };
          const reason = notApplicable(catalog, issuer, verifier, wallet, format, scenario);
          if (!reason) applicableBy[scenario]++;
          const k = cellKey(issuer.id, verifier.id, format, scenario);
          const run = finished.get(k);
          if (run) {
            if (run.result === 'PASS') { passed++; tally[verifier.id].passed++; }
            else {
              failed++;
              tally[verifier.id].failed++;
              failures.push({ run, issuer, verifier, format, scenario, order: [vi, si, ii, formats.indexOf(format)] });
            }
            if (!reason) { applicable++; covered++; }
            return { kind: 'result', run };
          }
          if (reason) return { kind: 'na', reason };
          applicable++;
          const live = running.get(k);
          if (live) { active++; return { kind: 'running', run: live }; }
          return { kind: 'empty' };
        });
        return { verifier, supported, cells };
      }),
    })),
  }));

  failures.sort((a, b) => a.order.reduce((d, x, i) => d || x - b.order[i], 0));
  return { blocks, verifiers, tally, failures, applicableBy, stats: { passed, failed, active, results: passed + failed, applicable, covered } };
}

// ── View ─────────────────────────────────────────────────────────────────────

export function MatrixView() {
  const catalog = useCatalog();
  const { runs, runsLoaded, sweep, setSweep } = useApp();
  const toast = useToast();

  const scenarios = useMemo(() => SCENARIO_IDS.filter((id) => catalog.scenarios.some((s) => s.id === id)), [catalog]);
  const [selected, setSelected] = useState<ScenarioId[]>(scenarios);
  const [scopeValue, setScope] = useState('latest');
  const [starting, setStarting] = useState(false);

  const batches = useMemo(() => [...new Set(runs.map((r) => r.batchId).filter(Boolean) as string[])].sort().reverse(), [runs]);
  const scope = scopeValue === 'all' || batches.includes(scopeValue) ? scopeValue : 'latest';
  const batchId = scope === 'all' ? undefined : scope === 'latest' ? batches[0] : scope;
  const scoped = useMemo(() => withoutSuperseded(batchId ? runs.filter((r) => r.batchId === batchId) : runs), [runs, batchId]);

  const model = useMemo(() => buildMatrix(catalog, scenarios, scoped), [catalog, scenarios, scoped]);
  const plannedRuns = selected.reduce((n, s) => n + (model.applicableBy[s] ?? 0), 0);

  const scopeOptions = useMemo(() => [
    { value: 'latest', label: batches[0] ? `Latest sweep (${batchLabel(batches[0])})` : 'Latest sweep' },
    { value: 'all', label: 'All runs (latest per cell)' },
    ...batches.map((b) => {
      const done = withoutSuperseded(runs.filter((r) => r.batchId === b)).filter((r) => r.state !== 'running');
      const passed = done.filter((r) => r.result === 'PASS').length;
      return { value: b, label: `${batchLabel(b)} · ${passed}/${done.length} passed` };
    }),
  ], [batches, runs]);

  // Tell the user how a sweep went when it finishes while they're watching.
  const prevSweep = useRef(sweep);
  useEffect(() => {
    const prev = prevSweep.current;
    prevSweep.current = sweep;
    if (!prev || sweep) return;
    const done = withoutSuperseded(runs.filter((r) => r.batchId === prev.batchId)).filter((r) => r.state !== 'running');
    if (!done.length) return;
    const failed = done.filter((r) => r.result !== 'PASS').length;
    toast({
      tone: failed ? 'warning' : 'success',
      title: 'Sweep finished',
      description: `${done.length - failed} of ${pluralize(done.length, 'run')} passed${failed ? ` · ${failed} failed` : ''}`,
    });
  }, [sweep]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setStarting(true);
    try {
      const p = await api.startMatrix({ scenarios: selected });
      setSweep(p);
      setScope('latest');
      toast({ tone: 'info', title: 'Sweep started', description: `${pluralize(p.total, 'run')} queued. Cells fill in as each one finishes.` });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/already running|409/i.test(message)) {
        toast({ tone: 'danger', title: 'A sweep is already running', description: 'Wait for it to finish before starting another.' });
        api.matrix().then(setSweep).catch(() => {});
      } else {
        toast({ tone: 'danger', title: 'Couldn’t start the sweep', description: message });
      }
    } finally {
      setStarting(false);
    }
  };

  const runButton = (
    <Button variant="primary" icon={Play} loading={!!sweep || starting} disabled={!selected.length} onClick={start} className="tabular-nums">
      {sweep ? `Sweeping ${sweep.done}/${sweep.total}` : starting ? 'Starting…' : 'Run sweep'}
    </Button>
  );

  const hasRuns = scoped.length > 0;
  const reportHref = `/api/report.md${scope === 'all' ? '' : `?batch=${encodeURIComponent(batchId ?? '')}`}`;
  const reportName = `interop-report-${batchId ? batchId.replace(/^batch-/, '').replace(/:/g, '') : 'all-runs'}.md`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Interop matrix"
        description="Runs every issuer × verifier × format × scenario the Reference Wallet can drive against the live services. A cell passes when the verifier reaches the verdict the scenario calls for."
        actions={
          // Full-width row on phones so the description isn't squeezed into a one-word column beside the buttons.
          <div className="flex w-[calc(100vw-2rem)] items-center gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">
            <a href={reportHref} download={reportName} aria-disabled={!hasRuns || undefined} tabIndex={hasRuns ? undefined : -1}
              className={cn(buttonClass('secondary'), !hasRuns && 'pointer-events-none opacity-50')}>
              <Download size={16} aria-hidden />Export report
            </a>
            {runButton}
          </div>
        }
      />

      {sweep && <SweepProgress sweep={sweep} runs={runs} />}

      <SweepSettings scenarios={scenarios} selected={selected} onChange={setSelected} plannedRuns={plannedRuns} />

      {!runsLoaded ? <MatrixSkeleton /> : !hasRuns ? (
        <Card>
          <EmptyState icon={Grid3x3} title="No runs to show yet"
            description="Run a sweep to drive every issuer, verifier, format and scenario combination through the Reference Wallet. Each result lands in the matrix as soon as it finishes."
            action={runButton} />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex w-full min-w-0 items-center gap-2.5 sm:w-auto">
              <span className="shrink-0 text-sm text-fg-muted">Showing</span>
              <Select label="Results to show" hideLabel value={scope} onChange={setScope} options={scopeOptions} className="min-w-0 flex-1 sm:w-[330px] sm:flex-none" />
            </div>
            <ScopeMeta scoped={scoped} batchId={batchId} live={!!sweep && (!batchId || batchId === sweep.batchId)} />
          </div>

          <SummaryStats stats={model.stats} failures={model.failures} />

          <Card className="overflow-hidden">
            <MatrixTable catalog={catalog} scenarios={scenarios} blocks={model.blocks} verifiers={model.verifiers} tally={model.tally} />
            <Legend running={model.stats.active > 0} scenarios={scenarios} />
          </Card>

          {model.failures.length ? <FailuresCard failures={model.failures} catalog={catalog} />
            : model.stats.results > 0 && (
              <Alert tone="success" icon={CircleCheck} title="No failures">
                Every cell {sweep && batchId === sweep.batchId ? 'run so far' : 'in this scope'} reached the verdict its scenario calls for.
              </Alert>
            )}
        </>
      )}
    </div>
  );
}

// ── Sweep controls ───────────────────────────────────────────────────────────

function SweepSettings({ scenarios, selected, onChange, plannedRuns }: {
  scenarios: ScenarioId[]; selected: ScenarioId[]; onChange: (s: ScenarioId[]) => void; plannedRuns: number;
}) {
  const toggle = (id: ScenarioId) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : scenarios.filter((x) => x === id || selected.includes(x)));
  return (
    <Card className="px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 lg:w-48 lg:flex-none">
          <h2 className="text-sm font-semibold text-fg">Sweep scenarios</h2>
          <p className="mt-0.5 text-xs tabular-nums text-fg-subtle">
            {selected.length ? `Next sweep: ${pluralize(plannedRuns, 'run')}` : 'Pick at least one scenario'}
          </p>
        </div>
        <div role="group" aria-label="Scenarios to include in the next sweep" className="order-last flex w-full flex-wrap gap-1.5 lg:order-none lg:w-auto lg:min-w-0 lg:flex-1">
          {scenarios.map((id) => {
            const s = SCENARIOS[id];
            const on = selected.includes(id);
            return (
              <Tooltip key={id} content={<>{s.description}<span className="opacity-70"> · expects {s.expected}</span></>}>
                <button type="button" aria-pressed={on} onClick={() => toggle(id)}
                  className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-[13px] font-medium ring-1 ring-inset transition-colors',
                    on ? 'bg-brand-soft text-brand-soft-fg ring-brand/35 hover:ring-brand/60' : 'bg-surface text-fg-muted ring-line-strong hover:bg-hover hover:text-fg')}>
                  <s.icon size={14} aria-hidden className="shrink-0" />
                  {s.label}
                  <span aria-hidden className={cn('ml-0.5 grid h-4 w-4 place-items-center rounded-full transition-colors', on ? 'bg-brand text-brand-contrast' : 'text-fg-subtle')}>
                    {on ? <Check size={10} strokeWidth={3.5} /> : <Plus size={12} strokeWidth={2.5} />}
                  </span>
                </button>
              </Tooltip>
            );
          })}
        </div>
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost" onClick={() => onChange(scenarios)} disabled={selected.length === scenarios.length}>All</Button>
          <Button size="xs" variant="ghost" onClick={() => onChange([])} disabled={!selected.length}>None</Button>
        </div>
      </div>
    </Card>
  );
}

function SweepProgress({ sweep, runs }: { sweep: { batchId: string; total: number; done: number }; runs: RunSummary[] }) {
  const catalog = useCatalog();
  const { name } = usePartyLookup();
  const pct = Math.min(100, Math.round((100 * sweep.done) / Math.max(1, sweep.total)));
  const batchRuns = runs.filter((r) => r.batchId === sweep.batchId);
  const current = batchRuns.find((r) => r.state === 'running');
  const failedSoFar = withoutSuperseded(batchRuns).filter((r) => r.state !== 'running' && r.result !== 'PASS').length;

  const startedAt = batchTime(sweep.batchId) ?? Math.min(...batchRuns.map((r) => Date.parse(r.createdAt)));
  const elapsed = Date.now() - startedAt;
  const left = sweep.done >= 3 && Number.isFinite(elapsed) ? (elapsed / sweep.done) * (sweep.total - sweep.done) : undefined;
  const eta = left == null ? undefined : left < 60_000 ? 'Less than a minute left' : `About ${Math.round(left / 60_000)} min left`;

  return (
    <Card className="px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <Spinner size={15} className="shrink-0 text-brand" />
        <div className="min-w-0 flex-1 truncate text-sm font-semibold tabular-nums text-fg">
          Running sweep <span className="font-normal text-fg-subtle">·</span> {sweep.done} of {pluralize(sweep.total, 'run')}
        </div>
        <div className="text-sm font-semibold tabular-nums text-fg">{pct}%</div>
      </div>
      <div role="progressbar" aria-label="Sweep progress" aria-valuemin={0} aria-valuemax={sweep.total} aria-valuenow={sweep.done}
        className="mt-2.5 h-2 overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-line">
        <div className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out" style={{ width: `${Math.max(pct, 1)}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-subtle">
        {current ? (
          <span className="flex min-w-0 max-w-full items-center gap-1.5">
            <span className="hidden shrink-0 sm:inline">Now running</span>
            <a href={runHref(current.id)} className="flex min-w-0 items-center gap-1.5 font-medium text-fg-muted hover:text-fg hover:underline">
              <FlowLabel run={current} name={name} showWallet={false} className="min-w-0" />
              <span className="shrink-0">· {catalog.formats[current.format]?.short ?? current.format} · {SCENARIOS[scenarioOf(current)].label}</span>
            </a>
          </span>
        ) : <span>Results fill in below as each run finishes</span>}
        {failedSoFar > 0 && <span className="font-medium text-danger-fg">{failedSoFar} failed so far</span>}
        {eta && <span className="tabular-nums sm:ml-auto">{eta}</span>}
      </div>
    </Card>
  );
}

// ── Summary ──────────────────────────────────────────────────────────────────

function ScopeMeta({ scoped, batchId, live }: { scoped: RunSummary[]; batchId?: string; live: boolean }) {
  const finished = scoped.filter((r) => r.state !== 'running');
  const first = scoped.reduce<string | undefined>((m, r) => (!m || r.createdAt < m ? r.createdAt : m), undefined);
  const last = finished.reduce<string | undefined>((m, r) => { const t = r.finishedAt ?? r.createdAt; return !m || t > m ? t : m; }, undefined);
  const parts = [pluralize(finished.length, batchId ? 'run' : 'finished run')];
  if (batchId && first) parts.push(`started ${relativeTime(first)}`);
  if (batchId && first && last && !live) parts.push(`took ${formatDuration(Date.parse(last) - Date.parse(first))}`);
  if (!batchId) parts.push('each cell shows its most recent result');
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-fg-subtle">
      {live && <Badge tone="info" size="xs" icon={Radio}>Live</Badge>}
      <span className="truncate tabular-nums">{parts.join(' · ')}</span>
    </div>
  );
}

function SummaryStats({ stats, failures }: { stats: ReturnType<typeof buildMatrix>['stats']; failures: Failure[] }) {
  const { passed, failed, results, applicable, covered } = stats;
  const rate = results ? (100 * passed) / results : 0;
  const failingVerifiers = [...new Set(failures.map((f) => f.verifier.name))];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Passed" icon={CircleCheck} value={passed} tone={passed ? 'success' : undefined}
        hint="Verdict as expected" />
      <Stat label="Failed" icon={CircleX} value={failed} tone={failed ? 'danger' : undefined}
        hint={!failed ? 'Nothing to investigate' : failingVerifiers.length === 1 ? `All on ${failingVerifiers[0]}` : `Across ${failingVerifiers.length} verifiers`} />
      <Stat label="Pass rate" icon={Gauge} value={results ? `${rate === 100 ? '100' : rate.toFixed(1)}%` : '—'}
        hint={`${passed} of ${pluralize(results, 'cell')}`} />
      <Stat label="Coverage" icon={Grid3x3}
        value={<>{covered}<span className="text-base font-medium text-fg-subtle">/{applicable}</span></>}
        hint={covered >= applicable ? 'Nothing left to run' : `${pluralize(applicable - covered, 'cell')} not run yet`} />
    </div>
  );
}

// ── Matrix table ─────────────────────────────────────────────────────────────

// The issuer and format columns stay pinned while the scenario columns scroll on narrow screens.
const ISSUER_COL = 'w-[100px] sm:w-[200px]';
const FORMAT_COL = 'w-[84px] sm:w-[104px]';
const STICKY_ISSUER = 'sticky left-0 z-10';
const STICKY_FORMAT = 'sticky left-[100px] z-10 sm:left-[200px]';
const CELL = 'mx-auto grid h-7 w-7 place-items-center rounded-md';

function MatrixTable({ catalog, scenarios, blocks, verifiers, tally }: {
  catalog: Catalog; scenarios: ScenarioId[]; blocks: IssuerBlock[]; verifiers: Party[]; tally: Record<string, { passed: number; failed: number }>;
}) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[860px] table-fixed border-separate border-spacing-0 text-sm sm:min-w-[1000px]">
        <caption className="sr-only">Interop results by issuer and credential format (rows) against verifier and scenario (columns)</caption>
        <colgroup>
          <col className={ISSUER_COL} />
          <col className={FORMAT_COL} />
          {verifiers.flatMap((v) => scenarios.map((s) => <col key={`${v.id}-${s}`} />))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" rowSpan={2} className={cn(STICKY_ISSUER, 'border-b border-line bg-sunken px-3 pb-2.5 text-left align-bottom sm:px-4')}>
              <span className="eyebrow">Issuer</span>
            </th>
            <th scope="col" rowSpan={2} className={cn(STICKY_FORMAT, 'border-b border-r border-line border-r-line-strong bg-sunken px-2.5 pb-2.5 text-left align-bottom sm:px-3')}>
              <span className="eyebrow">Format</span>
            </th>
            {verifiers.map((v, i) => (
              <th key={v.id} scope="colgroup" colSpan={scenarios.length}
                className={cn('bg-sunken px-3 pb-1.5 pt-3 text-left align-top font-normal', i > 0 && 'border-l border-line-strong')}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-[13px] font-semibold text-fg" title={v.name}>{v.name}</span>
                  <VerifierTally {...tally[v.id]} />
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <VendorBadge party={v} />
                  {versionLabel(v) && <span className="text-[11px] tabular-nums text-fg-subtle">{versionLabel(v)}</span>}
                  <span className="truncate text-[11px] text-fg-subtle">{v.protocol.split(' · ')[0]}</span>
                </div>
              </th>
            ))}
          </tr>
          <tr>
            {verifiers.flatMap((v, vi) => scenarios.map((id, si) => {
              const s = SCENARIOS[id];
              return (
                <th key={`${v.id}-${id}`} scope="col" className={cn('border-b border-line bg-sunken px-0 pb-2 pt-1 font-normal', vi > 0 && si === 0 && 'border-l border-line-strong')}>
                  <Tooltip content={<><div className="font-semibold">{s.label}</div><div className="opacity-80">{s.description}</div><div className="mt-1 opacity-70">Expected verdict: {s.expected}</div></>}>
                    <span className="mx-auto flex w-fit cursor-default flex-col items-center gap-0.5 rounded px-1 text-fg-subtle hover:text-fg">
                      <s.icon size={14} aria-hidden />
                      <span aria-hidden className="text-[10px] font-semibold tracking-wide">{s.short}</span>
                      <span className="sr-only">{s.label}</span>
                    </span>
                  </Tooltip>
                </th>
              );
            }))}
          </tr>
        </thead>
        {blocks.map(({ issuer, rows }, bi) => (
          <tbody key={issuer.id}>
            {rows.map(({ format, groups }, ri) => {
              const rule = bi > 0 && ri === 0 ? 'border-t border-line-strong' : ri > 0 ? 'border-t border-line' : '';
              const formatMeta = catalog.formats[format];
              return (
                <tr key={format} className="group">
                  {ri === 0 && (
                    <th scope="rowgroup" rowSpan={rows.length} className={cn(STICKY_ISSUER, rule, 'bg-surface px-3 py-3 text-left align-top font-normal sm:px-4')}>
                      <div className="text-[13px] font-semibold leading-snug text-fg">{issuer.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        <VendorBadge party={issuer} />
                        {versionLabel(issuer) && <span className="text-[11px] tabular-nums text-fg-subtle">{versionLabel(issuer)}</span>}
                      </div>
                    </th>
                  )}
                  <th scope="row" className={cn(STICKY_FORMAT, rule, 'border-r border-r-line-strong bg-surface px-2.5 text-left font-normal transition-colors group-hover:bg-sunken sm:px-3')}>
                    <Tooltip content={formatMeta?.label}>
                      <span className="cursor-default whitespace-nowrap text-[13px] font-medium text-fg">{formatMeta?.short ?? format}</span>
                    </Tooltip>
                  </th>
                  {groups.map(({ verifier, supported, cells }, gi) => supported ? cells.map((cell, si) => (
                    <td key={`${verifier.id}-${scenarios[si]}`}
                      className={cn(rule, 'px-0 py-2 text-center transition-colors group-hover:bg-sunken', gi > 0 && si === 0 && 'border-l border-l-line-strong')}>
                      <MatrixCell cell={cell} issuer={issuer} verifier={verifier} format={format} scenario={scenarios[si]} catalog={catalog} />
                    </td>
                  )) : (
                    <td key={verifier.id} colSpan={cells.length} className={cn(rule, 'px-2 py-2 transition-colors group-hover:bg-sunken', gi > 0 && 'border-l border-l-line-strong')}>
                      <Tooltip content={`${verifier.name} doesn’t accept ${formatMeta?.short ?? format} credentials`}>
                        <div className="flex h-7 cursor-default items-center justify-center gap-1.5 rounded-md bg-sunken text-xs text-fg-subtle ring-1 ring-inset ring-line">
                          <Ban size={12} aria-hidden />Not supported
                        </div>
                      </Tooltip>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** "6 failed" / "18/18 passed" next to a verifier's name, so a failing column group stands out. */
function VerifierTally({ passed, failed }: { passed: number; failed: number }) {
  if (!passed && !failed) return null;
  return failed
    ? <Badge tone="danger" size="xs" icon={CircleX} className="ml-auto tabular-nums">{failed} failed</Badge>
    : <Badge tone="success" size="xs" icon={CircleCheck} className="ml-auto tabular-nums">{passed}/{passed} passed</Badge>;
}

function MatrixCell({ cell, issuer, verifier, format, scenario, catalog }: {
  cell: Cell; issuer: Party; verifier: Party; format: Format; scenario: ScenarioId; catalog: Catalog;
}) {
  const s = SCENARIOS[scenario];
  const where = `${issuer.name} · ${catalog.formats[format]?.short ?? format} → ${verifier.name}`;

  if (cell.kind === 'na' || cell.kind === 'empty') {
    const na = cell.kind === 'na';
    return (
      <Tooltip content={<TipBody title={s.label} status={na ? 'N/A' : 'Not run'} where={where}>{na ? cell.reason : 'No result in this scope yet'}</TipBody>}>
        <span role="img" aria-label={`${s.label}, ${where}: ${na ? `not applicable — ${cell.reason}` : 'not run yet'}`}
          className={cn(CELL, !na && 'border border-dashed border-line-strong')}>
          {na && <span className="h-0.5 w-2.5 rounded-full bg-line-strong" />}
        </span>
      </Tooltip>
    );
  }

  const r = cell.run;
  if (cell.kind === 'running') {
    return (
      <Tooltip content={<TipBody title={s.label} status="Running" where={where}>Waiting for the verifier’s verdict<div className="mt-1 opacity-60">Click to watch the run</div></TipBody>}>
        <a href={runHref(r.id)} aria-label={`${s.label}, ${where}: running`} className={cn(CELL, 'bg-info-soft text-info ring-1 ring-inset ring-info/25')}>
          <LoaderCircle size={14} strokeWidth={2.5} className="animate-spin" aria-hidden />
        </a>
      </Tooltip>
    );
  }

  const pass = r.result === 'PASS';
  const verdictLine = r.actual ? `Verifier returned ${r.actual} · expected ${r.expected}` : `No verdict${r.failedStage ? ` — failed during ${r.failedStage}` : ''} · expected ${r.expected}`;
  return (
    <Tooltip content={
      <TipBody title={s.label} status={pass ? 'PASS' : 'FAIL'} where={where}>
        <div className="font-medium">{verdictLine}</div>
        {r.error && !r.actual && <div className="mt-0.5 line-clamp-3 break-words opacity-80">{r.error}</div>}
        <div className="mt-1 opacity-60">Click to open run</div>
      </TipBody>
    }>
      <a key={r.id} href={runHref(r.id)} aria-label={`${s.label}, ${where}: ${pass ? 'passed' : 'failed'}. ${verdictLine}. Open run`}
        className={cn(CELL, 'animate-pop-in transition-[box-shadow,opacity]',
          pass ? 'bg-success-soft text-success ring-1 ring-inset ring-success/20 hover:ring-success/60'
            : 'bg-danger text-white shadow-sm hover:opacity-90 hover:ring-2 hover:ring-danger/30 hover:ring-offset-1 hover:ring-offset-surface')}>
        {pass ? <Check size={15} strokeWidth={2.75} aria-hidden /> : <X size={15} strokeWidth={2.75} aria-hidden />}
      </a>
    </Tooltip>
  );
}

const TIP_STATUS: Record<string, string> = {
  PASS: 'bg-success text-white',
  FAIL: 'bg-danger text-white',
  Running: 'bg-info text-white',
};

/** Tooltip layout for a matrix cell (the bubble is inverted, so status uses solid fills). */
function TipBody({ title, status, where, children }: { title: string; status: string; where: string; children: ReactNode }) {
  return (
    <div className="py-0.5">
      <div className="flex items-center gap-2">
        <span className="font-semibold">{title}</span>
        <span className={cn('ml-auto rounded px-1.5 py-px text-[10px] font-bold tracking-wide', TIP_STATUS[status] ?? 'bg-surface/15')}>{status}</span>
      </div>
      <div className="mb-1 mt-0.5 opacity-60">{where}</div>
      {children}
    </div>
  );
}

function Legend({ running, scenarios }: { running: boolean; scenarios: ScenarioId[] }) {
  const items: Array<{ swatch: ReactNode; label: string }> = [
    { swatch: <span className="grid h-4 w-4 place-items-center rounded bg-success-soft text-success ring-1 ring-inset ring-success/20"><Check size={11} strokeWidth={3} /></span>, label: 'Pass' },
    { swatch: <span className="grid h-4 w-4 place-items-center rounded bg-danger text-white"><X size={11} strokeWidth={3} /></span>, label: 'Fail' },
    ...(running ? [{ swatch: <span className="grid h-4 w-4 place-items-center rounded bg-info-soft text-info"><LoaderCircle size={10} strokeWidth={3} className="animate-spin" /></span>, label: 'Running' }] : []),
    { swatch: <span className="h-4 w-4 rounded border border-dashed border-line-strong" />, label: 'Not run yet' },
    { swatch: <span className="grid h-4 w-4 place-items-center"><span className="h-0.5 w-2 rounded-full bg-line-strong" /></span>, label: 'Not applicable' },
    { swatch: <span className="h-4 w-6 rounded bg-sunken ring-1 ring-inset ring-line" />, label: 'Not supported by verifier' },
  ];
  return (
    <div className="space-y-2.5 border-t border-line px-4 py-3 text-xs text-fg-subtle">
      <ul aria-label="Legend" className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {items.map((it) => <li key={it.label} className="flex items-center gap-2"><span aria-hidden className="flex">{it.swatch}</span>{it.label}</li>)}
        <li className="hidden text-fg-subtle/80 lg:ml-auto lg:block">Hover a cell for details · click to open its run</li>
      </ul>
      <ul aria-label="Scenarios" className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {scenarios.map((id) => {
          const s = SCENARIOS[id];
          return (
            <li key={id} className="flex items-center gap-1.5">
              <s.icon size={12} aria-hidden />
              <span className="font-semibold text-fg-muted">{s.short}</span>
              <span>{s.label}</span>
              <span className="font-mono text-[10.5px] text-fg-subtle/80">→ {s.expected}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Failures ─────────────────────────────────────────────────────────────────

function FailuresCard({ failures, catalog }: { failures: Failure[]; catalog: Catalog }) {
  const { name } = usePartyLookup();
  return (
    <Card>
      <CardHeader icon={CircleX}
        title={<span className="flex items-center gap-2">Failures<Badge tone="danger" size="xs" className="tabular-nums">{failures.length}</Badge></span>}
        description="Cells where the verifier didn’t reach the verdict the scenario calls for, grouped by verifier and scenario." />
      <ul className="sm:grid sm:grid-cols-[auto_auto_auto_auto_minmax(0,1fr)_auto] sm:gap-x-4">
        {failures.map(({ run: r, format, scenario }, i) => (
          <li key={r.id} className={cn('flex items-start gap-3 px-4 py-3 sm:col-span-full sm:grid sm:grid-cols-subgrid sm:items-center sm:gap-y-0 sm:py-2.5', i > 0 && 'border-t border-line')}>
            <span className="mt-0.5 sm:mt-0"><StatusIcon run={r} /></span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:contents">
              <FlowLabel run={r} name={name} showWallet={false} className="text-[13px] font-medium text-fg" />
              <div className="flex flex-wrap items-center gap-1.5 sm:contents">
                <span className="flex"><FormatBadge format={format} catalog={catalog} /></span>
                <span className="flex"><ScenarioBadge scenario={scenario} /></span>
                <span className="order-last min-w-0 basis-full text-xs text-fg-muted sm:order-none sm:basis-auto">
                  {r.actual ? (
                    <>Verifier returned <span className="font-mono font-semibold text-fg">{r.actual}</span> · expected <span className="font-mono font-semibold text-fg">{r.expected}</span></>
                  ) : (
                    <span className="block truncate" title={r.error}>Failed during {r.failedStage ?? 'the run'}{r.error ? ` · ${r.error}` : ''}</span>
                  )}
                </span>
                <a href={runHref(r.id)} className={cn(buttonClass('ghost', 'xs'), 'ml-auto -mr-1.5 text-fg-muted sm:ml-0')}
                  aria-label={`Open run: ${SCENARIOS[scenario].label}, ${name(r.issuer)} to ${name(r.verifier)}`}>
                  Open run<ArrowUpRight size={13} aria-hidden />
                </a>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── Loading ──────────────────────────────────────────────────────────────────

function MatrixSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading results">
      <Skeleton className="h-9 w-80 max-w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[86px]" />)}
      </div>
      <Card className="p-4"><Skeleton className="h-72 w-full" /></Card>
    </div>
  );
}
