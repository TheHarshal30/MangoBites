import { useEffect, useMemo, useRef, useState } from 'react';
import { Code, Download, Hash } from 'lucide-react';
import type { Catalog, ProtocolEvent, Run } from '../api';
import { useCatalog } from '../lib/app';
import { useTheme } from '../lib/theme';
import { Alert, Button, CopyButton, Skeleton } from './ui';

const ACTOR: Record<string, string> = { issuer: 'I', wallet: 'W', verifier: 'V', playground: 'P' };

/** Sequence number shown both on the diagram arrows and in the inspector rows. */
export function exchangeNumbers(events: ProtocolEvent[]) {
  const map = new Map<string, number>();
  let n = 0;
  for (const e of events) if (e.kind === 'http') map.set(e.id, ++n);
  return map;
}

const clean = (s: string) => s.replace(/[;#:{}<>"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);

const PHASE_TINT: Record<string, { light: string; dark: string }> = {
  'OpenID4VCI — issuance': { light: 'rgba(124, 58, 237, 0.05)', dark: 'rgba(167, 139, 250, 0.07)' },
  'OpenID4VP — presentation': { light: 'rgba(13, 148, 136, 0.06)', dark: 'rgba(45, 212, 191, 0.07)' },
  'Direct VC verification': { light: 'rgba(13, 148, 136, 0.06)', dark: 'rgba(45, 212, 191, 0.07)' },
};

/**
 * Mermaid source plus, in render order, the event behind every message arrow — so clicks on the
 * rendered SVG can be mapped back to inspector events.
 */
export function buildSequence(run: Run, catalog: Catalog, dark = false) {
  const name = (id: string) => catalog.parties.find((p) => p.id === id)?.name ?? id;
  const nums = exchangeNumbers(run.events);
  const messages: Array<{ eventId: string; label: string }> = [];
  const lines = [
    'sequenceDiagram',
    `  participant P as Playground`,
    `  participant I as ${clean(name(run.issuer))}`,
    `  participant W as ${clean(name(run.wallet))}`,
    `  participant V as ${clean(name(run.verifier))}`,
  ];
  let phase = '';
  let open = false;
  for (const e of run.events) {
    const from = ACTOR[e.from] ?? 'P';
    const to = ACTOR[e.to] ?? 'P';
    const p = e.step.startsWith('OpenID4VCI') ? 'OpenID4VCI — issuance' : e.step.startsWith('OpenID4VP') ? 'OpenID4VP — presentation' : e.step.startsWith('Direct') ? 'Direct VC verification' : '';
    if (p && p !== phase) {
      if (open) lines.push('  end');
      phase = p;
      lines.push(`  rect ${PHASE_TINT[p][dark ? 'dark' : 'light']}`);
      open = true;
      lines.push(`  Note over P,V: ${p}`);
    }
    if (e.kind === 'http' && e.request) {
      let path = e.request.url;
      try { path = new URL(e.request.url).pathname; } catch { /* keep raw */ }
      const short = path.replace(/^\/v1\/(certify|verify)/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}|(txn|req)_[0-9a-f-]{20,}/gi, '…');
      const label = clean(`[${nums.get(e.id)}] ${e.request.method} ${short}`);
      lines.push(`  ${from}->>${to}: ${label}`);
      messages.push({ eventId: e.id, label });
      const st = e.response?.status ?? 0;
      const back = `${st}${st >= 400 ? ' ✗' : ''}`;
      lines.push(`  ${to}-->>${from}: ${back}`);
      messages.push({ eventId: e.id, label: back });
    } else if (e.kind === 'await') {
      lines.push(`  Note over ${from},${to}: ⏳ ${clean(e.summary)}`);
    } else if (e.kind === 'error') {
      lines.push(`  Note over ${from}: ✗ ${clean(e.summary)}`);
    } else if (e.kind === 'action' && from === to) {
      lines.push(`  Note over ${from}: ${clean(e.summary)}`);
    } else if (e.kind === 'action') {
      const label = clean(e.summary);
      lines.push(`  ${from}-)${to}: ${label}`);
      messages.push({ eventId: e.id, label });
    }
  }
  if (open) lines.push('  end');
  if (run.state !== 'running' && run.actual) lines.push(`  Note over V: verdict ${run.actual} · ${run.result}`);
  return { source: lines.join('\n'), messages };
}

const THEME = {
  light: {
    background: 'transparent', fontFamily: 'Inter Variable, ui-sans-serif, system-ui, sans-serif',
    actorBkg: '#ffffff', actorBorder: '#d0d5dc', actorTextColor: '#111827', actorLineColor: '#d0d5dc',
    signalColor: '#6b7280', signalTextColor: '#374151',
    noteBkgColor: '#f3f4f6', noteBorderColor: '#e4e7eb', noteTextColor: '#4b5563',
    labelBoxBkgColor: '#ffffff', labelBoxBorderColor: '#d0d5dc', labelTextColor: '#111827', loopTextColor: '#4b5563',
    activationBkgColor: '#f3f4f6', activationBorderColor: '#d0d5dc', sequenceNumberColor: '#ffffff',
    primaryColor: '#ffffff', primaryBorderColor: '#d0d5dc', primaryTextColor: '#111827', lineColor: '#9ca3af',
  },
  dark: {
    background: 'transparent', fontFamily: 'Inter Variable, ui-sans-serif, system-ui, sans-serif',
    actorBkg: '#16191d', actorBorder: '#343a43', actorTextColor: '#e8eaed', actorLineColor: '#343a43',
    signalColor: '#80878f', signalTextColor: '#c4c9d0',
    noteBkgColor: '#1d2127', noteBorderColor: '#2b3038', noteTextColor: '#a7adb7',
    labelBoxBkgColor: '#16191d', labelBoxBorderColor: '#343a43', labelTextColor: '#e8eaed', loopTextColor: '#a7adb7',
    activationBkgColor: '#1d2127', activationBorderColor: '#343a43', sequenceNumberColor: '#111316',
    primaryColor: '#16191d', primaryBorderColor: '#343a43', primaryTextColor: '#e8eaed', lineColor: '#80878f',
  },
};

let counter = 0;

/** Mermaid is large, so it is loaded on first use rather than with the app. */
async function renderMermaid(source: string, theme: 'light' | 'dark') {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({
    startOnLoad: false, theme: 'base', securityLevel: 'strict', themeVariables: THEME[theme],
    sequence: { mirrorActors: false, messageFontSize: 12, noteFontSize: 11, actorFontSize: 13, wrap: true, boxMargin: 8, noteMargin: 8 } as never,
  });
  return (await mermaid.render(`seq-${++counter}`, source)).svg;
}

const squash = (s: string) => s.replace(/[\s­-]+/g, '');

export function SequenceDiagram({ run, selectedId, onSelect }: { run: Run; selectedId?: string; onSelect?: (id: string) => void }) {
  const catalog = useCatalog();
  const { resolved } = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string>();
  const [rendered, setRendered] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const { source, messages } = useMemo(() => buildSequence(run, catalog, resolved === 'dark'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run.events.length, run.state, run.actual, resolved]);

  useEffect(() => {
    let cancelled = false;
    renderMermaid(source, resolved)
      .then((svg) => {
        const el = host.current;
        if (cancelled || !el) return;
        el.innerHTML = svg;
        setErr(undefined);
        setRendered(true);
        wireClicks(el, messages, (id) => onSelectRef.current?.(id));
      })
      .catch((e) => !cancelled && setErr(String(e?.message ?? e)));
    return () => { cancelled = true; };
  }, [source, resolved]);

  // Highlight the selected exchange without re-rendering the diagram.
  useEffect(() => {
    host.current?.querySelectorAll<SVGElement>('[data-event]').forEach((el) => el.classList.toggle('is-selected', el.dataset.event === selectedId));
  }, [selectedId, rendered, source]);

  const downloadSvg = () => {
    const svg = host.current?.innerHTML;
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    Object.assign(document.createElement('a'), { href: url, download: `sequence-${run.id.slice(0, 8)}.svg` }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {!rendered && !err && <Skeleton className="h-72 w-full" />}
      <div ref={host} className="mermaid-host overflow-x-auto" />
      {err && <Alert tone="danger" title="Couldn’t draw the diagram"><span className="font-mono text-xs">{err}</span></Alert>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
        <Button size="xs" variant="ghost" icon={Code} onClick={() => setShowSource((s) => !s)} aria-expanded={showSource}>{showSource ? 'Hide' : 'Show'} Mermaid source</Button>
        <Button size="xs" variant="ghost" icon={Download} onClick={downloadSvg} disabled={!rendered}>Download SVG</Button>
        <span className="ml-auto hidden items-center gap-1.5 text-[11px] text-fg-subtle sm:flex"><Hash size={12} aria-hidden />Numbers match the inspector</span>
      </div>
      {showSource && (
        <div className="relative mt-2">
          <pre className="max-h-64 overflow-auto rounded-lg bg-[var(--code-bg)] p-3 font-mono text-[11.5px] leading-relaxed text-[var(--code-fg)] ring-1 ring-inset ring-line">{source}</pre>
          <div className="absolute right-1.5 top-1.5"><CopyButton text={source} label="Copy Mermaid source" /></div>
        </div>
      )}
    </div>
  );
}

/**
 * Mermaid draws message labels (possibly wrapped over several <text> nodes) and lines in message
 * order. Walk them in step with our message list to tag each with its event id.
 */
function wireClicks(el: HTMLElement, messages: Array<{ eventId: string; label: string }>, select: (id: string) => void) {
  const texts = [...el.querySelectorAll<SVGTextElement>('text.messageText')];
  let i = 0, acc = '';
  for (const t of texts) {
    const m = messages[i];
    if (!m) break;
    tag(t, m.eventId, select);
    acc += squash(t.textContent ?? '');
    if (acc.length >= squash(m.label).length) { i++; acc = ''; }
  }
  const lines = [...el.querySelectorAll<SVGElement>('.messageLine0, .messageLine1')];
  lines.forEach((l, n) => { if (messages[n]) tag(l, messages[n].eventId, select); });
}

function tag(node: SVGElement, eventId: string, select: (id: string) => void) {
  node.dataset.event = eventId;
  node.classList.add('is-clickable');
  node.addEventListener('click', () => select(eventId));
}
