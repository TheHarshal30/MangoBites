import { Fragment, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowRight, Check, CircleCheck, CircleX, Clock, Download, ExternalLink, IdCard, Info, KeyRound, Link2, Minus, SearchX, ShieldAlert, ShieldCheck,
  Smartphone, Workflow, X,
} from 'lucide-react';
import { api, useLive, type ProtocolEvent, type Run } from '../api';
import { useCatalog, usePartyLookup } from '../lib/app';
import { SCENARIOS, scenarioOf } from '../lib/flow';
import { absoluteTime, formatDuration, humanizeKey, formatClaimValue, relativeTime, shortId, useNow } from '../lib/format';
import { navigate, routeHref, runHref } from '../lib/router';
import { Tooltip, useToast } from './overlays';
import { Alert, Badge, Button, Card, CardHeader, CopyButton, EmptyState, IconButton, SegmentedControl, Skeleton, Spinner, TONE_TEXT, buttonClass, cn } from './ui';
import { CredentialCard, ROLE_LABEL, ROLE_TEXT, ScenarioBadge, verdictTone } from './domain';
import { Inspector } from './Inspector';
import { SequenceDiagram } from './SequenceDiagram';
import { JsonView } from './JsonView';

const STAGES = [
  { key: 'issue', label: 'Issue', sub: 'OpenID4VCI' },
  { key: 'hold', label: 'Hold', sub: 'Wallet stores the credential' },
  { key: 'present', label: 'Present', sub: 'OpenID4VP' },
  { key: 'verify', label: 'Verify', sub: 'Verifier verdict' },
] as const;
type StageKey = (typeof STAGES)[number]['key'];

function mergeEvents(a: ProtocolEvent[], b: ProtocolEvent[]) {
  const seen = new Set(a.map((e) => e.id));
  return [...a, ...b.filter((e) => !seen.has(e.id))].sort((x, y) => x.ts.localeCompare(y.ts));
}

