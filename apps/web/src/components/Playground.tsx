import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, ChevronUp, Info, KeyRound, Play, RotateCcw, Settings2, Smartphone, TriangleAlert } from 'lucide-react';
import { api, type Format, type Party } from '../api';
import { useApp, useCatalog, usePartyLookup } from '../lib/app';
import {
  SCENARIOS, SCENARIO_IDS, flowProblem, formatBlocker, fromRun, normalize, sameFlow, scenarioBlocker, setFlowConfig, toRunInput, useFlowConfig,
  type FlowConfig, type ScenarioId,
} from '../lib/flow';
import { formatDuration, relativeTime, useNow } from '../lib/format';
import { openRun, routeHref, runHref } from '../lib/router';
import { useToast } from './overlays';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Kbd, PageHeader, SectionLabel, SegmentedControl, Switch, cn } from './ui';
import { FlowLabel, FormatBadge, ResultBadge, ScenarioBadge, VendorBadge, VerdictBadge, scenarioTone, versionLabel } from './domain';
import { RunView } from './RunView';

const ROLES = [
  { role: 'issuer', step: 1, title: 'Issuer', hint: 'Issues the credential over OpenID4VCI' },
  { role: 'wallet', step: 2, title: 'Wallet', hint: 'Holds it and presents it' },
  { role: 'verifier', step: 3, title: 'Verifier', hint: 'Checks the presentation over OpenID4VP' },
] as const;

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function Playground({ runId }: { runId?: string }) {
  const catalog = useCatalog();
  const { runs } = useApp();
  const stored = useFlowConfig();
  const config = useMemo(() => normalize(stored, catalog), [stored, catalog]);
  const [editing, setEditing] = useState(false);
  const [starting, setStarting] = useState(false);
  const toast = useToast();

  const update = (patch: Partial<FlowConfig>) => setFlowConfig(normalize({ ...config, ...patch }, catalog));

  // Opening a run loads its configuration, so "Run again" repeats exactly that flow.
  const synced = useRef<string>();
  const openSummary = runId ? runs.find((r) => r.id === runId) : undefined;
  useEffect(() => {
    if (!openSummary || synced.current === openSummary.id) return;
    synced.current = openSummary.id;
    setFlowConfig(normalize(fromRun(openSummary), catalog));
  }, [openSummary, catalog]);
  useEffect(() => { if (!runId) setEditing(false); }, [runId]);

  const problem = flowProblem(config, catalog);
  const start = useCallback(async () => {
    if (problem || starting) return;
    setStarting(true);
    try {
      const run = await api.startRun(toRunInput(config));
      synced.current = run.id;
      setEditing(false);
      openRun(run.id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      toast({ tone: 'danger', title: 'Couldn’t start the run', description: (e as Error).message });
    } finally {
      setStarting(false);
    }
  }, [config, problem, starting, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); start(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start]);

  const sameAsOpen = !!openSummary && sameFlow(config, fromRun(openSummary));

  if (!runId) {
    return (
      <div className="space-y-5">
        <PageHeader title="Playground"
          description="Run the full issue → hold → present → verify cycle between any issuer, wallet and verifier, and inspect every OpenID4VCI and OpenID4VP message as it happens." />
        <Configurator config={config} update={update} problem={problem} starting={starting} onStart={start} />
        <RecentRuns />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {editing ? (
        <Configurator config={config} update={update} problem={problem} starting={starting} onStart={start} onCollapse={() => setEditing(false)} />
      ) : (
        <FlowBar config={config} problem={problem} starting={starting} onStart={start} onEdit={() => setEditing(true)} again={sameAsOpen} />
      )}
      <RunView key={runId} runId={runId} />
    </div>
  );
}

// ── Configurator ─────────────────────────────────────────────────────────────

function Configurator({ config, update, problem, starting, onStart, onCollapse }: {
  config: FlowConfig; update: (p: Partial<FlowConfig>) => void; problem?: string; starting: boolean; onStart: () => void; onCollapse?: () => void;
}) {
  const catalog = useCatalog();
  const formats = Object.keys(catalog.formats) as Format[];
  const wallet = catalog.parties.find((p) => p.id === config.wallet);
  const s = SCENARIOS[config.scenario];
  const blockedFormats = formats.map((f) => [f, formatBlocker(config, catalog, f)] as const).filter(([, b]) => b);

  return (
    <Card className="overflow-hidden">
      {onCollapse && (
        <CardHeader icon={Settings2} title="Configure the next run" description="Changes apply to the next run; the run below stays as it was."
          actions={<Button size="sm" variant="ghost" icon={ChevronUp} onClick={onCollapse}>Collapse</Button>} />
      )}

      <div className="grid gap-px bg-line lg:grid-cols-3">
        {ROLES.map(({ role, step, title, hint }) => (
          <div key={role} className="bg-surface p-4 sm:p-5">
            <div className="mb-3 flex items-center gap-2.5" id={`role-${role}`}>
              <span className="grid h-5 w-5 place-items-center rounded-full bg-sunken text-[11px] font-semibold text-fg-muted ring-1 ring-inset ring-line">{step}</span>
              <span className="text-[13px] font-semibold text-fg">{title}</span>
              <span className="truncate text-xs text-fg-subtle">{hint}</span>
            </div>
            <div role="radiogroup" aria-labelledby={`role-${role}`} className="space-y-2">
              {catalog.parties.filter((p) => p.role === role).map((p) => (
                <PartyOption key={p.id} party={p} selected={config[role] === p.id} onSelect={() => update({ [role]: p.id })} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-px border-t border-line bg-line lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(270px,0.9fr)]">
        <div className="bg-surface p-4 sm:p-5">
          <SectionLabel>Credential format</SectionLabel>
          <SegmentedControl label="Credential format" fullWidth size="md" value={config.format} onChange={(f) => update({ format: f })}
            options={formats.map((f) => ({ value: f, label: catalog.formats[f].short, disabled: !!formatBlocker(config, catalog, f), title: formatBlocker(config, catalog, f) ?? catalog.formats[f].label }))} />
          <p className="mt-2 text-xs text-fg-muted">{catalog.formats[config.format].label}</p>
          {blockedFormats.length > 0 && (
            <ul className="mt-2 space-y-1">
              {blockedFormats.map(([f, b]) => (
                <li key={f} className="flex items-start gap-1.5 text-xs text-fg-subtle">
                  <Info size={12} className="mt-0.5 shrink-0" aria-hidden />
                  <span><span className="font-medium text-fg-muted">{catalog.formats[f].short}</span> — {b!.replace(/^Not supported by/, 'not supported by')}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6">
            <SectionLabel>Options</SectionLabel>
            <Switch checked={config.txCode} onChange={(v) => update({ txCode: v })} label="Require a transaction code"
              description="The credential offer asks the wallet for a one-time PIN" />
          </div>
        </div>

        <div className="bg-surface p-4 sm:p-5">
          <SectionLabel action={<span className="text-xs text-fg-subtle">Negative scenarios tamper with the issuance or presentation</span>}>Scenario</SectionLabel>
          <div role="radiogroup" aria-label="Scenario" className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
            {SCENARIO_IDS.map((id) => (
              <ScenarioOption key={id} id={id} selected={config.scenario === id} blocker={scenarioBlocker(config, catalog, id)} onSelect={() => update({ scenario: id })} />
            ))}
          </div>
        </div>

        <div className="flex flex-col bg-sunken/60 p-4 sm:p-5 lg:col-span-2 xl:col-span-1">
          <SectionLabel>Expected verdict</SectionLabel>
          <div className="flex items-center gap-2.5">
            <VerdictBadge verdict={s.expected} size="md" />
            <span className="text-sm font-medium text-fg">{s.label}</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-fg-subtle">
            {s.negative
              ? <>The run passes only if the verifier returns <b className="font-semibold text-fg-muted">{s.expected}</b>. Accepting this presentation is an interop finding.</>
              : <>The run passes if the verifier accepts the honest presentation and returns <b className="font-semibold text-fg-muted">VALID</b>.</>}
          </p>
          {wallet?.mode === 'manual' && (
            <Alert tone="info" icon={Smartphone} className="mt-3 text-xs">
              You’ll scan QR codes with the Inji Wallet app. {wallet.health?.detail && <span className="opacity-90">Note: {wallet.health.detail}.</span>}
            </Alert>
          )}
          <div className="mt-auto pt-5">
            {problem && <Alert tone="warning" icon={TriangleAlert} className="mb-3 text-xs">{problem}</Alert>}
            <Button variant="primary" size="lg" className="w-full" icon={Play} loading={starting} disabled={!!problem} onClick={onStart}>
              {starting ? 'Starting…' : 'Run flow'}
            </Button>
            <div className="mt-2 hidden items-center justify-center gap-1 text-[11px] text-fg-subtle sm:flex">
              or press <Kbd>{IS_MAC ? '⌘' : 'Ctrl'}</Kbd><Kbd>↵</Kbd>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function PartyOption({ party, selected, onSelect }: { party: Party; selected: boolean; onSelect: () => void }) {
  const down = party.health && !party.health.up;
  const version = versionLabel(party);
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect}
      className={cn('group relative flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
        selected ? 'border-brand bg-brand-soft/50 ring-1 ring-inset ring-brand' : 'border-line hover:border-line-strong hover:bg-hover/50')}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold text-fg">{party.name}</span>
          <VendorBadge party={party} />
          {version && <span className="text-xs text-fg-subtle">{version}</span>}
          {party.mode === 'manual' && <Badge tone="warning" size="xs" icon={Smartphone}>Manual · QR</Badge>}
          {down && <Badge tone="danger" size="xs" dot>Unreachable</Badge>}
        </div>
        <div className="mt-0.5 text-xs text-fg-muted">{party.protocol}</div>
        <div className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-fg-subtle" title={party.description}>{down ? party.health!.detail : party.description}</div>
      </div>
      <span aria-hidden className={cn('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors',
        selected ? 'border-brand bg-brand text-brand-contrast' : 'border-line-strong bg-surface group-hover:border-fg-subtle')}>
        {selected && <Check size={10} strokeWidth={3.5} />}
      </span>
    </button>
  );
}

function ScenarioOption({ id, selected, blocker, onSelect }: { id: ScenarioId; selected: boolean; blocker?: string; onSelect: () => void }) {
  const s = SCENARIOS[id];
  const tone = scenarioTone(id);
  return (
    <button type="button" role="radio" aria-checked={selected} disabled={!!blocker} onClick={onSelect} title={blocker}
      className={cn('flex h-full flex-col rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed',
        selected ? 'border-brand bg-brand-soft/50 ring-1 ring-inset ring-brand' : 'border-line enabled:hover:border-line-strong enabled:hover:bg-hover/50',
        blocker && 'bg-sunken/40')}>
      <div className="flex w-full items-center gap-2">
        <s.icon size={15} aria-hidden className={cn('shrink-0', blocker ? 'text-fg-subtle' : tone === 'neutral' ? 'text-success' : 'text-violet')} />
        <span className={cn('truncate text-[13px] font-semibold', blocker ? 'text-fg-subtle' : 'text-fg')}>{s.label}</span>
        <span className={cn('ml-auto', blocker && 'opacity-50')}><VerdictBadge verdict={s.expected} size="xs" /></span>
      </div>
      <div className={cn('mt-1 line-clamp-2 text-xs leading-relaxed', blocker ? 'text-fg-subtle italic' : 'text-fg-subtle')}>{blocker ?? s.description}</div>
    </button>
  );
}

// ── Collapsed configuration bar (shown above an open run) ────────────────────

function FlowBar({ config, problem, starting, onStart, onEdit, again }: {
  config: FlowConfig; problem?: string; starting: boolean; onStart: () => void; onEdit: () => void; again: boolean;
}) {
  const catalog = useCatalog();
  const { name } = usePartyLookup();
  return (
    <Card className="flex flex-col gap-x-4 gap-y-2.5 px-4 py-2.5 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="eyebrow">{again ? 'This flow' : 'Next run'}</span>
        <FlowLabel run={config} name={name} className="max-w-full text-[13px] font-medium text-fg" />
        <span className="flex flex-wrap items-center gap-1.5">
          <FormatBadge format={config.format} catalog={catalog} />
          <ScenarioBadge scenario={config.scenario} />
          {config.txCode && <Badge tone="neutral" icon={KeyRound}>PIN</Badge>}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {problem && <span className="hidden max-w-64 truncate text-xs text-warning-fg lg:inline" title={problem}>{problem}</span>}
        <Button size="sm" variant="secondary" icon={Settings2} onClick={onEdit}>Configure</Button>
        <Button size="sm" variant="primary" icon={again ? RotateCcw : Play} loading={starting} disabled={!!problem} onClick={onStart}
          title={`${again ? 'Run this flow again' : 'Run the configured flow'} (${IS_MAC ? '⌘' : 'Ctrl'}+Enter)`}>
          {again ? 'Run again' : 'Run'}
        </Button>
      </div>
    </Card>
  );
}

// ── Recent runs (empty-state companion of the configurator) ──────────────────

function RecentRuns() {
  const catalog = useCatalog();
  const { runs, runsLoaded } = useApp();
  const { name } = usePartyLookup();
  const now = useNow();
  const recent = runs.slice(0, 6);
  if (!runsLoaded) return null;

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Recent runs" description={runs.length ? `${runs.length.toLocaleString()} runs recorded` : undefined}
        actions={runs.length > 0 && <a href={routeHref({ view: 'history' })} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-fg-muted hover:bg-hover hover:text-fg">View all <ChevronRight size={14} aria-hidden /></a>} />
      {recent.length === 0 ? (
        <EmptyState icon={Play} title="No runs yet" description="Configure a flow above and press Run flow. Every protocol message streams into the inspector as it happens." />
      ) : (
        <ul className="divide-y divide-line">
          {recent.map((r) => (
            <li key={r.id}>
              <a href={runHref(r.id)} className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 transition-colors hover:bg-hover/50 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto_auto_auto]">
                <span className="w-[4.5rem]"><ResultBadge run={r} /></span>
                <span className="min-w-0">
                  <FlowLabel run={r} name={name} className="hidden text-[13px] font-medium text-fg sm:flex" />
                  <FlowLabel run={r} name={name} showWallet={false} className="text-[13px] font-medium text-fg sm:hidden" />
                  {r.result === 'FAIL' && r.error && <span className="mt-0.5 block truncate text-xs text-danger-fg">{r.error}</span>}
                </span>
                <span className="hidden items-center gap-1.5 sm:flex">
                  <FormatBadge format={r.format} catalog={catalog} />
                  <ScenarioBadge run={r} />
                </span>
                <span className="hidden w-14 text-right text-xs tabular-nums text-fg-subtle sm:block">{formatDuration(r.durationMs)}</span>
                <span className="flex items-center gap-1 text-right text-xs text-fg-subtle">
                  <span className="whitespace-nowrap">{relativeTime(r.createdAt, now)}</span>
                  <ChevronRight size={14} aria-hidden className="text-fg-subtle/60 transition-transform group-hover:translate-x-0.5" />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
