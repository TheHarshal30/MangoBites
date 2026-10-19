import type { ReactNode } from 'react';
import { ArrowRight, CircleAlert, CircleCheck, CircleX, LoaderCircle } from 'lucide-react';
import type { Catalog, CredentialSummary, Format, Party, RunSummary, Verdict } from '../api';
import { SCENARIOS, scenarioOf, type ScenarioId } from '../lib/flow';
import { formatClaimValue, humanizeKey, humanizeType } from '../lib/format';
import { Badge, cn, type Tone } from './ui';

// ── Run status ───────────────────────────────────────────────────────────────

export type RunStatus = 'running' | 'pass' | 'fail' | 'error';

export const runStatus = (r: Pick<RunSummary, 'state' | 'result'>): RunStatus =>
  r.state === 'running' ? 'running' : r.result === 'PASS' ? 'pass' : r.result === 'FAIL' ? 'fail' : 'error';

const STATUS_META: Record<RunStatus, { label: string; tone: Tone; icon: typeof CircleCheck }> = {
  running: { label: 'Running', tone: 'info', icon: LoaderCircle },
  pass: { label: 'Pass', tone: 'success', icon: CircleCheck },
  fail: { label: 'Fail', tone: 'danger', icon: CircleX },
  error: { label: 'Error', tone: 'danger', icon: CircleAlert },
};

export function ResultBadge({ run, size = 'sm', solid }: { run: Pick<RunSummary, 'state' | 'result'>; size?: 'xs' | 'sm' | 'md'; solid?: boolean }) {
  const m = STATUS_META[runStatus(run)];
  return (
    <Badge tone={m.tone} size={size} solid={solid} icon={m.icon} className={runStatus(run) === 'running' ? '[&>svg]:animate-spin' : undefined}>
      {m.label}
    </Badge>
  );
}

/** Status icon alone, e.g. for dense lists. */
export function StatusIcon({ run, size = 16 }: { run: Pick<RunSummary, 'state' | 'result'>; size?: number }) {
  const s = runStatus(run);
  const m = STATUS_META[s];
  return <m.icon size={size} aria-label={m.label} className={cn('shrink-0', s === 'running' ? 'animate-spin text-info' : s === 'pass' ? 'text-success' : 'text-danger')} />;
}

export const verdictTone = (v?: Verdict | string): Tone => (v === 'VALID' ? 'success' : v === 'EXPIRED' ? 'warning' : v ? 'danger' : 'neutral');

export function VerdictBadge({ verdict, size = 'sm' }: { verdict?: Verdict | string; size?: 'xs' | 'sm' | 'md' }) {
  if (!verdict) return <span className="text-fg-subtle">—</span>;
  return <Badge tone={verdictTone(verdict)} size={size} className="font-mono tracking-tight">{verdict}</Badge>;
}

// ── Parties, formats, scenarios ──────────────────────────────────────────────

export const ROLE_TEXT: Record<string, string> = {
  issuer: 'text-role-issuer',
  wallet: 'text-role-wallet',
  verifier: 'text-role-verifier',
  playground: 'text-role-playground',
};
export const ROLE_LABEL: Record<Party['role'], string> = { issuer: 'Issuer', wallet: 'Wallet', verifier: 'Verifier' };

export const isInji = (p?: Pick<Party, 'vendor'>) => p?.vendor === 'Inji';

export function VendorBadge({ party, size = 'xs' }: { party: Pick<Party, 'vendor'>; size?: 'xs' | 'sm' }) {
  return isInji(party) ? <Badge tone="brand" size={size}>Inji</Badge> : <Badge tone="neutral" size={size}>Reference</Badge>;
}

/** "v0.14.0" for real releases; nothing for the playground's own reference parties. */
export const versionLabel = (p: Pick<Party, 'version'>) => (p.version === 'playground' ? undefined : p.version.startsWith('≥') ? p.version : `v${p.version}`);

export function FormatBadge({ format, catalog, size = 'sm' }: { format: Format; catalog: Catalog; size?: 'xs' | 'sm' | 'md' }) {
  return <Badge tone="neutral" size={size} title={catalog.formats[format]?.label}>{catalog.formats[format]?.short ?? format}</Badge>;
}

/** Scenario badges describe the test, not its outcome — so negative tests are violet, never the red of a failure. */
export const scenarioTone = (s: ScenarioId): Tone => (s === 'happy' ? 'neutral' : 'violet');

export function ScenarioBadge({ run, scenario, size = 'sm' }: { run?: Pick<RunSummary, 'tamper' | 'expired'>; scenario?: ScenarioId; size?: 'xs' | 'sm' | 'md' }) {
  const id = scenario ?? scenarioOf(run!);
  const s = SCENARIOS[id];
  return <Badge tone={scenarioTone(id)} size={size} icon={s.icon} title={s.description}>{s.label}</Badge>;
}

/** "Inji Certify → Reference Wallet → Inji Verify · OpenID4VP" on one line, truncating names rather than wrapping. */
export function FlowLabel({ run, name, className, showWallet = true }: {
  run: Pick<RunSummary, 'issuer' | 'wallet' | 'verifier'>; name: (id: string) => string; className?: string; showWallet?: boolean;
}) {
  const ids = showWallet ? [run.issuer, run.wallet, run.verifier] : [run.issuer, run.verifier];
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)}>
      {ids.map((id, i) => (
        <span key={`${id}-${i}`} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <ArrowRight size={12} className="shrink-0 text-fg-subtle" aria-label="to" />}
          <span className="truncate">{name(id)}</span>
        </span>
      ))}
    </span>
  );
}

