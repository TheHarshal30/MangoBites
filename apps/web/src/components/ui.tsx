import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { Check, ChevronDown, Copy, LoaderCircle, Search, X, type LucideIcon } from 'lucide-react';

export const cn = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

// ── Button ───────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const BUTTON_BASE = 'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50';
const BUTTON_SIZE: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-xs',
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-3.5 text-sm',
  lg: 'h-11 px-5 text-[15px]',
};
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-brand-contrast shadow-sm hover:bg-brand-hover',
  secondary: 'border border-line-strong bg-surface text-fg shadow-xs hover:bg-hover',
  ghost: 'text-fg-muted hover:bg-hover hover:text-fg',
  danger: 'bg-danger text-white shadow-sm hover:opacity-90',
  'danger-ghost': 'text-danger-fg hover:bg-danger-soft',
};
const ICON_SIZE: Record<ButtonSize, number> = { xs: 13, sm: 14, md: 16, lg: 18 };

/** Classes for anything that should look like a button (e.g. download links). */
export const buttonClass = (variant: ButtonVariant = 'secondary', size: ButtonSize = 'md') => cn(BUTTON_BASE, BUTTON_SIZE[size], BUTTON_VARIANT[variant]);

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, iconRight: IconRight, loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={cn(buttonClass(variant, size), className)} {...rest}>
      {loading ? <LoaderCircle size={ICON_SIZE[size]} className="animate-spin" aria-hidden /> : Icon && <Icon size={ICON_SIZE[size]} aria-hidden />}
      {children}
      {IconRight && <IconRight size={ICON_SIZE[size]} aria-hidden />}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  size?: 'sm' | 'md';
  active?: boolean;
}

