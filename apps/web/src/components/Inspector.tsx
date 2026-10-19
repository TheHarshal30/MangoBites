import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Activity, Braces, ChevronDown, ChevronUp, CircleAlert, Clock, Terminal, X } from 'lucide-react';
import type { ProtocolEvent } from '../api';
import { exchangeNumbers } from './SequenceDiagram';
import { JsonView } from './JsonView';
import { Badge, CopyButton, EmptyState, IconButton, SegmentedControl, cn } from './ui';
import { ROLE_TEXT } from './domain';

type Filter = 'all' | 'OpenID4VCI' | 'OpenID4VP' | 'http';
type Tab = 'decoded' | 'request' | 'response';

const PHASES: Array<{ prefix: string; label: string }> = [
  { prefix: 'OpenID4VCI', label: 'Issuance · OpenID4VCI' },
  { prefix: 'OpenID4VP', label: 'Presentation · OpenID4VP' },
  { prefix: 'Direct', label: 'Direct verification' },
];
const phaseOf = (e: ProtocolEvent) => PHASES.find((p) => e.step.startsWith(p.prefix))?.label ?? 'Run';
const titleOf = (e: ProtocolEvent) => e.step.replace(/^(OpenID4VCI|OpenID4VP|Direct[^·]*)\s*·\s*/, '');
const pathOf = (url: string) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } };

export function Inspector({ events, live, selectedId, onSelect }: { events: ProtocolEvent[]; live: boolean; selectedId?: string; onSelect: (id?: string) => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [tab, setTab] = useState<Tab>('decoded');
  const nums = useMemo(() => exchangeNumbers(events), [events]);
  const t0 = events[0] ? Date.parse(events[0].ts) : 0;
  const shown = events.filter((e) => filter === 'all' || (filter === 'http' ? e.kind === 'http' : e.step.startsWith(filter)));
  const selected = events.find((e) => e.id === selectedId);
  const listRef = useRef<HTMLDivElement>(null);
  const initial = useRef(new Set(events.map((e) => e.id)));
  const pinned = useRef(live);
  const sawLive = useRef(live);
  if (live) sawLive.current = true;

  // Follow new events while the run is live (and its final events, which land just after it
  // finishes) — unless the user scrolled up to read something.
  useEffect(() => {
    const el = listRef.current;
    if (el && sawLive.current && pinned.current && !selectedId) el.scrollTop = el.scrollHeight;
  }, [events.length, live, selectedId]);

  // Keep the selected row visible (e.g. when picked from the sequence diagram). Scrolls only the
  // list — scrollIntoView would also scroll the page.
  useEffect(() => {
    const list = listRef.current;
    const row = selectedId && list?.querySelector<HTMLElement>(`[data-event="${CSS.escape(selectedId)}"]`);
    if (!list || !row) return;
    const r = row.getBoundingClientRect(), l = list.getBoundingClientRect(), stickyHeader = 26;
    if (r.top < l.top + stickyHeader) list.scrollTop -= l.top + stickyHeader - r.top;
    else if (r.bottom > l.bottom) list.scrollTop += r.bottom - l.bottom;
  }, [selectedId]);

  const move = (delta: number) => {
    if (!shown.length) return;
    const i = shown.findIndex((e) => e.id === selectedId);
    const next = shown[Math.max(0, Math.min(shown.length - 1, i === -1 ? 0 : i + delta))];
    onSelect(next.id);
    listRef.current?.querySelector<HTMLElement>(`[data-event="${CSS.escape(next.id)}"]`)?.focus({ preventScroll: true });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); move(1); }
    if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); move(-1); }
    if (e.key === 'Escape' && selectedId) { e.preventDefault(); onSelect(undefined); }
  };

  const counts: Record<Filter, number> = {
    all: events.length,
    OpenID4VCI: events.filter((e) => e.step.startsWith('OpenID4VCI')).length,
    OpenID4VP: events.filter((e) => e.step.startsWith('OpenID4VP')).length,
    http: events.filter((e) => e.kind === 'http').length,
  };

  let lastPhase = '';
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5">
        <Activity size={16} className="text-fg-subtle" aria-hidden />
        <h2 className="text-sm font-semibold text-fg">Protocol inspector</h2>
        {live && <Badge tone="info" dot className="[&>span:first-child]:animate-pulse">Live</Badge>}
        <SegmentedControl size="xs" label="Filter events" className="ml-auto" value={filter} onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'OpenID4VCI', label: 'Issuance', count: counts.OpenID4VCI },
            { value: 'OpenID4VP', label: 'Presentation', count: counts.OpenID4VP },
            { value: 'http', label: 'HTTP', count: counts.http },
          ]} />
      </div>

      <div ref={listRef} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-auto"
        onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
        {shown.length === 0 ? (
          live ? <EmptyState icon={Activity} title="Waiting for protocol messages…" description="Requests appear here the moment the wallet, issuer and verifier talk to each other." />
            : <EmptyState icon={Activity} title="No events in this filter" />
        ) : (
          <ul role="list">
            {shown.map((e) => {
              const phase = phaseOf(e);
              const header = phase !== lastPhase ? phase : undefined;
              lastPhase = phase;
              return (
                <Fragment key={e.id}>
                  {header && <li className="sticky top-0 z-[1] border-y border-line bg-sunken/95 px-4 py-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle backdrop-blur first:border-t-0">{header}</li>}
                  <li>
                    <EventRow event={e} n={nums.get(e.id)} t0={t0} selected={e.id === selectedId} fresh={!initial.current.has(e.id)}
                      onClick={() => onSelect(e.id === selectedId ? undefined : e.id)} />
                  </li>
                </Fragment>
              );
            })}
          </ul>
        )}
      </div>

      {selected && (
        <EventDetail key={selected.id} event={selected} n={nums.get(selected.id)} tab={tab} onTab={setTab}
          onClose={() => onSelect(undefined)} onPrev={() => move(-1)} onNext={() => move(1)} />
      )}
    </>
  );
}