// ── Credentials ──────────────────────────────────────────────────────────────

export interface CredentialDisplay {
  title: string;
  holder?: string;
  issuer?: string;
  expires?: string;
  expired: boolean;
  claims: Array<[string, string]>;
}

/** Normalises the per-format credential summaries (JSON-LD subject, SD-JWT claims, mDoc namespaces). */
export function credentialDisplay(summary: CredentialSummary | undefined, fallbackType?: string): CredentialDisplay {
  const s = summary ?? {};
  const types = ([] as string[]).concat((s.type as string | string[] | undefined) ?? []).filter((t) => t !== 'VerifiableCredential');
  const title = humanizeType(types[0] ?? s.vct ?? s.docType ?? fallbackType);
  const raw = (s.subject ?? s.claims ?? {}) as Record<string, unknown>;
  const claims = Object.entries(raw)
    .filter(([k, v]) => k !== 'id' && !(Array.isArray(v) && v.every((x) => x && typeof x === 'object' && !Object.keys(x).length)))
    .map(([k, v]) => [humanizeKey(k), formatClaimValue(v)] as [string, string]);
  const given = raw.given_name ?? raw.givenName, family = raw.family_name ?? raw.familyName;
  const holder = (raw.fullName ?? raw.name ?? (given || family ? [given, family].filter(Boolean).join(' ') : undefined)) as string | undefined;
  const expires = (s.expires ?? (s.validityInfo as { validUntil?: string } | undefined)?.validUntil) as string | undefined;
  return { title, holder, issuer: s.issuer, expires, expired: !!expires && Date.parse(expires) < Date.now(), claims };
}

/** Shortens `did:key:z6Mkuph…xeEmCq` and URLs to their host for display. */
export function shortIssuer(issuer?: string) {
  if (!issuer) return '—';
  if (issuer.startsWith('did:')) {
    const parts = issuer.split(':');
    const id = parts.slice(2).join(':');
    return `${parts[0]}:${parts[1]}:${id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-5)}` : id}`;
  }
  try { const u = new URL(issuer); return u.host + (u.pathname !== '/' ? u.pathname : ''); } catch { return issuer; }
}

/** Maps an issuer URL / DID back to a catalog party name when we can tell. */
export function issuerName(issuer: string | undefined, catalog: Catalog) {
  if (!issuer) return undefined;
  const certifyDid = (catalog.parties.find((p) => p.id === 'inji-certify')?.health as { issuerDid?: string } | undefined)?.issuerDid;
  if (issuer === certifyDid || issuer.startsWith(catalog.endpoints.certify ?? '\u0000')) return 'Inji Certify';
  if (issuer.startsWith(`${catalog.endpoints.playground ?? '\u0000'}/issuer`)) return 'Reference Issuer';
  return undefined;
}

const FORMAT_THEME: Record<Format, string> = {
  ldp_vc: 'from-[#4f46e5] to-[#312e81]',
  'vc+sd-jwt': 'from-[#e11d48] to-[#881337]',
  mso_mdoc: 'from-[#0d9488] to-[#134e4a]',
};

/** A wallet-style credential card: coloured header with type and holder, then the claims. */
export function CredentialCard({ format, summary, fallbackType, catalog, issuer, footer, maxClaims = 4, onClick, className }: {
  format: Format; summary?: CredentialSummary; fallbackType?: string; catalog: Catalog; issuer?: string;
  footer?: ReactNode; maxClaims?: number; onClick?: () => void; className?: string;
}) {
  const d = credentialDisplay(summary, fallbackType);
  const iss = issuer ?? d.issuer;
  const issuerLabel = issuerName(iss, catalog) ?? shortIssuer(iss);
  const shown = d.claims.filter(([k]) => !d.holder || !/^(full ?name|name|given ?name|family ?name)$/i.test(k)).slice(0, maxClaims);
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      className={cn('card flex w-full flex-col overflow-hidden text-left', onClick && 'transition hover:-translate-y-px hover:border-line-strong hover:shadow-pop', className)}>
      <div className={cn('relative overflow-hidden bg-gradient-to-br px-4 pb-4 pt-3.5 text-white', FORMAT_THEME[format])}>
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full border-[18px] border-white/[0.07]" />
        <div className="relative flex items-center gap-2">
          <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide">{catalog.formats[format]?.short ?? format}</span>
          <span className="ml-auto truncate text-[11px] text-white/70" title={iss}>{issuerLabel}</span>
        </div>
        <div className="relative mt-3 truncate text-[15px] font-semibold leading-tight" title={d.title}>{d.title}</div>
        <div className="relative mt-0.5 truncate text-sm text-white/80">{d.holder ?? ' '}</div>
      </div>
      <dl className="grid flex-1 grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 px-4 py-3 text-[13px]">
        {shown.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="truncate text-fg-subtle">{k}</dt>
            <dd className="truncate text-right font-medium text-fg" title={v}>{v}</dd>
          </div>
        ))}
        {!shown.length && <div className="col-span-2 text-fg-subtle">No disclosed claims</div>}
      </dl>
      {footer && <div className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-xs text-fg-subtle">{footer}</div>}
    </Tag>
  );
}
