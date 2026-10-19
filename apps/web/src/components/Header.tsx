import { FlaskConical, Grid3x3, History, Monitor, Moon, RefreshCw, Sun, Wallet, type LucideIcon } from 'lucide-react';
import { useApp } from '../lib/app';
import { routeHref, type Route, type View } from '../lib/router';
import { useTheme, type ThemePreference } from '../lib/theme';
import { Popover } from './overlays';
import { Button, CopyButton, cn } from './ui';
import { versionLabel } from './domain';

const NAV: Array<{ view: View; label: string; icon: LucideIcon }> = [
  { view: 'playground', label: 'Playground', icon: FlaskConical },
  { view: 'matrix', label: 'Interop matrix', icon: Grid3x3 },
  { view: 'history', label: 'Run history', icon: History },
  { view: 'wallet', label: 'Wallet', icon: Wallet },
];

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fb923c" />
          <stop offset="1" stopColor="#ea580c" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#logo-g)" />
      <path d="M8.5 20 16 12l7.5 8" stroke="#fff" strokeOpacity=".55" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8.5" cy="20" r="3" fill="#fff" />
      <circle cx="16" cy="12" r="3" fill="#fff" />
      <circle cx="23.5" cy="20" r="3" fill="#fff" />
    </svg>
  );
}

export function Header({ route }: { route: Route }) {
  const { runs, sweep } = useApp();
  const running = runs.some((r) => r.state === 'running');

  const tab = (n: (typeof NAV)[number], compact = false) => {
    const active = route.view === n.view;
    const extra = n.view === 'playground' && running ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" aria-label="run in progress" />
      : n.view === 'matrix' && sweep ? <span className="rounded bg-info-soft px-1 text-[10.5px] font-semibold tabular-nums text-info-fg">{sweep.done}/{sweep.total}</span>
      : n.view === 'history' && runs.length ? <span className="text-[11px] tabular-nums text-fg-subtle">{runs.length}</span>
      : null;
    return (
      <a key={n.view} href={routeHref({ view: n.view })} aria-current={active ? 'page' : undefined}
        className={cn('inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-lg px-2.5 text-[13px] font-medium transition-colors',
          active ? 'bg-hover text-fg' : 'text-fg-muted hover:bg-hover/60 hover:text-fg')}>
        {!compact && <n.icon size={15} aria-hidden className={active ? 'text-brand' : undefined} />}
        {compact && n.view === 'matrix' ? 'Matrix' : compact && n.view === 'history' ? 'History' : n.label}
        {(!compact || n.view !== 'history') && extra}
      </a>
    );
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md supports-[backdrop-filter]:bg-surface/75">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-5 px-4 sm:px-6">
        <a href={routeHref({ view: 'playground' })} className="flex items-center gap-2.5 rounded-lg" aria-label="Inji Interop Playground — home">
          <LogoMark />
          <div className="leading-tight">
            <div className="whitespace-nowrap text-[14px] font-semibold tracking-tight text-fg">Inji Interop Playground</div>
            <div className="hidden whitespace-nowrap text-[11px] text-fg-subtle sm:block">OpenID4VCI · OpenID4VP conformance</div>
          </div>
        </a>
        <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex">{NAV.map((n) => tab(n))}</nav>
        <div className="ml-auto flex items-center gap-1.5">
          <ServiceStatus />
          <ThemeMenu />
        </div>
      </div>
      <nav aria-label="Main" className="grid grid-cols-4 gap-1 px-3 pb-2 sm:px-5 lg:hidden">{NAV.map((n) => tab(n, true))}</nav>
    </header>
  );
}

