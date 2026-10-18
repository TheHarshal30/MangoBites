import { useEffect, useState } from 'react';
import { api } from '../api';
import { JsonView } from './JsonView';

/** Credentials held by the Reference Wallet (most recent first). */
export function WalletView() {
  const [creds, setCreds] = useState<any[] | null>(null);
  const [open, setOpen] = useState<string>();
  useEffect(() => { api.wallet().then(setCreds).catch(() => setCreds([])); }, []);
  if (!creds) return <div className="p-8 text-center text-slate-500">Loading wallet…</div>;
  if (!creds.length) return <div className="card p-8 text-center text-sm text-slate-500">The Reference Wallet is empty. Run a flow to receive a credential.</div>;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {creds.map((c) => {
        const s = c.summary ?? {};
        const claims = s.subject ?? s.claims ?? {};
        return (
          <article key={c.id} className="card overflow-hidden">
            <div className={`p-4 text-white ${c.format === 'ldp_vc' ? 'bg-gradient-to-br from-indigo-700 to-indigo-900' : c.format === 'vc+sd-jwt' ? 'bg-gradient-to-br from-rose-700 to-rose-900' : 'bg-gradient-to-br from-emerald-700 to-emerald-900'}`}>
              <div className="text-[11px] uppercase tracking-wider opacity-80">{c.format}</div>
              <div className="text-lg font-semibold">{[].concat(s.type ?? s.vct ?? s.docType ?? c.configId).filter((t: string) => t !== 'VerifiableCredential').join(', ')}</div>
              <div className="truncate text-xs opacity-80" title={c.issuer}>from {c.issuer}</div>
            </div>
            <div className="space-y-1 p-4 text-sm">
              {Object.entries(claims).filter(([k]) => k !== 'id').slice(0, 6).map(([k, v]) => (
                <div key={k} className="flex gap-2"><span className="w-32 shrink-0 text-slate-500">{k}</span><span className="truncate">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span></div>
              ))}
              <div className="flex gap-2 pt-1 text-xs text-slate-500"><span>received {new Date(c.receivedAt).toLocaleString()}</span>{s.expires && <span>· expires {new Date(s.expires).toLocaleDateString()}</span>}</div>
              <button className="text-xs text-brand-700 underline" onClick={() => setOpen(open === c.id ? undefined : c.id)}>{open === c.id ? 'Hide raw credential' : 'Show raw credential'}</button>
              {open === c.id && <JsonView value={c.credential} />}
            </div>
          </article>
        );
      })}
    </div>
  );
}
