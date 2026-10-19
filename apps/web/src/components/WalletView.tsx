import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, CircleAlert, FlaskConical, RefreshCw, RotateCcw, SearchX, Wallet, X } from 'lucide-react';
import { api, useLive, useOnReconnect, type Format, type WalletCredential } from '../api';
import { useCatalog } from '../lib/app';
import { absoluteTime, pluralize, relativeTime, useNow } from '../lib/format';
import { CredentialCard, credentialDisplay, issuerName, shortIssuer, type CredentialDisplay } from './domain';
import { JsonView } from './JsonView';
import { Tooltip, Dialog } from './overlays';
import {
  Alert, Badge, Button, Card, CopyButton, EmptyState, PageHeader, SearchInput, SectionLabel, SegmentedControl, Select, Skeleton,
  buttonClass, cn,
} from './ui';

const PAGE = 24;
const REFETCH_DEBOUNCE_MS = 600;
const WALLET_ID = 'playground-wallet';
/** The server keeps only the most recent 50 (apps/server/src/actors/wallet.ts), so older ones drop off. */
const WALLET_CAP = 50;

type FormatFilter = 'all' | Format;
interface Row { c: WalletCredential; d: CredentialDisplay; issuerLabel: string; haystack: string }

/** Credentials held by the headless Reference Wallet, newest first; refreshes when a run that issued to it finishes. */
export function WalletView() {
  const catalog = useCatalog();
  const now = useNow();
  const { creds, error, loading, fresh, load } = useWallet();

  const [format, setFormat] = useState<FormatFilter>('all');
  const [issuer, setIssuer] = useState('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [openId, setOpenId] = useState<string>();

  const rows = useMemo<Row[]>(() => (creds ?? [])
    .slice()
    .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
    .map((c) => {
      const d = credentialDisplay(c.summary, c.configId);
      return { c, d, issuerLabel: issuerName(c.issuer, catalog) ?? shortIssuer(c.issuer), haystack: [d.title, d.holder, ...d.claims.map(([, v]) => v)].join('\n').toLowerCase() };
    }),
  // `now` keeps `expired` honest for a page left open.
  [creds, catalog, now]);

  const q = query.trim().toLowerCase();
  const matchQuery = (r: Row) => !q || r.haystack.includes(q);
  const matchFormat = (r: Row) => format === 'all' || r.c.format === format;
  const matchIssuer = (r: Row) => issuer === 'all' || r.c.issuer === issuer;
  const filtered = rows.filter((r) => matchQuery(r) && matchFormat(r) && matchIssuer(r));
  const isFiltered = format !== 'all' || issuer !== 'all' || !!q;

  // Facet counts: each control counts what the *other* filters let through.
  const formatPool = rows.filter((r) => matchQuery(r) && matchIssuer(r));
  const formatOptions = [
    { value: 'all' as FormatFilter, label: 'All', count: formatPool.length },
    ...(Object.keys(catalog.formats) as Format[]).map((f) => {
      const count = formatPool.filter((r) => r.c.format === f).length;
      return { value: f as FormatFilter, label: catalog.formats[f].short, title: catalog.formats[f].label, count, disabled: !count && format !== f };
    }),
  ];
  const issuerPool = rows.filter((r) => matchQuery(r) && matchFormat(r));
  const issuerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.c.issuer)) seen.set(r.c.issuer, r.issuerLabel);
    if (issuer !== 'all' && !seen.has(issuer)) seen.set(issuer, issuerName(issuer, catalog) ?? shortIssuer(issuer));
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [rows, issuer, catalog]);

  const resetPaging = () => setLimit(PAGE);
  const clearFilters = () => { setFormat('all'); setIssuer('all'); setQuery(''); resetPaging(); };

  const visible = filtered.slice(0, limit);
  const remaining = filtered.length - visible.length;
  const expiredCount = rows.filter((r) => r.d.expired).length;
  const selected = rows.find((r) => r.c.id === openId);

  return (
    <div className="space-y-5">
      <PageHeader title="Wallet"
        description="Credentials held by the headless Reference Wallet, newest first. Every run that issues to the Reference Wallet adds one here."
        actions={<Button icon={RefreshCw} loading={loading} onClick={load}>Refresh</Button>} />

      {error && (
        <Alert tone="danger" icon={CircleAlert} title={creds ? 'Couldn’t refresh the wallet' : 'Couldn’t load the wallet'}
          action={<Button size="sm" variant="secondary" icon={RotateCcw} loading={loading} onClick={load}>Retry</Button>}>
          {creds ? `Showing the credentials from the last successful load. (${error})` : `GET /api/wallet failed: ${error}`}
        </Alert>
      )}

      {!creds ? (
        !error && <LoadingState />
      ) : !rows.length ? (
        <Card>
          <EmptyState icon={Wallet} title="The wallet is empty"
            description="Run a flow with the Reference Wallet as the holder and the credential it receives will show up here."
            action={<a href="#playground" className={buttonClass('primary')}><FlaskConical size={16} aria-hidden />Open the Playground</a>} />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl label="Credential format" size="md" value={format} options={formatOptions}
              onChange={(v) => { setFormat(v); resetPaging(); }}
              className="w-full sm:w-auto max-sm:[&>button]:flex-1 max-sm:[&>button]:gap-1 max-sm:[&>button]:px-1.5 max-sm:[&>button]:text-[13px]" />
            <Select label="Issuer" hideLabel value={issuer} className="w-full sm:w-56"
              onChange={(v) => { setIssuer(v); resetPaging(); }}
              options={[
                { value: 'all', label: `All issuers (${issuerPool.length})` },
                ...issuerOptions.map((o) => ({ ...o, label: `${o.label} (${issuerPool.filter((r) => r.c.issuer === o.value).length})` })),
              ]} />
            <SearchInput value={query} onChange={(v) => { setQuery(v); resetPaging(); }}
              placeholder="Search names, types, claims…" label="Search credentials" className="w-full sm:ml-auto sm:w-72" />
          </div>

          <div className="-mt-1 flex min-h-7 flex-wrap items-center gap-x-2 text-[13px] text-fg-subtle" aria-live="polite">
            {isFiltered ? (
              <>
                <span>Showing <span className="font-medium tabular-nums text-fg">{filtered.length}</span> of <span className="tabular-nums">{rows.length}</span> credentials</span>
                <Button size="xs" variant="ghost" icon={X} onClick={clearFilters}>Clear filters</Button>
              </>
            ) : (
              <span className="tabular-nums">
                {pluralize(rows.length, 'credential')}
                {expiredCount > 0 && <> · {expiredCount} expired</>}
                {rows.length >= WALLET_CAP && <> · keeps the latest {WALLET_CAP}</>}
              </span>
            )}
          </div>

          {filtered.length ? (
            <>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-label="Credentials">
                {visible.map((r) => (
                  <li key={r.c.id} className="flex">
                    <CredentialCard format={r.c.format} summary={r.c.summary} fallbackType={r.c.configId} issuer={r.c.issuer} catalog={catalog}
                      onClick={() => setOpenId(r.c.id)}
                      footer={<>
                        <Tooltip content={`Received ${absoluteTime(r.c.receivedAt)}`}>
                          <time dateTime={r.c.receivedAt} className="truncate">Received {relativeTime(r.c.receivedAt, now)}</time>
                        </Tooltip>
                        {fresh.has(r.c.id) && <Badge tone="brand" size="xs">New</Badge>}
                        <span className="ml-auto" />
                        <ValidityBadge d={r.d} now={now} />
                      </>} />
                  </li>
                ))}
              </ul>
              {remaining > 0 && (
                <div className="flex justify-center pt-1">
                  <Button icon={ChevronDown} onClick={() => setLimit((l) => l + PAGE)}>
                    Show more <span className="font-normal tabular-nums text-fg-subtle">({remaining} remaining)</span>
                  </Button>
                </div>
              )}
            </>
          ) : (
            <Card>
              <EmptyState icon={SearchX} title="No credentials match these filters"
                description={q
                  ? <>Nothing matches “{query.trim()}”{format !== 'all' || issuer !== 'all' ? ' with the selected format and issuer' : ''}. Search looks at credential types, holders and claim values.</>
                  : 'No credentials have this combination of format and issuer.'}
                action={<Button icon={X} onClick={clearFilters}>Clear filters</Button>} />
            </Card>
          )}
        </>
      )}

      <CredentialSheet row={selected} now={now} onClose={() => setOpenId(undefined)} />
    </div>
  );
}

