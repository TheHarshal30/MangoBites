import { useMemo, useState, type ReactNode } from 'react';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { CopyButton, IconButton, cn } from './ui';

const LONG = /"([A-Za-z0-9_\-.~+/=]{160,})"/g;
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g;
const MAX_HIGHLIGHT = 150_000;

/** Turns pretty-printed JSON into coloured spans (keys, strings, numbers, literals, punctuation). */
function highlight(text: string): ReactNode[] {
  if (text.length > MAX_HIGHLIGHT) return [text];
  const out: ReactNode[] = [];
  let last = 0, i = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index!;
    if (at > last) out.push(text.slice(last, at));
    const [whole, str, colon, lit, num, pun] = m;
    if (str !== undefined) {
      out.push(<span key={i++} className={colon ? 'tok-key' : 'tok-str'}>{str}</span>);
      if (colon) out.push(<span key={i++} className="tok-pun">{colon}</span>);
    } else if (lit) out.push(<span key={i++} className="tok-lit">{lit}</span>);
    else if (num) out.push(<span key={i++} className="tok-num">{num}</span>);
    else if (pun) out.push(<span key={i++} className="tok-pun">{pun}</span>);
    else out.push(whole);
    last = at + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Pretty JSON with syntax colours and copy. Long base64/JWT strings are folded so payloads stay
 * readable; "Expand" shows them in full. Plain strings render as wrapped monospace text.
 */
export function JsonView({ value, compact, className, maxHeight }: { value: unknown; compact?: boolean; className?: string; maxHeight?: string }) {
  const [expand, setExpand] = useState(false);
  const isString = typeof value === 'string';
  const text = useMemo(() => (isString ? (value as string) : JSON.stringify(value, null, 2) ?? 'undefined'), [value, isString]);
  const folded = useMemo(() => (isString ? text : text.replace(LONG, (_m, s: string) => `"${s.slice(0, 64)}…${s.slice(-12)}" ⟨${s.length.toLocaleString()} chars⟩`)), [text, isString]);
  const canFold = folded !== text;
  const shown = expand || !canFold ? text : folded;
  const body = useMemo(() => (isString ? shown : highlight(shown)), [shown, isString]);

  return (
    <div className={cn('group relative rounded-lg border border-line bg-[var(--code-bg)]', className)}>
      <pre className={cn('overflow-auto whitespace-pre-wrap break-all p-3 pr-16 font-mono text-[12px] leading-[1.6] text-[var(--code-fg)]',
        maxHeight ?? (compact ? 'max-h-36' : 'max-h-[420px]'))}>
        {body}
      </pre>
      <div className="absolute right-1.5 top-1.5 flex gap-0.5 rounded-lg bg-[var(--code-bg)]/90 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {canFold && <IconButton size="sm" icon={expand ? ChevronsDownUp : ChevronsUpDown} label={expand ? 'Fold long values' : 'Expand long values'} onClick={() => setExpand((e) => !e)} />}
        <CopyButton text={text} label={isString ? 'Copy' : 'Copy JSON'} />
      </div>
    </div>
  );
}
