import { useEffect, useMemo, useRef, useState } from 'react';
import mermaid from 'mermaid';
import type { Catalog, ProtocolEvent, Run } from '../api';

const ACTOR: Record<string, string> = { issuer: 'I', wallet: 'W', verifier: 'V', playground: 'P' };

/** Sequence number shown both on the diagram arrows and in the inspector rows. */
export function exchangeNumbers(events: ProtocolEvent[]) {
  const map = new Map<string, number>();
  let n = 0;
  for (const e of events) if (e.kind === 'http') map.set(e.id, ++n);
  return map;
}

const clean = (s: string) => s.replace(/[;#:{}<>"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);

export function buildSequence(run: Run, catalog: Catalog) {
  const name = (id: string) => catalog.parties.find((p) => p.id === id)?.name ?? id;
  const nums = exchangeNumbers(run.events);
  const lines = [
    'sequenceDiagram',
    `  participant P as Playground`,
    `  participant I as ${clean(name(run.issuer))}`,
    `  participant W as ${clean(name(run.wallet))}`,
    `  participant V as ${clean(name(run.verifier))}`,
  ];
  let phase = '';
  for (const e of run.events) {
    const from = ACTOR[e.from] ?? 'P';
    const to = ACTOR[e.to] ?? 'P';
    const p = e.step.startsWith('OpenID4VCI') ? 'OpenID4VCI — issuance' : e.step.startsWith('OpenID4VP') ? 'OpenID4VP — presentation' : e.step.startsWith('Direct') ? 'Direct VC verification' : '';
    if (p && p !== phase) {
      phase = p;
      lines.push(`  Note over P,V: ${p}`);
    }
    if (e.kind === 'http' && e.request) {
      let path = e.request.url;
      try { path = new URL(e.request.url).pathname; } catch { /* keep raw */ }
      const short = path.replace(/^\/v1\/(certify|verify)/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}|(txn|req)_[0-9a-f-]{20,}/gi, '…');
      const label = `[${nums.get(e.id)}] ${e.request.method} ${short}`;
      lines.push(`  ${from}->>${to}: ${clean(label)}`);
      const st = e.response?.status ?? 0;
      lines.push(`  ${to}-->>${from}: ${st}${st >= 400 ? ' ✗' : ''}`);
    } else if (e.kind === 'await') {
      lines.push(`  Note over ${from},${to}: ⏳ ${clean(e.summary)}`);
    } else if (e.kind === 'error') {
      lines.push(`  Note over ${from}: ✗ ${clean(e.summary)}`);
    } else if (e.kind === 'action' && from === to) {
      lines.push(`  Note over ${from}: ${clean(e.summary)}`);
    } else if (e.kind === 'action') {
      lines.push(`  ${from}-)${to}: ${clean(e.summary)}`);
    }
  }
  if (run.state !== 'running' && run.actual) {
    lines.push(`  Note over V: verdict ${run.actual} · ${run.result}`);
  }
  return lines.join('\n');
}

let counter = 0;

export function SequenceDiagram({ run, catalog }: { run: Run; catalog: Catalog; selectedId?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string>();
  const [showSource, setShowSource] = useState(false);
  const source = useMemo(() => buildSequence(run, catalog), [run.events.length, run.state, run.actual]);

  useEffect(() => {
    let cancelled = false;
    const dark = document.documentElement.classList.contains('dark');
    mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', sequence: { mirrorActors: false, messageFontSize: 12, noteFontSize: 11, actorFontSize: 13, wrap: true } as any, securityLevel: 'strict' });
    mermaid.render(`seq-${++counter}`, source)
      .then(({ svg }) => { if (!cancelled && host.current) { host.current.innerHTML = svg; setErr(undefined); } })
      .catch((e) => !cancelled && setErr(String(e?.message ?? e)));
    return () => { cancelled = true; };
  }, [source]);

  return (
    <div>
      <div ref={host} className="mermaid-host min-h-24 overflow-x-auto" />
      {err && <div className="text-xs text-red-600">Diagram error: {err}</div>}
      <button className="mt-2 text-xs text-slate-500 underline" onClick={() => setShowSource((s) => !s)}>{showSource ? 'Hide' : 'Show'} Mermaid source</button>
      {showSource && <pre className="code mt-2 max-h-64">{source}</pre>}
    </div>
  );
}