// ── Data ─────────────────────────────────────────────────────────────────────

/** Fetches `/api/wallet` on mount, on reconnect, and (debounced) whenever a Reference Wallet run finishes. */
function useWallet() {
  const [creds, setCreds] = useState<WalletCredential[] | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const seq = useRef(0);
  const known = useRef<Set<string> | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const data = await api.wallet();
      if (id !== seq.current) return;
      const prev = known.current;
      if (prev) {
        const added = data.filter((c) => !prev.has(c.id)).map((c) => c.id);
        if (added.length) setFresh((f) => new Set([...f, ...added]));
      }
      known.current = new Set(data.map((c) => c.id));
      setCreds(data);
      setError(undefined);
    } catch (e) {
      if (id === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => clearTimeout(debounce.current);
  }, [load]);
  useOnReconnect(load);
  useLive((m) => {
    if (m.type !== 'run' || m.run.state === 'running' || m.run.wallet !== WALLET_ID) return;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(load, REFETCH_DEBOUNCE_MS);
  });

  return { creds, error, loading, fresh, load };
}

// ── Pieces ───────────────────────────────────────────────────────────────────

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' });
const DAY = 86_400;
// [unit, seconds per unit, switch to this unit from this many seconds] — "in 1 year" rather than "in 12 months".
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number, number]> = [
  ['year', 365 * DAY, 345 * DAY], ['month', 30 * DAY, 27 * DAY], ['day', DAY, DAY], ['hour', 3600, 3600], ['minute', 60, 60],
];