function EventRow({ event: e, n, t0, selected, fresh, onClick }: { event: ProtocolEvent; n?: number; t0: number; selected: boolean; fresh: boolean; onClick: () => void }) {
  const status = e.response?.status;
  const bad = e.kind === 'error' || (status !== undefined && status >= 400);
  return (
    <button type="button" data-event={e.id} onClick={onClick} aria-pressed={selected}
      className={cn('grid w-full grid-cols-[3.25rem_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-2 text-left transition-colors',
        selected ? 'bg-brand-soft shadow-[inset_2px_0_0_var(--brand)]' : 'hover:bg-hover/60', fresh && !selected && 'animate-row-in')}>
      <span className="pt-px text-right font-mono text-[11px] tabular-nums text-fg-subtle">+{((Date.parse(e.ts) - t0) / 1000).toFixed(2)}s</span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          {n != null && <span className="font-mono text-[11px] text-fg-subtle">[{n}]</span>}
          {e.request && <MethodTag method={e.request.method} />}
          <span className={cn('truncate text-[13px] font-medium', bad ? 'text-danger-fg' : 'text-fg')}>{titleOf(e)}</span>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-fg-subtle">
          <span className={cn('shrink-0', ROLE_TEXT[e.from])}>{e.from}</span>
          {e.from !== e.to && <><span className="shrink-0">→</span><span className={cn('shrink-0', ROLE_TEXT[e.to])}>{e.to}</span></>}
          <span className="shrink-0">·</span>
          <span className={cn('truncate', e.request && 'font-mono text-[11px]')}>{e.request ? pathOf(e.request.url) : e.summary}</span>
        </span>
      </span>
      <span className="flex items-center gap-1 pt-px">
        {e.data && <span title="Decoded artefacts" className="text-violet"><Braces size={13} aria-label="decoded" /></span>}
        {status !== undefined && <Badge tone={bad ? 'danger' : 'success'} size="xs" mono>{status}</Badge>}
        {e.kind === 'error' && <Badge tone="danger" size="xs" icon={CircleAlert}>error</Badge>}
        {e.kind === 'await' && <Badge tone="warning" size="xs" icon={Clock}>waiting</Badge>}
      </span>
    </button>
  );
}

const MethodTag = ({ method }: { method: string }) => (
  <span className="shrink-0 rounded bg-sunken px-1 font-mono text-[10px] font-semibold leading-4 text-fg-muted ring-1 ring-inset ring-line">{method}</span>
);

// ── Detail pane ──────────────────────────────────────────────────────────────