function ServiceStatus() {
  const { catalog, catalogError, connection, refreshCatalog } = useApp();
  const injiParties = catalog?.parties.filter((p) => p.vendor === 'Inji' && p.mode === 'auto' && p.id !== 'inji-verify-direct') ?? [];
  const down = injiParties.filter((p) => p.health && !p.health.up);
  const state: 'ok' | 'degraded' | 'offline' | 'loading' = catalogError ? 'offline' : !catalog ? 'loading' : down.length ? 'degraded' : 'ok';
  const label = { ok: 'All services up', degraded: `${down.length} service${down.length > 1 ? 's' : ''} down`, offline: 'API offline', loading: 'Checking…' }[state];
  const dot = { ok: 'bg-success', degraded: 'bg-warning', offline: 'bg-danger', loading: 'bg-fg-subtle animate-pulse' }[state];

  return (
    <Popover width="w-[22rem]" trigger={(p) => (
      <button type="button" onClick={p.toggle} aria-expanded={p['aria-expanded']} aria-haspopup="dialog"
        className="inline-flex h-8 items-center gap-2 rounded-lg border border-line px-2.5 text-[13px] font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg">
        <span className="relative flex h-2 w-2">
          {state === 'ok' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-40 [animation-duration:2.5s]" />}
          <span className={cn('relative inline-flex h-2 w-2 rounded-full', dot)} />
        </span>
        <span className="hidden sm:inline">{label}</span>
      </button>
    )}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="text-sm font-semibold">Service status</div>
        <Button size="xs" variant="ghost" icon={RefreshCw} onClick={() => refreshCatalog()}>Refresh</Button>
      </div>
      <ul className="divide-y divide-line">
        {catalogError && <StatusRow name="Playground API" ok={false} detail={catalogError} />}
        {injiParties.map((p) => <StatusRow key={p.id} name={p.name.replace(/ · .*/, '')} version={versionLabel(p)} ok={!!p.health?.up} detail={p.health?.detail} />)}
        {catalog && <StatusRow name="Reference parties" ok detail="Issuer, wallet and verifier built into the playground" />}
        <StatusRow name="Live updates" ok={connection === 'open'} pending={connection === 'connecting'} detail={connection === 'open' ? 'WebSocket connected' : connection === 'connecting' ? 'Connecting…' : 'Disconnected — retrying'} />
      </ul>
      {catalog && (
        <div className="border-t border-line bg-sunken/50 px-4 py-3">
          <div className="eyebrow mb-2">Endpoints</div>
          <dl className="space-y-1.5 text-xs">
            {Object.entries(catalog.endpoints).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <dt className="w-20 shrink-0 capitalize text-fg-subtle">{k}</dt>
                <dd className="min-w-0 flex-1 truncate font-mono text-fg-muted" title={v}>{v}</dd>
                <CopyButton text={v} label={`Copy ${k} URL`} size="sm" />
              </div>
            ))}
          </dl>
        </div>
      )}
    </Popover>
  );
}

function StatusRow({ name, version, ok, pending, detail }: { name: string; version?: string; ok: boolean; pending?: boolean; detail?: string }) {
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', pending ? 'animate-pulse bg-warning' : ok ? 'bg-success' : 'bg-danger')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="font-medium text-fg">{name}</span>
          {version && <span className="text-xs text-fg-subtle">{version}</span>}
          <span className={cn('ml-auto text-xs font-medium', pending ? 'text-warning-fg' : ok ? 'text-success-fg' : 'text-danger-fg')}>{pending ? 'Connecting' : ok ? 'Operational' : 'Unavailable'}</span>
        </div>
        {detail && <div className="mt-0.5 truncate text-xs text-fg-subtle" title={detail}>{detail}</div>}
      </div>
    </li>
  );
}

const THEMES: Array<{ value: ThemePreference; label: string; icon: LucideIcon }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function ThemeMenu() {
  const { preference, resolved, setPreference } = useTheme();
  const Icon = resolved === 'dark' ? Moon : Sun;
  return (
    <Popover width="w-40" trigger={(p) => (
      <button type="button" onClick={p.toggle} aria-expanded={p['aria-expanded']} aria-haspopup="dialog" aria-label="Theme" title="Theme"
        className="grid h-8 w-8 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-hover hover:text-fg">
        <Icon size={16} aria-hidden />
      </button>
    )}>
      {(close) => (
        <div className="p-1" role="menu">
          {THEMES.map((t) => (
            <button key={t.value} type="button" role="menuitemradio" aria-checked={preference === t.value} onClick={() => { setPreference(t.value); close(); }}
              className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors hover:bg-hover', preference === t.value ? 'font-medium text-fg' : 'text-fg-muted')}>
              <t.icon size={15} aria-hidden />
              {t.label}
              {preference === t.value && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand" />}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