/** "in 1 year", "1 month ago" — `relativeTime` switches to a date after a week, which is wrong for expiry. */
function distance(iso: string, now: number) {
  const s = (Date.parse(iso) - now) / 1000;
  if (Number.isNaN(s)) return '';
  for (const [unit, secs, from] of UNITS) if (Math.abs(s) >= from) return rtf.format(Math.round(s / secs), unit);
  return rtf.format(Math.round(s), 'second');
}

function ValidityBadge({ d, now, size = 'sm' }: { d: CredentialDisplay; now: number; size?: 'xs' | 'sm' | 'md' }) {
  const tip = d.expires
    ? `${d.expired ? 'Expired' : 'Expires'} ${absoluteTime(d.expires)} (${distance(d.expires, now)})`
    : 'No expiry date in the credential';
  return (
    <Tooltip content={tip}>
      <span className="inline-flex">
        <Badge tone={d.expired ? 'danger' : 'success'} size={size} dot>{d.expired ? 'Expired' : 'Valid'}</Badge>
      </span>
    </Tooltip>
  );
}

function LoadingState() {
  const bar = (w: string, h = 'h-3') => <div className={cn('rounded', h, w, 'bg-line')} />;
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading credentials">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-full sm:w-80" />
        <Skeleton className="h-9 w-full sm:w-56" />
        <Skeleton className="h-9 w-full sm:ml-auto sm:w-72" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className={cn('card animate-pulse overflow-hidden', i >= 6 && 'hidden 2xl:block')} aria-hidden>
            <div className="space-y-3 bg-sunken px-4 pb-4 pt-3.5">
              <div className="flex justify-between">{bar('w-14', 'h-4')}{bar('w-24')}</div>
              <div className="pt-1">{bar('w-48', 'h-4')}</div>
              {bar('w-24', 'h-3.5')}
            </div>
            <div className="space-y-3 px-4 py-3.5">
              {['w-20', 'w-28', 'w-24', 'w-16'].map((w, j) => (
                <div key={j} className="flex justify-between gap-4">{bar(w)}{bar(j % 2 ? 'w-20' : 'w-28')}</div>
              ))}
            </div>
            <div className="flex justify-between border-t border-line px-4 py-3">{bar('w-28')}{bar('w-12')}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('divide-y divide-line overflow-hidden rounded-lg border border-line text-sm', className)}>{children}</dl>;
}