function EventDetail({ event: e, n, tab, onTab, onClose, onPrev, onNext }: {
  event: ProtocolEvent; n?: number; tab: Tab; onTab: (t: Tab) => void; onClose: () => void; onPrev: () => void; onNext: () => void;
}) {
  const tabs = ([['decoded', 'Decoded', !!e.data], ['request', 'Request', !!e.request], ['response', 'Response', !!e.response]] as const)
    .filter(([, , ok]) => ok).map(([value, label]) => ({ value: value as Tab, label }));
  const active: Tab | undefined = tabs.some((t) => t.value === tab) ? tab : tabs[0]?.value;

  return (
    <div className="flex h-[58%] shrink-0 flex-col border-t border-line bg-surface shadow-[0_-8px_16px_-12px_rgb(0_0_0/0.15)]">
      <div className="flex items-start gap-2 border-b border-line px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {n != null && <span className="font-mono text-xs text-fg-subtle">[{n}]</span>}
            <div className="truncate text-[13px] font-semibold text-fg">{titleOf(e)}</div>
          </div>
          <div className="truncate text-xs text-fg-subtle" title={e.summary}>{e.summary}</div>
        </div>
        <div className="-mr-1.5 flex items-center">
          <IconButton icon={ChevronUp} label="Previous event (↑)" size="sm" onClick={onPrev} />
          <IconButton icon={ChevronDown} label="Next event (↓)" size="sm" onClick={onNext} />
          <IconButton icon={X} label="Close (Esc)" size="sm" onClick={onClose} />
        </div>
      </div>
      {tabs.length > 1 && (
        <div className="border-b border-line px-4 py-2">
          <SegmentedControl size="xs" label="Event detail" value={active!} onChange={onTab} options={tabs} />
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {!active && <div className="text-sm text-fg-muted">{e.summary}</div>}
        {active === 'decoded' && e.data && <Decoded data={e.data} />}
        {active === 'request' && e.request && <RequestPane request={e.request} />}
        {active === 'response' && e.response && (
          <>
            <div className="flex items-center gap-2 text-xs text-fg-subtle">
              <Badge tone={e.response.status >= 400 ? 'danger' : 'success'} mono>HTTP {e.response.status}</Badge>
              {e.response.durationMs != null && <span className="tabular-nums">{e.response.durationMs} ms</span>}
            </div>
            {e.response.body !== undefined ? <JsonView value={e.response.body} maxHeight="max-h-none" /> : <div className="text-sm text-fg-subtle">Empty body</div>}
          </>
        )}
      </div>
    </div>
  );
}

function RequestPane({ request: r }: { request: NonNullable<ProtocolEvent['request']> }) {
  const headers = Object.entries(r.headers ?? {});
  return (
    <>
      <div className="flex items-center gap-2 rounded-lg bg-[var(--code-bg)] py-1.5 pl-2.5 pr-1 ring-1 ring-inset ring-line">
        <MethodTag method={r.method} />
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg" title={r.url}>{r.url}</code>
        <CopyButton text={r.url} label="Copy URL" />
      </div>
      <div className="flex justify-end"><CopyButton text={toCurl(r)} label="Copy as cURL" showLabel /></div>
      {headers.length > 0 && (
        <Section title="Headers">
          <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-lg bg-[var(--code-bg)] p-3 font-mono text-xs ring-1 ring-inset ring-line">
            {headers.map(([k, v]) => <Fragment key={k}><dt className="text-fg-subtle">{k}</dt><dd className="break-all text-fg">{v}</dd></Fragment>)}
          </dl>
        </Section>
      )}
      {r.body !== undefined && <Section title="Body"><JsonView value={r.body} maxHeight="max-h-none" /></Section>}
    </>
  );
}

function toCurl(r: NonNullable<ProtocolEvent['request']>) {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const headers = Object.entries(r.headers ?? {});
  const ct = headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  const parts = [`curl -X ${r.method} ${q(r.url)}`, ...headers.map(([k, v]) => `-H ${q(`${k}: ${v}`)}`)];
  if (r.body !== undefined) {
    const body = typeof r.body === 'string' ? r.body
      : ct.includes('x-www-form-urlencoded') ? new URLSearchParams(r.body as Record<string, string>).toString()
      : JSON.stringify(r.body);
    if (!ct && typeof r.body !== 'string') parts.push(`-H ${q('content-type: application/json')}`);
    parts.push(`--data-raw ${q(body)}`);
  }
  return parts.join(' \\\n  ');
}

// ── Decoded artefacts (JWT, SD-JWT, URIs, objects) ───────────────────────────

type Jwt = { header: Record<string, unknown>; payload: Record<string, unknown> };
type SdJwt = { issuerJwt: Jwt; disclosures: Array<[string, string, unknown] | unknown[]>; keyBindingJwt: Jwt | null };

function Decoded({ data }: { data: Record<string, unknown> }) {
  return (
    <>
      {Object.entries(data).map(([key, v]) => {
        const typed = v && typeof v === 'object' && 'type' in v ? (v as { type: string }).type : undefined;
        return (
          <section key={key}>
            <div className="mb-1.5 flex items-center gap-2">
              <code className="font-mono text-xs font-medium text-fg">{key}</code>
              {(typed === 'JWT' || typed === 'SD-JWT') && <Badge tone="violet" size="xs">{typed}</Badge>}
            </div>
            {typed === 'JWT' ? <JwtView jwt={v as Jwt} />
              : typed === 'SD-JWT' ? <SdJwtView sd={v as SdJwt} />
              : typeof v === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? <UriView uri={v} />
              : <JsonView value={v} />}
          </section>
        );
      })}
    </>
  );
}

function JwtView({ jwt }: { jwt: Jwt }) {
  const times = (['iat', 'nbf', 'exp'] as const).filter((k) => typeof jwt.payload?.[k] === 'number');
  return (
    <div className="space-y-2">
      <Section title="Header" compact><JsonView value={jwt.header} compact /></Section>
      <Section title="Payload" compact>
        <JsonView value={jwt.payload} />
        {times.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-subtle">
            {times.map((k) => {
              const d = new Date((jwt.payload[k] as number) * 1000);
              const past = d.getTime() < Date.now();
              return <span key={k}><span className="font-mono">{k}</span> {d.toLocaleString()}{k === 'exp' && past && <span className="ml-1 font-medium text-danger-fg">(expired)</span>}</span>;
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

function SdJwtView({ sd }: { sd: SdJwt }) {
  return (
    <div className="space-y-3 rounded-lg border border-line p-3">
      <Section title="Issuer-signed JWT"><JwtView jwt={sd.issuerJwt} /></Section>
      <Section title={`Disclosures (${sd.disclosures?.length ?? 0})`}>
        {sd.disclosures?.length ? (
          <div className="overflow-hidden rounded-lg ring-1 ring-inset ring-line">
            <table className="w-full text-xs">
              <thead className="bg-sunken text-left text-fg-subtle">
                <tr><th scope="col" className="px-3 py-1.5 font-medium">Claim</th><th scope="col" className="px-3 py-1.5 font-medium">Value</th><th scope="col" className="hidden px-3 py-1.5 font-medium sm:table-cell">Salt</th></tr>
              </thead>
              <tbody className="divide-y divide-line font-mono">
                {sd.disclosures.map((d, i) => {
                  const [salt, claim, value] = d.length === 3 ? d : [d[0], '(array element)', d[1]];
                  return (
                    <tr key={i}>
                      <td className="px-3 py-1.5 text-[var(--code-key)]">{String(claim)}</td>
                      <td className="break-all px-3 py-1.5 text-fg">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</td>
                      <td className="hidden max-w-32 truncate px-3 py-1.5 text-fg-subtle sm:table-cell" title={String(salt)}>{String(salt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="text-xs text-fg-subtle">No disclosures — nothing selectively disclosed.</div>}
      </Section>
      <Section title="Key-binding JWT">
        {sd.keyBindingJwt ? <JwtView jwt={sd.keyBindingJwt} /> : <div className="text-xs text-fg-subtle">None — the holder didn’t bind this presentation to a key.</div>}
      </Section>
    </div>
  );
}

function UriView({ uri }: { uri: string }) {
  let params: Array<[string, string]> = [];
  try { params = [...new URL(uri).searchParams.entries()]; } catch { /* not parseable */ }
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded-lg bg-[var(--code-bg)] p-2.5 pr-1.5 ring-1 ring-inset ring-line">
        <Terminal size={13} className="mt-0.5 shrink-0 text-fg-subtle" aria-hidden />
        <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-fg">{uri}</code>
        <CopyButton text={uri} label="Copy URI" />
      </div>
      {params.length > 0 && (
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 px-1 font-mono text-[11px]">
          {params.map(([k, v]) => <Fragment key={k}><dt className="text-fg-subtle">{k}</dt><dd className="break-all text-fg">{v}</dd></Fragment>)}
        </dl>
      )}
    </div>
  );
}

function Section({ title, children, compact }: { title: string; children: ReactNode; compact?: boolean }) {
  return (
    <div>
      <div className={cn('eyebrow', compact ? 'mb-1' : 'mb-1.5')}>{title}</div>
      {children}
    </div>
  );
}
