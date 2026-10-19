import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import {
  Activity, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, CircleCheck, CircleX, Download, FlaskConical,
  History as HistoryIcon, SearchX, SlidersHorizontal, Timer, Trash2, X,
} from 'lucide-react';
import { api, type RunSummary } from '../api';
import { useApp, useCatalog, usePartyLookup } from '../lib/app';
import { SCENARIOS, SCENARIO_IDS, scenarioOf, type ScenarioId } from '../lib/flow';
import { absoluteTime, formatDuration, pluralize, relativeTime, shortId, useNow } from '../lib/format';
import { openRun, routeHref, runHref } from '../lib/router';
import { ConfirmDialog, Tooltip, useToast } from './overlays';
import { FlowLabel, FormatBadge, ResultBadge, ScenarioBadge, StatusIcon, VerdictBadge, runStatus, type RunStatus } from './domain';
import { Badge, Button, Card, EmptyState, PageHeader, SearchInput, Select, Skeleton, Stat, buttonClass, cn, type Tone } from './ui';

const PAGE_SIZE = 25;

interface Filters {
  issuer: string;
  verifier: string;
  format: string;
  scenario: '' | ScenarioId;
  outcome: '' | RunStatus;
  version: string;
}
type SortKey = 'when' | 'duration';
interface Sort { key: SortKey; dir: 'asc' | 'desc' }

const NO_FILTERS: Filters = { issuer: '', verifier: '', format: '', scenario: '', outcome: '', version: '' };
const DEFAULT_SORT: Sort = { key: 'when', dir: 'desc' };

/** Kept across route changes, so "open a run → back" lands on the same filtered page. */
let remembered = { filters: NO_FILTERS, query: '', sort: DEFAULT_SORT, page: 0 };

const OUTCOMES: Array<{ value: RunStatus; label: string }> = [
  { value: 'pass', label: 'Pass' },
  { value: 'fail', label: 'Fail' },
  { value: 'error', label: 'Error' },
  { value: 'running', label: 'Running' },
];

/** "83%", but never rounds a near-perfect rate up to 100% (or a single pass down to 0%). */
function percent(part: number, whole: number) {
  if (part === whole) return 100;
  return Math.max(part ? 1 : 0, Math.min(99, Math.round((100 * part) / whole)));
}

/** True from Tailwind's `sm` breakpoint up. */
function useWide() {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia('(min-width: 640px)'); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
    () => matchMedia('(min-width: 640px)').matches,
  );
}