/** Label/value row; `stack` puts the label above long values on phones. */
function DetailRow({ label, children, stack }: { label: ReactNode; children: ReactNode; stack?: boolean }) {
  return (
    <div className={cn('grid px-3.5 py-2.5',
      stack ? 'gap-0.5 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:items-baseline sm:gap-3' : 'grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] items-baseline gap-3')}>
      <dt className={cn('text-fg-subtle', stack && 'text-[13px] sm:text-sm')}>{label}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}

function CredentialSheet({ row, now, onClose }: { row?: Row; now: number; onClose: () => void }) {
  const catalog = useCatalog();
  if (!row) return null;
  const { c, d, issuerLabel } = row;
  const known = issuerName(c.issuer, catalog);
  const raw = c.credential;
  return (
    <Dialog open onClose={onClose} variant="sheet" title={d.title}
      description={[d.holder, issuerLabel].filter(Boolean).join(' · ')}>
      <div className="space-y-6">
        <div className="rounded-xl bg-sunken px-4 py-6 ring-1 ring-inset ring-line sm:px-8">
          <CredentialCard format={c.format} summary={c.summary} fallbackType={c.configId} issuer={c.issuer} catalog={catalog} maxClaims={50}
            className="mx-auto max-w-sm" />
        </div>

        <section>
          <SectionLabel>Details</SectionLabel>
          <DetailList>
            <DetailRow stack label="Format">{catalog.formats[c.format]?.label ?? c.format}</DetailRow>
            <DetailRow stack label="Configuration">
              {c.configId ? <span className="font-mono text-[13px]">{c.configId}</span> : <span className="text-fg-subtle">—</span>}
            </DetailRow>
            <DetailRow stack label="Issuer">
              <div className="flex items-start gap-1">
                <div className="min-w-0 flex-1">
                  {known && <div className="font-medium">{known}</div>}
                  <div className={cn('break-all font-mono text-[12.5px] leading-5', known && 'text-fg-muted')}>{c.issuer}</div>
                </div>
                <CopyButton text={c.issuer} label="Copy issuer" className="-my-1" />
              </div>
            </DetailRow>
            <DetailRow stack label="Received">
              <time dateTime={c.receivedAt} className="tabular-nums">{absoluteTime(c.receivedAt)}</time>
              <span className="text-fg-subtle"> · {relativeTime(c.receivedAt, now)}</span>
            </DetailRow>
            <DetailRow stack label="Expires">
              {d.expires ? (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <time dateTime={d.expires} className="tabular-nums">{absoluteTime(d.expires)}</time>
                  <span className="text-fg-subtle">{distance(d.expires, now)}</span>
                  <Badge tone={d.expired ? 'danger' : 'success'} dot>{d.expired ? 'Expired' : 'Valid'}</Badge>
                </div>
              ) : <span className="text-fg-subtle">No expiry date</span>}
            </DetailRow>
          </DetailList>
        </section>

        <section>
          <SectionLabel action={<span className="text-xs tabular-nums text-fg-subtle">{pluralize(d.claims.length, 'claim')}</span>}>All claims</SectionLabel>
          {d.claims.length ? (
            <DetailList>
              {d.claims.map(([k, v]) => <DetailRow key={k} label={k}>{v}</DetailRow>)}
            </DetailList>
          ) : (
            <div className="rounded-lg border border-dashed border-line px-3.5 py-3 text-sm text-fg-subtle">No disclosed claims.</div>
          )}
        </section>

        <section className="min-w-0">
          <SectionLabel action={typeof raw === 'string' ? <span className="text-xs tabular-nums text-fg-subtle">{raw.length.toLocaleString()} characters</span> : undefined}>
            Raw credential
          </SectionLabel>
          <JsonView value={raw} />
        </section>
      </div>
    </Dialog>
  );
}