/** Square icon-only button; `label` becomes the accessible name and native tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 'md', active, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} aria-label={label} title={label}
      className={cn('inline-grid shrink-0 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-7 w-7' : 'h-9 w-9', active && 'bg-hover text-fg', className)}
      {...rest}>
      <Icon size={size === 'sm' ? 15 : 17} aria-hidden />
    </button>
  );
});

// ── Badge ────────────────────────────────────────────────────────────────────

export type Tone = 'neutral' | 'brand' | 'success' | 'danger' | 'warning' | 'info' | 'violet';

const SOFT: Record<Tone, string> = {
  neutral: 'bg-sunken text-fg-muted ring-1 ring-inset ring-line',
  brand: 'bg-brand-soft text-brand-soft-fg',
  success: 'bg-success-soft text-success-fg',
  danger: 'bg-danger-soft text-danger-fg',
  warning: 'bg-warning-soft text-warning-fg',
  info: 'bg-info-soft text-info-fg',
  violet: 'bg-violet-soft text-violet-fg',
};
const SOLID: Record<Tone, string> = {
  neutral: 'bg-fg text-surface',
  brand: 'bg-brand text-brand-contrast',
  success: 'bg-success text-white',
  danger: 'bg-danger text-white',
  warning: 'bg-warning text-white',
  info: 'bg-info text-white',
  violet: 'bg-violet text-white',
};
export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-fg-muted', brand: 'text-brand', success: 'text-success', danger: 'text-danger', warning: 'text-warning', info: 'text-info', violet: 'text-violet',
};
export const TONE_BG: Record<Tone, string> = {
  neutral: 'bg-fg-subtle', brand: 'bg-brand', success: 'bg-success', danger: 'bg-danger', warning: 'bg-warning', info: 'bg-info', violet: 'bg-violet',
};

interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  tone?: Tone; solid?: boolean; icon?: LucideIcon; dot?: boolean; mono?: boolean; size?: 'xs' | 'sm' | 'md'; children: ReactNode;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge({ tone = 'neutral', solid, icon: Icon, dot, mono, size = 'sm', className, children, ...rest }, ref) {
  return (
    <span ref={ref} {...rest} className={cn('inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-md font-medium',
      size === 'xs' ? 'h-[18px] px-1.5 text-[10.5px]' : size === 'sm' ? 'h-5 px-1.5 text-[11.5px]' : 'h-6 px-2 text-xs',
      solid ? SOLID[tone] : SOFT[tone], mono && 'font-mono', className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', solid ? 'bg-current' : TONE_BG[tone])} aria-hidden />}
      {Icon && <Icon size={size === 'md' ? 13 : 12} strokeWidth={2.25} aria-hidden className="shrink-0" />}
      <span className="truncate">{children}</span>
    </span>
  );
});

// ── Card ─────────────────────────────────────────────────────────────────────

export function Card({ className, children, as: As = 'section', ...rest }: { className?: string; children: ReactNode; as?: 'section' | 'div' | 'article' } & Record<string, unknown>) {
  return <As className={cn('card', className)} {...rest}>{children}</As>;
}

export function CardHeader({ title, description, icon: Icon, actions, className, border = true }: {
  title: ReactNode; description?: ReactNode; icon?: LucideIcon; actions?: ReactNode; className?: string; border?: boolean;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3', border && 'border-b border-line', className)}>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {Icon && <Icon size={16} className="shrink-0 text-fg-subtle" aria-hidden />}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-fg-subtle">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

// ── Form controls ────────────────────────────────────────────────────────────

export interface SegmentOption<T extends string> { value: T; label: ReactNode; icon?: LucideIcon; disabled?: boolean; title?: string; count?: number }

export function SegmentedControl<T extends string>({ value, onChange, options, size = 'sm', className, label, fullWidth }: {
  value: T; onChange: (v: T) => void; options: SegmentOption<T>[]; size?: 'xs' | 'sm' | 'md'; className?: string; label: string; fullWidth?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-lg bg-sunken p-0.5 ring-1 ring-inset ring-line', fullWidth && 'flex w-full', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active} disabled={o.disabled} title={o.title} onClick={() => onChange(o.value)}
            className={cn('inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40',
              size === 'xs' ? 'h-6 px-2 text-xs' : size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-8 px-3 text-sm',
              fullWidth && 'flex-1',
              active ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-fg-muted hover:text-fg')}>
            {o.icon && <o.icon size={14} aria-hidden />}
            {o.label}
            {o.count != null && <span className={cn('tabular-nums text-[11px]', active ? 'text-fg-subtle' : 'text-fg-subtle/80')}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Select<T extends string>({ value, onChange, options, label, hideLabel, className, size = 'md' }: {
  value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; label: string; hideLabel?: boolean; className?: string; size?: 'sm' | 'md';
}) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className={hideLabel ? 'sr-only' : 'mb-1 block text-xs font-medium text-fg-muted'}>{label}</span>
      <span className="relative block">
        <select value={value} onChange={(e) => onChange(e.target.value as T)}
          className={cn('w-full cursor-pointer appearance-none truncate rounded-lg border border-line-strong bg-surface pl-3 pr-8 text-fg shadow-xs transition-colors hover:border-fg-subtle/60',
            size === 'sm' ? 'h-8 text-[13px]' : 'h-9 text-sm')}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={15} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" aria-hidden />
      </span>
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className, label = 'Search', size = 'md' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string; label?: string; size?: 'sm' | 'md';
}) {
  return (
    <div className={cn('relative', className)}>
      <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" aria-hidden />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label}
        className={cn('w-full rounded-lg border border-line-strong bg-surface pl-8 pr-8 text-fg', size === 'sm' ? 'h-8 text-[13px]' : 'h-9 text-sm', ' shadow-xs placeholder:text-fg-subtle hover:border-fg-subtle/60 [&::-webkit-search-cancel-button]:hidden')} />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search"
          className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-fg-subtle hover:bg-hover hover:text-fg">
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean;
}) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3', disabled && 'cursor-not-allowed opacity-50')}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors', checked ? 'bg-brand' : 'bg-line-strong')}>
        <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </button>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{label}</span>
        {description && <span className="block text-xs text-fg-subtle">{description}</span>}
      </span>
    </label>
  );
}

// ── Feedback ─────────────────────────────────────────────────────────────────

export const Spinner = ({ size = 16, className }: { size?: number; className?: string }) => (
  <LoaderCircle size={size} className={cn('animate-spin', className)} aria-hidden />
);

export const Skeleton = ({ className }: { className?: string }) => <div className={cn('animate-pulse rounded-md bg-sunken', className)} aria-hidden />;

export function EmptyState({ icon: Icon, title, description, action, className }: {
  icon: LucideIcon; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-sunken text-fg-subtle ring-1 ring-inset ring-line">
        <Icon size={20} aria-hidden />
      </div>
      <div className="text-[15px] font-semibold text-fg">{title}</div>
      {description && <div className="mt-1.5 max-w-md text-sm text-fg-subtle">{description}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', icon: Icon, title, children, action, className }: {
  tone?: Exclude<Tone, 'neutral' | 'brand' | 'violet'> | 'neutral'; icon?: LucideIcon; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string;
}) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex items-start gap-3 rounded-lg px-3.5 py-3 text-sm',
      tone === 'neutral' ? 'bg-sunken text-fg-muted ring-1 ring-inset ring-line' : SOFT[tone], className)}>
      {Icon && <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title ? 'mt-0.5' : undefined, 'break-words opacity-90')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone, icon: Icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; icon?: LucideIcon }) {
  return (
    <div className="card px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-fg-subtle">
        {Icon && <Icon size={14} aria-hidden />}{label}
      </div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums tracking-tight', tone ? TONE_TEXT[tone] : 'text-fg')}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-fg-subtle">{hint}</div>}
    </div>
  );
}

export const Kbd = ({ children, className }: { children: ReactNode; className?: string }) => (
  <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded border border-current/25 px-1 font-sans text-[11px] font-medium opacity-80', className)}>{children}</kbd>
);

/** Copies `text`; swaps to a check mark briefly. */
export function CopyButton({ text, label = 'Copy', size = 'sm', showLabel, className }: { text: string; label?: string; size?: 'sm' | 'md'; showLabel?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch { return; }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  };
  if (showLabel) {
    return <Button size={size === 'sm' ? 'xs' : 'sm'} variant="secondary" icon={copied ? Check : Copy} onClick={copy} className={className}>{copied ? 'Copied' : label}</Button>;
  }
  return <IconButton icon={copied ? Check : Copy} label={copied ? 'Copied' : label} size={size} onClick={copy} className={cn(copied && 'text-success hover:text-success', className)} />;
}

export function SectionLabel({ children, className, action }: { children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={cn('mb-2 flex items-center gap-2', className)}>
      <div className="eyebrow">{children}</div>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

/** Top-of-view title row: h1, one-line description, actions on the right. */
export function PageHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-end gap-x-6 gap-y-3', className)}>
      <div className="min-w-[min(100%,20rem)] flex-1">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-pretty text-sm text-fg-subtle">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