export function HistoryView() {
  const { runs, runsLoaded, reloadRuns } = useApp();
  const catalog = useCatalog();
  const { name } = usePartyLookup();
  const now = useNow();
  const toast = useToast();
  const wide = useWide();

  const [filters, setFilters] = useState(remembered.filters);
  const [query, setQuery] = useState(remembered.query);
  const [sort, setSort] = useState(remembered.sort);
  const [page, setPage] = useState(remembered.page);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const listRef = useRef<HTMLElement>(null);
  useEffect(() => { remembered = { filters, query, sort, page }; }, [filters, query, sort, page]);

  // Rows that arrive over the WebSocket while the view is open get a brief highlight.
  const known = useRef<Set<string>>();
  if (runsLoaded && !known.current) known.current = new Set(runs.map((r) => r.id));
  useEffect(() => {
    const t = setTimeout(() => runs.forEach((r) => known.current?.add(r.id)), 1500);
    return () => clearTimeout(t);
  }, [runs]);
  const isFresh = (id: string) => !!known.current && !known.current.has(id);

  // Same derivation as before: "<party name> <version>" for every non-playground module in the run.
  const versionsOf = useCallback(
    (r: RunSummary) => Object.entries(r.versions ?? {}).filter(([, v]) => v !== 'playground').map(([k, v]) => `${name(k)} ${v}`),
    [name],
  );

  const options = useMemo(() => {
    const parties = (role: 'issuer' | 'verifier') => catalog.parties.filter((p) => p.role === role).map((p) => ({ value: p.id, label: p.name }));
    return {
      issuer: [{ value: '', label: 'All issuers' }, ...parties('issuer')],
      verifier: [{ value: '', label: 'All verifiers' }, ...parties('verifier')],
      format: [{ value: '', label: 'All formats' }, ...Object.entries(catalog.formats).map(([k, v]) => ({ value: k, label: v.short }))],
      scenario: [{ value: '' as const, label: 'All scenarios' }, ...SCENARIO_IDS.map((id) => ({ value: id, label: SCENARIOS[id].label }))],
      outcome: [{ value: '' as const, label: 'All outcomes' }, ...OUTCOMES],
      version: [{ value: '', label: 'All versions' }, ...[...new Set(runs.flatMap(versionsOf))].sort().map((v) => ({ value: v, label: v }))],
    };
  }, [catalog, runs, versionsOf]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => runs.filter((r) =>
    (!filters.issuer || r.issuer === filters.issuer) &&
    (!filters.verifier || r.verifier === filters.verifier) &&
    (!filters.format || r.format === filters.format) &&
    (!filters.scenario || scenarioOf(r) === filters.scenario) &&
    (!filters.outcome || runStatus(r) === filters.outcome) &&
    (!filters.version || versionsOf(r).includes(filters.version)) &&
    (!q || r.id.toLowerCase().startsWith(q) ||
      [r.issuer, r.wallet, r.verifier].some((id) => name(id).toLowerCase().includes(q)) ||
      !!r.error?.toLowerCase().includes(q) || !!r.proofType?.toLowerCase().includes(q))),
  [runs, filters, q, name, versionsOf]);

  const sorted = useMemo(() => {
    const t = (r: RunSummary) => Date.parse(r.createdAt) || 0;
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort.key === 'when') return sign * (t(a) - t(b));
      const [da, db] = [a.durationMs, b.durationMs];
      if (da == null || db == null) return da == null && db == null ? t(b) - t(a) : da == null ? 1 : -1; // unfinished last
      return da !== db ? sign * (da - db) : t(b) - t(a);
    });
  }, [filtered, sort]);

  const stats = useMemo(() => {
    const done = filtered.filter((r) => r.state !== 'running');
    const count = (s: RunStatus) => done.filter((r) => runStatus(r) === s).length;
    const durations = done.map((r) => r.durationMs).filter((d): d is number => d != null);
    return {
      done: done.length,
      running: filtered.length - done.length,
      pass: count('pass'),
      fail: count('fail'),
      error: count('error'),
      avg: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : undefined,
      slowest: durations.length ? Math.max(...durations) : undefined,
      latest: filtered.reduce<string | undefined>((m, r) => (!m || r.createdAt > m ? r.createdAt : m), undefined),
    };
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const pageRuns = sorted.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const selectCount = Object.values(filters).filter(Boolean).length;
  const activeCount = selectCount + (q ? 1 : 0);
  const loading = !runsLoaded;

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => { setFilters((f) => ({ ...f, [key]: value })); setPage(0); };
  const setSearch = (v: string) => { setQuery(v); setPage(0); };
  const clearFilters = () => { setFilters(NO_FILTERS); setQuery(''); setPage(0); };
  const toggleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));
    setPage(0);
  };
  const goToPage = (p: number) => {
    setPage(p);
    const el = listRef.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' });
  };

  const clearHistory = async () => {
    const n = runs.length;
    setClearing(true);
    try {
      await api.clearRuns();
      reloadRuns();
      clearFilters();
      setConfirmOpen(false);
      toast({ title: 'Run history cleared', description: `Deleted ${pluralize(n, 'run')}.` });
    } catch (e) {
      toast({ tone: 'danger', title: 'Couldn’t clear run history', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setClearing(false);
    }
  };

  const failures = stats.fail + stats.error;
  const passTone: Tone = stats.pass === stats.done ? 'success' : percent(stats.pass, stats.done) >= 80 ? 'warning' : 'danger';
  const statValue = (v: ReactNode) => (loading ? <Skeleton className="my-1 h-6 w-14" /> : v);

  return (
    <div className="space-y-5">
      <PageHeader
        // The title column has flex-basis 0, so without a min width it never wraps above the actions on phones;
        // and the default description width leaves a one-word orphan at desktop widths.
        className="[&>div:first-child]:min-w-[min(100%,20rem)] [&>div:first-child>p]:max-w-4xl"
        title="Run history"
        description="Every run and its verdict. Filter by party, format, scenario or module version to track regressions across Inji releases."
        actions={<>
          <a href="/api/report.md" target="_blank" rel="noreferrer" className={buttonClass('secondary', 'sm')}>
            <Download size={14} aria-hidden />Export report
          </a>
          <Button variant="danger-ghost" size="sm" icon={Trash2} disabled={!runs.length} onClick={() => setConfirmOpen(true)}>
            Clear history
          </Button>
        </>}
      />

      {runsLoaded && !runs.length ? (
        <Card>
          <EmptyState icon={HistoryIcon} title="No runs yet"
            description="Run a flow in the Playground or sweep the interop matrix. Each run is recorded here with its verdict and the module versions involved."
            action={<a href={routeHref({ view: 'playground' })} className={buttonClass('primary', 'md')}><FlaskConical size={16} aria-hidden />Open the Playground</a>} />
        </Card>
      ) : (<>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Runs" icon={Activity} value={statValue(stats.done.toLocaleString())}
            hint={loading ? undefined : stats.running ? `${stats.running} running`
              : activeCount ? `of ${runs.filter((r) => r.state !== 'running').length.toLocaleString()} in total`
              : stats.latest ? `Latest ${relativeTime(stats.latest, now)}` : undefined} />
          <Stat label="Pass rate" icon={CircleCheck} tone={stats.done ? passTone : undefined}
            value={statValue(stats.done ? `${percent(stats.pass, stats.done)}%` : '—')}
            hint={loading ? undefined : stats.done ? `${stats.pass} of ${stats.done} passed` : 'No finished runs'} />
          <Stat label="Failures" icon={CircleX} tone={failures ? 'danger' : undefined} value={statValue(stats.done ? failures.toLocaleString() : '—')}
            hint={loading ? undefined : failures ? [stats.fail && `${stats.fail} wrong verdict`, stats.error && `${stats.error} errored`].filter(Boolean).join(' · ')
              : stats.done ? 'Every run passed' : undefined} />
          <Stat label="Avg duration" icon={Timer} value={statValue(formatDuration(stats.avg))}
            hint={loading || stats.slowest == null ? undefined : `Slowest ${formatDuration(stats.slowest)}`} />
        </div>

        <Card className="p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <SearchInput value={query} onChange={setSearch} label="Search runs" placeholder={wide ? 'Search run ID, party, error or proof type…' : 'Search runs…'}
              className="min-w-0 flex-1 sm:max-w-md" />
            <Button className={cn('sm:hidden', filtersOpen && 'bg-hover!')} icon={SlidersHorizontal} aria-expanded={filtersOpen} aria-controls="history-filters"
              onClick={() => setFiltersOpen((o) => !o)}>
              Filters{selectCount > 0 && <Badge tone="brand" size="xs">{selectCount}</Badge>}
            </Button>
            {activeCount > 0 && (
              <div className="flex w-full items-center gap-3 sm:ml-auto sm:w-auto">
                <span className="text-[13px] tabular-nums text-fg-subtle">{filtered.length} of {pluralize(runs.length, 'run')}</span>
                <Button variant="ghost" size="sm" icon={X} onClick={clearFilters} className="ml-auto sm:ml-0">
                  Clear filters<Badge tone="neutral" size="xs" className="tabular-nums">{activeCount}</Badge>
                </Button>
              </div>
            )}
          </div>
          <div id="history-filters" className={cn('mt-3 grid-cols-2 gap-3 sm:grid sm:grid-cols-3 xl:grid-cols-6', filtersOpen ? 'grid' : 'hidden')}>
            <FilterSelect label="Issuer" value={filters.issuer} options={options.issuer} onChange={(v) => setFilter('issuer', v)} />
            <FilterSelect label="Verifier" value={filters.verifier} options={options.verifier} onChange={(v) => setFilter('verifier', v)} />
            <FilterSelect label="Format" value={filters.format} options={options.format} onChange={(v) => setFilter('format', v)} />
            <FilterSelect label="Scenario" value={filters.scenario} options={options.scenario} onChange={(v) => setFilter('scenario', v)} />
            <FilterSelect label="Outcome" value={filters.outcome} options={options.outcome} onChange={(v) => setFilter('outcome', v)} />
            <FilterSelect label="Module version" value={filters.version} options={options.version} onChange={(v) => setFilter('version', v)} />
          </div>
        </Card>

        <section ref={listRef} aria-label="Runs" aria-busy={loading} className="card scroll-mt-32 overflow-clip md:scroll-mt-20">
          {!loading && !sorted.length ? (
            <EmptyState icon={SearchX} title="No runs match these filters"
              description="Try a different search, or widen the filters to include more parties, formats or scenarios."
              action={<Button icon={X} onClick={clearFilters}>Clear filters</Button>} />
          ) : (<>
            {/* Desktop: table */}
            <table className="hidden w-full table-fixed text-sm md:table">
              <thead>
                <tr>
                  <Th className="w-[112px] pl-4">Result</Th>
                  <Th>Flow</Th>
                  <Th className="hidden w-[96px] lg:table-cell">Format</Th>
                  <Th className="w-[184px]">Scenario</Th>
                  <Th className="hidden w-[132px] lg:table-cell">Verdict</Th>
                  <Th className="hidden w-[108px] text-right xl:table-cell" sort={sort} sortKey="duration" onSort={toggleSort}>Duration</Th>
                  <Th className="w-[136px] pr-4 text-right" sort={sort} sortKey="when" onSort={toggleSort}>When</Th>
                </tr>
              </thead>
              <tbody>
                {loading ? Array.from({ length: 8 }, (_, i) => <SkeletonRow key={i} />) : pageRuns.map((r) => (
                  <RunRow key={r.id} run={r} name={name} now={now} fresh={isFresh(r.id)} />
                ))}
              </tbody>
            </table>

            {/* Mobile: stacked list */}
            <ul className="divide-y divide-line md:hidden">
              {loading ? Array.from({ length: 6 }, (_, i) => (
                <li key={i} className="flex gap-3 px-4 py-3.5">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <div className="flex-1 space-y-2"><Skeleton className="h-4 w-4/5" /><Skeleton className="h-4 w-1/2" /></div>
                </li>
              )) : pageRuns.map((r) => <RunListItem key={r.id} run={r} name={name} now={now} fresh={isFresh(r.id)} />)}
            </ul>

            {!loading && (
              <nav aria-label="Pagination" className="flex items-center gap-3 border-t border-line px-4 py-2.5">
                <p className="text-[13px] tabular-nums text-fg-subtle">
                  Showing <span className="font-medium text-fg">{current * PAGE_SIZE + 1}–{current * PAGE_SIZE + pageRuns.length}</span> of{' '}
                  <span className="font-medium text-fg">{sorted.length.toLocaleString()}</span>
                </p>
                {pageCount > 1 && (
                  <div className="ml-auto flex items-center gap-2">
                    <span className="hidden text-[13px] tabular-nums text-fg-subtle sm:inline">Page {current + 1} of {pageCount}</span>
                    <Button size="sm" icon={ChevronLeft} disabled={current === 0} onClick={() => goToPage(current - 1)}>Prev</Button>
                    <Button size="sm" iconRight={ChevronRight} disabled={current >= pageCount - 1} onClick={() => goToPage(current + 1)}>Next</Button>
                  </div>
                )}
              </nav>
            )}
          </>)}
        </section>
      </>)}

      <ConfirmDialog open={confirmOpen} onClose={() => !clearing && setConfirmOpen(false)} onConfirm={clearHistory} busy={clearing} danger
        title="Clear all run history?" confirmLabel={`Delete ${pluralize(runs.length, 'run')}`}
        description={<>This permanently deletes <strong className="font-semibold text-fg">{pluralize(runs.length, 'run')}</strong> with their protocol traces and verdicts, for everyone using this playground. Export the report first if you need a record.</>} />
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function FilterSelect<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void;
}) {
  // Highlight filters that are narrowing the list.
  return <Select label={label} value={value} options={options} onChange={onChange} className={cn(value && '[&_select]:border-brand/60 [&_select]:bg-brand-soft/40')} />;
}

function Th({ children, className, sort, sortKey, onSort }: {
  children: ReactNode; className?: string; sort?: Sort; sortKey?: SortKey; onSort?: (k: SortKey) => void;
}) {
  const active = !!sortKey && sort?.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort!.dir === 'asc' ? ArrowUp : ArrowDown;
  const right = className?.includes('text-right');
  return (
    <th scope="col" aria-sort={sortKey ? (active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
      className={cn('sticky top-14 z-10 h-9 whitespace-nowrap bg-sunken px-3 text-left text-xs font-medium text-fg-muted shadow-[inset_0_-1px_0_var(--line)]', className)}>
      {sortKey && onSort ? (
        <button type="button" onClick={() => onSort(sortKey)} title={`Sort by ${String(children).toLowerCase()}`}
          className={cn('-mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-hover hover:text-fg', active && 'text-fg', right && 'flex-row-reverse')}>
          {children}
          <Icon size={13} aria-hidden className={active ? 'text-fg' : 'text-fg-subtle/70'} />
        </button>
      ) : children}
    </th>
  );
}

/** Second line under the flow: the failure reason for bad runs, else the proof type. */
function runDetail(r: RunSummary) {
  const s = runStatus(r);
  if (s === 'fail' || s === 'error') return { text: r.error ?? (r.failedStage ? `Failed at the ${r.failedStage} stage` : 'Run failed'), bad: true };
  return { text: r.proofType ?? (s === 'running' ? 'In progress…' : '—'), bad: false };
}

function openRow(e: MouseEvent, id: string) {
  if (window.getSelection()?.toString()) return; // let people select text without navigating
  if (e.metaKey || e.ctrlKey || e.shiftKey) window.open(runHref(id), '_blank', 'noopener');
  else openRun(id);
}

function RunRow({ run: r, name, now, fresh }: { run: RunSummary; name: (id: string) => string; now: number; fresh: boolean }) {
  const catalog = useCatalog();
  const detail = runDetail(r);
  return (
    <tr onClick={(e) => openRow(e, r.id)} onAuxClick={(e) => e.button === 1 && window.open(runHref(r.id), '_blank', 'noopener')}
      className={cn('cursor-pointer border-t border-line transition-colors first:border-t-0 hover:bg-hover/60 focus-within:bg-hover/60', fresh && 'animate-row-in')}>
      <td className="py-2.5 pl-4 pr-3"><ResultBadge run={r} /></td>
      <td className="min-w-0 px-3 py-2.5">
        <a href={runHref(r.id)} onClick={(e) => e.stopPropagation()} className="block rounded-sm font-medium text-fg">
          {/* The wallet is nearly always the Reference Wallet; drop it where three names would all truncate. */}
          <span className="block xl:hidden"><FlowLabel run={r} name={name} showWallet={false} /></span>
          <span className="hidden xl:block"><FlowLabel run={r} name={name} /></span>
        </a>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs text-fg-subtle">
          <span className="shrink-0 font-mono text-[11px]">{shortId(r.id)}</span>
          <span aria-hidden className="shrink-0 opacity-60">·</span>
          <span className={cn('truncate', detail.bad && 'text-danger-fg')} title={detail.text}>{detail.text}</span>
        </div>
      </td>
      <td className="hidden px-3 py-2.5 lg:table-cell"><FormatBadge format={r.format} catalog={catalog} /></td>
      <td className="px-3 py-2.5"><ScenarioBadge run={r} /></td>
      <td className="hidden px-3 py-2.5 lg:table-cell">
        <VerdictBadge verdict={r.actual} />
        <div className="mt-0.5 whitespace-nowrap text-xs text-fg-subtle">expected {r.expected}</div>
      </td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-fg-muted xl:table-cell">{formatDuration(r.durationMs)}</td>
      <td className="whitespace-nowrap py-2.5 pl-3 pr-4 text-right text-fg-muted">
        <Tooltip content={absoluteTime(r.createdAt)}>
          <time dateTime={r.createdAt}>{relativeTime(r.createdAt, now)}</time>
        </Tooltip>
      </td>
    </tr>
  );
}

function RunListItem({ run: r, name, now, fresh }: { run: RunSummary; name: (id: string) => string; now: number; fresh: boolean }) {
  const catalog = useCatalog();
  const detail = runDetail(r);
  return (
    <li className={cn(fresh && 'animate-row-in')}>
      <a href={runHref(r.id)} className="flex gap-3 px-4 py-3 transition-colors hover:bg-hover/60">
        <span className="mt-0.5"><StatusIcon run={r} size={16} /></span>
        <div className="min-w-0 flex-1">
          <FlowLabel run={r} name={name} showWallet={false} className="text-sm font-medium text-fg" />
          {detail.bad && <div className="mt-0.5 truncate text-xs text-danger-fg">{detail.text}</div>}
          <div className="mt-2 flex items-center gap-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <FormatBadge format={r.format} catalog={catalog} size="xs" />
              <ScenarioBadge run={r} size="xs" />
              {/* A pass means the verdict matched what the scenario expects, so only show it when it didn't. */}
              {detail.bad && r.actual && <VerdictBadge verdict={r.actual} size="xs" />}
            </div>
            <time dateTime={r.createdAt} title={absoluteTime(r.createdAt)} className="ml-auto shrink-0 pl-2 text-xs text-fg-subtle">{relativeTime(r.createdAt, now)}</time>
          </div>
        </div>
      </a>
    </li>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-t border-line first:border-t-0">
      <td className="py-3 pl-4 pr-3"><Skeleton className="h-5 w-16" /></td>
      <td className="px-3 py-3"><Skeleton className="h-4 w-4/5 max-w-md" /><Skeleton className="mt-1.5 h-3 w-1/3 max-w-48" /></td>
      <td className="hidden px-3 py-3 lg:table-cell"><Skeleton className="h-5 w-14" /></td>
      <td className="px-3 py-3"><Skeleton className="h-5 w-24" /></td>
      <td className="hidden px-3 py-3 lg:table-cell"><Skeleton className="h-5 w-16" /><Skeleton className="mt-1.5 h-3 w-20" /></td>
      <td className="hidden px-3 py-3 xl:table-cell"><Skeleton className="ml-auto h-4 w-12" /></td>
      <td className="py-3 pl-3 pr-4"><Skeleton className="ml-auto h-4 w-16" /></td>
    </tr>
  );
}
