import {
  Component, cloneElement, createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState,
  type ErrorInfo, type ReactElement, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, Info, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { Button, IconButton, cn } from './ui';

// ── Tooltip ──────────────────────────────────────────────────────────────────

/**
 * Portal tooltip, so it is never clipped by scroll containers (tables, the inspector).
 * Shows on hover and keyboard focus; the child must accept mouse/focus handlers.
 */
export function Tooltip({ content, children, side = 'top', delay = 120 }: { content: ReactNode; children: ReactElement; side?: 'top' | 'bottom'; delay?: number }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const id = useId();
  const show = (el: Element) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setRect(el.getBoundingClientRect()), delay);
  };
  const hide = () => { clearTimeout(timer.current); setRect(null); };
  useEffect(() => {
    if (!rect) return;
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [rect]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const p = children.props as Record<string, any>;
  const child = cloneElement(children, {
    onMouseEnter: (e: any) => { p.onMouseEnter?.(e); show(e.currentTarget); },
    onMouseLeave: (e: any) => { p.onMouseLeave?.(e); hide(); },
    onFocus: (e: any) => { p.onFocus?.(e); show(e.currentTarget); },
    onBlur: (e: any) => { p.onBlur?.(e); hide(); },
    'aria-describedby': rect ? id : p['aria-describedby'],
  } as any);

  return (
    <>
      {child}
      {rect && content != null && content !== '' && createPortal(<TooltipBubble id={id} rect={rect} side={side}>{content}</TooltipBubble>, document.body)}
    </>
  );
}

function TooltipBubble({ id, rect, side, children }: { id: string; rect: DOMRect; side: 'top' | 'bottom'; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, m = 8;
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(m, Math.min(left, window.innerWidth - w - m));
    let top = side === 'top' ? rect.top - h - 6 : rect.bottom + 6;
    if (top < m) top = rect.bottom + 6;
    if (top + h > window.innerHeight - m) top = rect.top - h - 6;
    setPos({ left, top });
  }, [rect, side]);
  return (
    <div ref={ref} id={id} role="tooltip" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      className="pointer-events-none fixed z-[70] max-w-xs animate-fade-in rounded-lg bg-fg px-2.5 py-1.5 text-xs leading-snug text-surface shadow-pop">
      {children}
    </div>
  );
}

// ── Popover ──────────────────────────────────────────────────────────────────

/** Anchored dropdown panel: closes on outside click and Escape. */
export function Popover({ trigger, children, align = 'end', width = 'w-80' }: {
  trigger: (props: { open: boolean; toggle: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'dialog' }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'start' | 'end';
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'dialog' })}
      {open && (
        <div role="dialog" className={cn('absolute top-full z-50 mt-2 max-w-[calc(100vw-1.5rem)] animate-pop-in rounded-xl border border-line bg-surface shadow-pop', width, align === 'end' ? 'right-0' : 'left-0')}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}

// ── Dialog / Sheet ───────────────────────────────────────────────────────────

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Modal dialog (`variant="center"`) or right-hand drawer (`variant="sheet"`), with focus trap and Escape. */
export function Dialog({ open, onClose, title, description, children, footer, variant = 'center', size = 'md' }: {
  open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode;
  variant?: 'center' | 'sheet'; size?: 'sm' | 'md' | 'lg';
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); }
      if (e.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!items.length) return;
        const [a, b] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
        else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const sheet = variant === 'sheet';
  return createPortal(
    <div className={cn('fixed inset-0 z-[60] flex', sheet ? 'justify-end' : 'items-center justify-center p-4')}>
      <div className="absolute inset-0 animate-fade-in bg-black/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={cn('relative flex flex-col bg-surface shadow-pop outline-none',
          sheet ? 'h-full w-full max-w-xl animate-slide-in-right border-l border-line'
            : cn('max-h-[85vh] w-full animate-pop-in rounded-2xl border border-line', size === 'sm' ? 'max-w-md' : size === 'md' ? 'max-w-lg' : 'max-w-3xl'))}>
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-fg">{title}</h2>
            {description && <div className="mt-1 text-sm text-fg-subtle">{description}</div>}
          </div>
          <IconButton icon={X} label="Close" size="sm" onClick={onClose} className="-mr-1.5 -mt-0.5" />
        </div>
        {children && <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>}
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-sunken/50 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirm', danger, busy }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: ReactNode; description?: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} size="sm"
      footer={<>
        <Button variant="secondary" onClick={onClose} data-autofocus>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
      </>}>
      {description && <div className="text-sm text-fg-muted">{description}</div>}
    </Dialog>
  );
}

// ── Toasts ───────────────────────────────────────────────────────────────────

type ToastTone = 'success' | 'danger' | 'info' | 'warning';
interface ToastItem { id: number; title: ReactNode; description?: ReactNode; tone: ToastTone }
type ToastFn = (t: { title: ReactNode; description?: ReactNode; tone?: ToastTone }) => void;

const ToastContext = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastContext);

const TOAST_ICON = { success: CircleCheck, danger: CircleAlert, info: Info, warning: TriangleAlert };
const TOAST_COLOR = { success: 'text-success', danger: 'text-danger', info: 'text-info', warning: 'text-warning' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback<ToastFn>(({ title, description, tone = 'success' }) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-3), { id, title, description, tone }]);
    setTimeout(() => dismiss(id), tone === 'danger' ? 7000 : 3500);
  }, [dismiss]);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      {createPortal(
        <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
          {items.map((t) => {
            const Icon = TOAST_ICON[t.tone];
            return (
              <div key={t.id} role={t.tone === 'danger' ? 'alert' : 'status'} className="pointer-events-auto flex animate-pop-in items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-pop">
                <Icon size={18} className={cn('mt-px shrink-0', TOAST_COLOR[t.tone])} aria-hidden />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium text-fg">{t.title}</div>
                  {t.description && <div className="mt-0.5 break-words text-fg-subtle">{t.description}</div>}
                </div>
                <IconButton icon={X} label="Dismiss" size="sm" onClick={() => dismiss(t.id)} className="-mr-2 -mt-1" />
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

// ── Error boundary ───────────────────────────────────────────────────────────

/** Keeps one broken view from blanking the whole app. `resetKey` changes (e.g. the route) clear the error. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('View crashed', error, info.componentStack); }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: undefined });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card flex flex-col items-center px-6 py-14 text-center">
        <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-danger-soft text-danger"><CircleAlert size={20} aria-hidden /></div>
        <div className="text-[15px] font-semibold">This view hit an unexpected error</div>
        <div className="mt-1.5 max-w-lg break-words font-mono text-xs text-fg-subtle">{this.state.error.message}</div>
        <Button className="mt-5" icon={RotateCcw} onClick={() => this.setState({ error: undefined })}>Try again</Button>
      </div>
    );
  }
}
