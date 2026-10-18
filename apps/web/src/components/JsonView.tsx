import { useState } from 'react';

/** Pretty JSON with copy; long base64/JWT strings are folded so payloads stay readable. */
export function JsonView({ value, compact }: { value: unknown; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [expand, setExpand] = useState(false);
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'null';
  const shown = expand ? text : text.replace(/"([A-Za-z0-9_\-.~+/=]{180,})"/g, (_m, s: string) => `"${s.slice(0, 90)}…⟨${s.length} chars⟩"`);
  const folded = shown !== text;
  return (
    <div className="group relative">
      <pre className={`code ${compact ? 'max-h-32' : 'max-h-[420px]'} whitespace-pre-wrap break-all`}>{shown}</pre>
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
        {folded || expand ? (
          <button className="rounded bg-slate-700 px-2 py-0.5 text-[11px] text-white" onClick={() => setExpand((e) => !e)}>{expand ? 'fold' : 'unfold'}</button>
        ) : null}
        <button className="rounded bg-slate-700 px-2 py-0.5 text-[11px] text-white"
          onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
    </div>
  );
}