export function RunView({ runId }: { runId: string }) {
  const { name } = usePartyLookup();
  const [run, setRun] = useState<Run>();
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string>();

  useEffect(() => { api.run(runId).then(setRun).catch((e: Error) => setError(e.message)); }, [runId]);
  useLive((m) => {
    if (m.type === 'event' && m.event.runId === runId) {
      setRun((r) => (r && !r.events.some((e) => e.id === m.event.id) ? { ...r, events: [...r.events, m.event] } : r));
    }
    if (m.type === 'run' && m.run.id === runId) {
      setRun((r) => (r ? { ...r, ...m.run, events: r.events } : r));
      if (m.run.state !== 'running') api.run(runId).then((full) => setRun((r) => ({ ...full, events: mergeEvents(r?.events ?? [], full.events) }))).catch(() => {});
    }
  });

  useEffect(() => {
    if (!run) return;
    const status = run.state === 'running' ? 'Running' : run.result ?? 'Error';
    document.title = `${status} · ${name(run.issuer)} → ${name(run.verifier)} · Inji Interop Playground`;
  }, [run?.state, run?.result, run?.issuer, run?.verifier, name]);

  if (error) {
    return (
      <Card>
        <EmptyState icon={SearchX} title="Run not found"
          description={error === 'not found'
            ? <>Run <code className="font-mono text-xs">{shortId(runId)}</code> doesn’t exist any more — history may have been cleared.</>
            : <>Couldn’t load run <code className="font-mono text-xs">{shortId(runId)}</code>: {error}</>}
          action={<Button onClick={() => navigate({ view: 'playground' })}>Back to the playground</Button>} />
      </Card>
    );
  }
  if (!run) return <RunSkeleton />;

  return (
    <div className="space-y-5">
      <RunHeader run={run} />
      {run.interaction && run.state === 'running' && <ManualPanel run={run} />}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
        <div className="min-w-0 space-y-5">
          <ChecksCard run={run} />
          <Card className="overflow-hidden">
            <CardHeader icon={Workflow} title="Protocol sequence" description="Click a numbered message to inspect that exchange"
              actions={run.state === 'running' ? <Badge tone="info" dot className="[&>span:first-child]:animate-pulse">Live</Badge> : undefined} />
            <div className="p-4"><SequenceDiagram run={run} selectedId={selected} onSelect={setSelected} /></div>
          </Card>
          {run.credential && <CredentialPanel run={run} />}
        </div>
        <Card className="flex h-[680px] min-w-0 flex-col overflow-hidden xl:sticky xl:top-[4.75rem] xl:h-[calc(100vh-6.25rem)] xl:min-h-[560px]">
          <Inspector events={run.events} live={run.state === 'running'} selectedId={selected} onSelect={setSelected} />
        </Card>
      </div>
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

function RunHeader({ run }: { run: Run }) {
  const catalog = useCatalog();
  const { name, party } = usePartyLookup();
  const toast = useToast();
  const now = useNow(15_000);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}${runHref(run.id)}`);
      toast({ title: 'Link copied', description: 'Anyone with access to this playground can open the run.' });
    } catch { toast({ tone: 'danger', title: 'Couldn’t copy the link' }); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `run-${shortId(run.id)}.json` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="overflow-hidden">
      <div className="p-4 sm:p-5">
        <div className="flex items-center gap-2 text-xs text-fg-subtle">
          <span className="font-medium text-fg-muted">Run</span>
          <Tooltip content="Copy run id">
            <button type="button" className="rounded font-mono hover:text-fg" onClick={() => navigator.clipboard?.writeText(run.id).then(() => toast({ title: 'Run id copied' }))}>{shortId(run.id)}</button>
          </Tooltip>
          <span aria-hidden>·</span>
          <Tooltip content={absoluteTime(run.createdAt)}><span tabIndex={0}>{relativeTime(run.createdAt, now)}</span></Tooltip>
          {run.batchId && <><span aria-hidden>·</span><a className="truncate hover:text-fg" href={routeHref({ view: 'matrix' })}>Part of a matrix sweep</a></>}
          <div className="-my-1.5 ml-auto flex items-center gap-0.5">
            <IconButton icon={Link2} label="Copy link to this run" size="sm" onClick={copyLink} />
            <IconButton icon={Download} label="Download run as JSON" size="sm" onClick={download} />
            <IconButton icon={X} label="Close run" size="sm" onClick={() => navigate({ view: 'playground' })} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-4">
          <div className="w-full min-w-0 md:w-auto md:flex-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
              {(['issuer', 'wallet', 'verifier'] as const).map((role, i) => (
                <Fragment key={role}>
                  {i > 0 && <ArrowRight size={16} className="mt-3.5 hidden shrink-0 text-fg-subtle sm:block" aria-hidden />}
                  <div className="min-w-0">
                    <div className={cn('text-[10.5px] font-semibold uppercase tracking-wider', ROLE_TEXT[role])}>{ROLE_LABEL[role]}</div>
                    <div className="truncate text-base font-semibold tracking-tight text-fg sm:text-lg" title={party(run[role])?.description}>{name(run[role])}</div>
                  </div>
                </Fragment>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Badge tone="neutral" size="md">{catalog.formats[run.format]?.label ?? run.format}</Badge>
              {run.proofType && <Badge tone="neutral" size="md">Proof · {run.proofType}</Badge>}
              <ScenarioBadge run={run} size="md" />
              {run.txCode && <Badge tone="neutral" size="md" icon={KeyRound}>PIN</Badge>}
              {run.durationMs != null && <Badge tone="neutral" size="md" icon={Clock}>{formatDuration(run.durationMs)}</Badge>}
            </div>
          </div>
          <VerdictPanel run={run} />
        </div>
      </div>
      <Explanation run={run} />
      <StageTracker run={run} />
    </Card>
  );
}

function VerdictPanel({ run }: { run: Run }) {
  if (run.state === 'running') {
    const waiting = Object.values(run.stages).some((s) => s.status === 'waiting');
    return (
      <div className={cn('flex items-center gap-3 rounded-xl px-4 py-3', waiting ? 'bg-warning-soft text-warning-fg' : 'bg-info-soft text-info-fg')} role="status">
        {waiting ? <Smartphone size={20} aria-hidden /> : <Spinner size={20} />}
        <div>
          <div className="text-sm font-semibold">{waiting ? 'Waiting for the wallet' : 'Running'}</div>
          <div className="text-xs opacity-80">Expecting {run.expected}</div>
        </div>
      </div>
    );
  }
  const pass = run.result === 'PASS';
  const Icon = pass ? CircleCheck : CircleX;
  return (
    <div className="flex w-full items-stretch overflow-hidden rounded-xl border border-line sm:w-auto" role="status" aria-label={`Result ${run.result ?? 'error'}`}>
      <div className="flex-1 px-4 py-2.5">
        <div className="text-[11px] font-medium text-fg-subtle">Verifier returned</div>
        <div className={cn('font-mono text-lg font-semibold leading-tight', run.actual ? TONE_TEXT[verdictTone(run.actual)] : 'text-fg-subtle')}>{run.actual ?? 'nothing'}</div>
        <div className="text-[11px] text-fg-subtle">expected <span className="font-mono font-medium text-fg-muted">{run.expected}</span></div>
      </div>
      <div className={cn('flex min-w-[112px] flex-col items-center justify-center gap-0.5 px-5 text-white', pass ? 'bg-success' : 'bg-danger')}>
        <Icon size={20} aria-hidden />
        <div className="text-lg font-bold leading-none tracking-tight">{run.result ?? 'ERROR'}</div>
      </div>
    </div>
  );
}

/** One sentence on what the result means, in terms of the parties involved. */
function Explanation({ run }: { run: Run }) {
  const { name } = usePartyLookup();
  if (run.state === 'running') return null;
  const verifier = name(run.verifier);
  const scenario = SCENARIOS[scenarioOf(run)];
  let tone: 'danger' | 'success' | 'neutral' = 'neutral';
  let title: string | undefined;
  let body: string | undefined = run.error;

  if (run.result === 'FAIL' && run.actual) {
    tone = 'danger';
    // The server's message ("Verifier said VALID, scenario expects INVALID") only restates the title.
    if (body?.startsWith('Verifier said')) body = undefined;
    if (run.actual === 'VALID' && run.expected === 'INVALID') title = `${verifier} accepted a presentation it should have rejected (${scenario.label.toLowerCase()}).`;
    else if (run.actual === 'VALID' && run.expected === 'EXPIRED') title = `${verifier} accepted an expired credential.`;
    else if (run.expected === 'VALID') title = `${verifier} rejected an honest presentation — it returned ${run.actual}.`;
    else title = `${verifier} returned ${run.actual}; the scenario expects ${run.expected}.`;
  } else if (run.result !== 'PASS') {
    tone = 'danger';
    title = `The run stopped during ${run.failedStage ? `the ${run.failedStage} stage` : 'execution'}.`;
  } else if (scenario.negative) {
    tone = 'success';
    title = `${verifier} correctly ${run.actual === 'EXPIRED' ? 'flagged the expired credential' : `rejected the ${scenario.label.toLowerCase()} presentation`}.`;
    body = run.error;
  } else if (!run.error) {
    return null;
  }

  return (
    <div className="border-t border-line px-4 py-3 sm:px-5">
      <Alert tone={tone} icon={tone === 'danger' ? ShieldAlert : tone === 'success' ? ShieldCheck : Info} title={title}>
        {body && <span className="font-mono text-xs">{run.failedStage && tone === 'danger' && !run.actual ? `${run.failedStage}: ` : ''}{body}</span>}
      </Alert>
    </div>
  );
}

function StageTracker({ run }: { run: Run }) {
  const status = (k: StageKey) =>
    k === 'hold' ? (run.stages.issue.status === 'done' ? 'done' : run.stages.issue.status === 'failed' ? 'failed' : 'pending') : run.stages[k]?.status ?? 'pending';
  const detail = (k: StageKey) =>
    k === 'hold' ? (run.stages.issue.status === 'done' ? 'Credential stored' : undefined) : k === 'verify' && run.stages.verify.detail ? `Returned ${run.stages.verify.detail}` : run.stages[k]?.detail;

  return (
    <ol className="grid grid-cols-2 border-t border-line sm:grid-cols-4" aria-label="Stages">
      {STAGES.map((s, i) => {
        const st = status(s.key);
        const d = detail(s.key);
        return (
          <li key={s.key} className={cn('relative flex min-w-0 items-start gap-3 px-4 py-3 sm:px-5', i % 2 === 1 && 'border-l border-line', i >= 2 && 'border-t border-line sm:border-t-0', i === 2 && 'sm:border-l')}>
            <StageIcon status={st} />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-fg">{s.label}</div>
              <div className="truncate text-xs text-fg-subtle" title={d ?? s.sub}>{d ?? s.sub}</div>
            </div>
            {(st === 'running' || st === 'waiting') && <div className={cn('absolute inset-x-0 bottom-0 h-0.5 animate-pulse', st === 'running' ? 'bg-info' : 'bg-warning')} />}
          </li>
        );
      })}
    </ol>
  );
}

function StageIcon({ status }: { status: string }) {
  const base = 'mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full';
  const label = <span className="sr-only">{status}</span>;
  if (status === 'done') return <span className={cn(base, 'bg-success-soft text-success')}><Check size={14} strokeWidth={2.75} aria-hidden />{label}</span>;
  if (status === 'failed') return <span className={cn(base, 'bg-danger-soft text-danger')}><X size={14} strokeWidth={2.75} aria-hidden />{label}</span>;
  if (status === 'running') return <span className={cn(base, 'bg-info-soft text-info')}><Spinner size={14} />{label}</span>;
  if (status === 'waiting') return <span className={cn(base, 'animate-pulse bg-warning-soft text-warning')}><Clock size={14} aria-hidden />{label}</span>;
  if (status === 'skipped') return <span className={cn(base, 'bg-sunken text-fg-subtle')}><Minus size={14} aria-hidden />{label}</span>;
  return <span className={cn(base, 'border border-dashed border-line-strong')}>{label}</span>;
}

// ── Checks & credential ──────────────────────────────────────────────────────

function ChecksCard({ run }: { run: Run }) {
  const checks = run.outcome?.checks ?? run.outcomeChecks ?? [];
  const claims = run.outcome?.claims;
  if (!checks.length && !claims) return null;
  const failed = checks.filter((c) => !c.ok).length;
  return (
    <Card className="overflow-hidden">
      <CardHeader icon={ShieldCheck} title="Verification checks"
        actions={<span className="text-xs tabular-nums text-fg-subtle">{checks.length - failed} passed{failed ? ` · ${failed} failed` : ''}</span>} />
      <ul className="divide-y divide-line">
        {checks.map((c, i) => (
          <li key={i} className="flex items-start gap-3 px-4 py-2.5">
            {c.ok ? <CircleCheck size={16} className="mt-0.5 shrink-0 text-success" aria-label="passed" /> : <CircleX size={16} className="mt-0.5 shrink-0 text-danger" aria-label="failed" />}
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-fg">{c.name}</div>
              {c.detail && <div className="mt-0.5 break-all font-mono text-xs text-fg-subtle">{c.detail}</div>}
            </div>
          </li>
        ))}
      </ul>
      {claims && (
        <details className="group border-t border-line">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[13px] font-medium text-fg-muted hover:bg-hover/50 [&::-webkit-details-marker]:hidden">
            <ArrowRight size={14} className="transition-transform group-open:rotate-90" aria-hidden />
            Claims the verifier saw <span className="text-fg-subtle">({Object.keys(claims).length})</span>
          </summary>
          <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-6 gap-y-1.5 px-4 pb-3 pl-10 text-[13px]">
            {Object.entries(claims).map(([k, v]) => (
              <Fragment key={k}>
                <dt className="text-fg-subtle">{humanizeKey(k)}</dt>
                <dd className="truncate font-medium text-fg" title={formatClaimValue(v)}>{formatClaimValue(v)}</dd>
              </Fragment>
            ))}
          </dl>
        </details>
      )}
    </Card>
  );
}

function CredentialPanel({ run }: { run: Run }) {
  const catalog = useCatalog();
  const [view, setView] = useState<'card' | 'json'>('card');
  const c = run.credential!;
  return (
    <Card className="overflow-hidden">
      <CardHeader icon={IdCard} title="Credential in the wallet"
        actions={<SegmentedControl size="xs" label="Credential view" value={view} onChange={setView} options={[{ value: 'card', label: 'Card' }, { value: 'json', label: 'JSON' }]} />} />
      <div className="p-4">
        {view === 'card'
          ? <CredentialCard format={c.format} summary={c.summary} catalog={catalog} maxClaims={8} className="max-w-md" />
          : <JsonView value={c.summary} />}
      </div>
    </Card>
  );
}

// ── Manual wallet (Inji Wallet mobile) ───────────────────────────────────────

function ManualPanel({ run }: { run: Run }) {
  const i = run.interaction!;
  const toast = useToast();
  const [signalling, setSignalling] = useState(false);
  const waitingIssue = run.stages.issue.status === 'waiting';
  const uri = waitingIssue ? i.offerUri : i.authorizationRequestUri;
  const steps = [
    { label: 'Scan the credential offer', hint: i.txCode ? 'Enter the PIN below when the app asks' : 'Accept the credential in the app' },
    { label: 'Confirm the credential arrived', hint: 'Press “Credential received” here' },
    { label: 'Scan the presentation request', hint: 'Share the credential with the verifier' },
  ];
  const current = waitingIssue ? 0 : 2;

  const signal = async () => {
    setSignalling(true);
    try {
      const res = await api.signal(run.id);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      toast({ tone: 'danger', title: 'Couldn’t continue the run', description: (e as Error).message });
    } finally {
      setSignalling(false);
    }
  };

  return (
    <Card className="overflow-hidden ring-1 ring-warning/30">
      <div className="flex items-center gap-2 border-b border-line bg-warning-soft px-4 py-2.5 text-[13px] font-semibold text-warning-fg">
        <Smartphone size={15} aria-hidden /> Waiting for Inji Wallet
        <Spinner size={14} className="ml-auto" />
      </div>
      <div className="flex flex-col gap-6 p-5 md:flex-row md:items-start">
        {uri && (
          <div className="shrink-0 self-center rounded-xl bg-white p-3 shadow-sm ring-1 ring-line md:self-start">
            <QRCodeSVG value={uri} size={208} level="M" marginSize={0} />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-4">
          <div>
            <div className="text-base font-semibold text-fg">{waitingIssue ? 'Scan the credential offer with Inji Wallet' : 'Scan the presentation request with Inji Wallet'}</div>
            {i.prompt && <div className="mt-1 text-sm text-fg-muted">{i.prompt}</div>}
          </div>
          <ol className="space-y-2">
            {steps.map((s, n) => (
              <li key={n} className="flex items-start gap-3">
                <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
                  n < current ? 'bg-success-soft text-success' : n === current ? 'bg-brand text-brand-contrast' : 'bg-sunken text-fg-subtle ring-1 ring-inset ring-line')}>
                  {n < current ? <Check size={13} strokeWidth={3} aria-hidden /> : n + 1}
                </span>
                <div className={cn('text-sm', n === current ? 'text-fg' : 'text-fg-subtle')}>
                  <div className="font-medium">{s.label}</div>
                  {n === current && <div className="text-xs text-fg-subtle">{s.hint}</div>}
                </div>
              </li>
            ))}
          </ol>
          {waitingIssue && i.txCode && (
            <div className="inline-flex items-center gap-3 rounded-lg bg-sunken px-3 py-2 ring-1 ring-inset ring-line">
              <span className="text-xs font-medium text-fg-subtle">Transaction code</span>
              <span className="font-mono text-xl font-semibold tracking-[0.3em] text-fg">{i.txCode}</span>
              <CopyButton text={i.txCode} label="Copy PIN" />
            </div>
          )}
          {uri && (
            <div className="flex items-center gap-2 rounded-lg bg-[var(--code-bg)] py-1.5 pl-3 pr-1.5 ring-1 ring-inset ring-line">
              <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-subtle" title={uri}>{uri}</code>
              <CopyButton text={uri} label="Copy request URI" />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {/* Same-device flow: on a phone, the custom-scheme link hands the request straight to the wallet app. */}
            {uri && <a className={buttonClass('secondary', 'md')} href={uri}><ExternalLink size={16} aria-hidden />Open in wallet on this device</a>}
            {waitingIssue && <Button variant="primary" iconRight={ArrowRight} loading={signalling} onClick={signal}>Credential received</Button>}
          </div>
        </div>
      </div>
    </Card>
  );
}

function RunSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading run">
      <Card className="p-5">
        <Skeleton className="h-3 w-48" />
        <div className="mt-4 flex items-end gap-6">
          <div className="flex-1 space-y-3"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-5 w-1/2" /></div>
          <Skeleton className="h-16 w-56" />
        </div>
      </Card>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-5"><Skeleton className="h-80 w-full" /></Card>
        <Card className="p-5"><Skeleton className="h-80 w-full" /></Card>
      </div>
    </div>
  );
}
