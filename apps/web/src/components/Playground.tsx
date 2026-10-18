import { useEffect, useMemo, useState } from 'react';
import { api, type Catalog, type Format, type Party, type RunSummary, type Tamper } from '../api';
import { RunView } from './RunView';

interface Props {
  catalog: Catalog;
  runs: RunSummary[];
  openRunId?: string;
  onOpenRun: (id: string | undefined) => void;
}

const ROLE_TITLES = { issuer: '① Issuer', wallet: '② Wallet (holder)', verifier: '③ Verifier' } as const;

export function Playground({ catalog, runs, openRunId, onOpenRun }: Props) {
  const byRole = (role: Party['role']) => catalog.parties.filter((p) => p.role === role);
  const [sel, setSel] = useState({ issuer: 'inji-certify', wallet: 'playground-wallet', verifier: 'inji-verify' });
  const [format, setFormat] = useState<Format>('ldp_vc');
  const [tamper, setTamper] = useState<Tamper>('none');
  const [expired, setExpired] = useState(false);
  const [txCode, setTxCode] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();

  const parties = {
    issuer: catalog.parties.find((p) => p.id === sel.issuer)!,
    wallet: catalog.parties.find((p) => p.id === sel.wallet)!,
    verifier: catalog.parties.find((p) => p.id === sel.verifier)!,
  };
  const formatOk = (f: Format) => Object.values(parties).every((p) => p.formats.includes(f));
  const manual = parties.wallet.mode === 'manual';

  // Keep the selection valid as parties change.
  useEffect(() => {
    if (!formatOk(format)) {
      const f = (Object.keys(catalog.formats) as Format[]).find(formatOk);
      if (f) setFormat(f);
    }
  }, [sel]);
  useEffect(() => {
    if (tamper !== 'none' && (manual || !catalog.tamperModes[tamper].formats.includes(format))) setTamper('none');
    if (expired && !parties.issuer.expiredIssuance?.includes(format)) setExpired(false);
  }, [sel, format]);

  const problem = useMemo(() => {
    if (!formatOk(format)) return `No common format — ${Object.values(parties).filter((p) => !p.formats.includes(format)).map((p) => p.name).join(', ')} can't do ${catalog.formats[format].short}`;
    const down = Object.values(parties).find((p) => p.health && !p.health.up);
    if (down) return `${down.name} is not reachable: ${down.health!.detail}`;
    if (sel.verifier === 'inji-verify-direct' && ['replay', 'wrong-holder'].includes(tamper)) return 'Replay / wrong-holder need a presentation; VC upload has no holder proof';
    return undefined;
  }, [sel, format, tamper, catalog]);

  const expected = tamper !== 'none' ? 'INVALID' : expired ? 'EXPIRED' : 'VALID';

  const start = async () => {
    setStarting(true);
    setError(undefined);
    try {
      const run = await api.startRun({ ...sel, format, tamper, expired, txCode });
      onOpenRun(run.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  };

  const recent = runs.slice(0, 8);

  return (
    <div className="space-y-5">
      <section className="card p-4">
        <div className="grid gap-4 lg:grid-cols-3">
          {(['issuer', 'wallet', 'verifier'] as const).map((role) => (
            <div key={role}>
              <div className="label mb-2 flex items-center gap-2">{ROLE_TITLES[role]}</div>
              <div className="space-y-2">
                {byRole(role).map((p) => (
                  <PartyCard key={p.id} party={p} selected={sel[role] === p.id} onSelect={() => setSel((s) => ({ ...s, [role]: p.id }))} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-4 border-t border-slate-200 pt-4 lg:grid-cols-[1fr_1.4fr_auto] dark:border-slate-800">
          <div>
            <div className="label mb-2">Credential format</div>
            <div className="flex flex-wrap gap-2">
              {(Object.entries(catalog.formats) as Array<[Format, { label: string; short: string }]>).map(([f, meta]) => (
                <button key={f} disabled={!formatOk(f)} onClick={() => setFormat(f)} title={formatOk(f) ? meta.label : 'Not supported by every selected party'}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-35 ${format === f ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100' : 'border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'}`}>
                  {meta.short}
                </button>
              ))}
            </div>
            <div className="mt-1.5 text-xs text-slate-500">{catalog.formats[format].label}</div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={txCode} onChange={(e) => setTxCode(e.target.checked)} />
              Require transaction code (PIN) on the offer
            </label>
          </div>

          <div>
            <div className="label mb-2">Scenario · replay &amp; tamper</div>
            <div className="flex flex-wrap gap-2">
              <ScenarioButton active={tamper === 'none' && !expired} onClick={() => { setTamper('none'); setExpired(false); }} label="Happy path" hint="Honest issue and presentation" />
              <ScenarioButton active={expired} disabled={!parties.issuer.expiredIssuance?.includes(format)} onClick={() => { setTamper('none'); setExpired(true); }}
                label="Expired credential" hint={parties.issuer.expiredIssuance?.includes(format) ? 'Issuer signs a credential whose validity already ended' : `${parties.issuer.name} can't issue expired ${catalog.formats[format].short}`} />
              {(Object.entries(catalog.tamperModes) as Array<[Tamper, any]>).filter(([t]) => t !== 'none').map(([t, m]) => (
                <ScenarioButton key={t} active={tamper === t} disabled={manual || !m.formats.includes(format)} onClick={() => { setTamper(t); setExpired(false); }}
                  label={m.label} hint={manual ? 'Tamper modes need the Reference Wallet' : m.formats.includes(format) ? m.description : `Not available for ${catalog.formats[format].short}`} tamper />
              ))}
            </div>
            <div className="mt-1.5 text-xs text-slate-500">
              Expected verifier verdict: <b className={expected === 'VALID' ? 'text-emerald-600' : expected === 'EXPIRED' ? 'text-amber-600' : 'text-red-600'}>{expected}</b>
              {tamper !== 'none' && <> — the run passes only if the verifier <i>rejects</i> the presentation.</>}
            </div>
          </div>

          <div className="flex flex-col justify-end gap-2">
            <button className="btn-primary h-11 min-w-44 text-base" disabled={!!problem || starting} onClick={start}>
              {starting ? 'Starting…' : '▶ Run flow'}
            </button>
            {(problem || error) && <div className="max-w-64 text-xs text-red-600 dark:text-red-400">{error ?? problem}</div>}
          </div>
        </div>
      </section>

      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="label">Recent</span>
          {recent.map((r) => (
            <button key={r.id} onClick={() => onOpenRun(r.id)}
              className={`chip border ${openRunId === r.id ? 'border-slate-900 dark:border-white' : 'border-transparent'} ${r.state === 'running' ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200' : r.result === 'PASS' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'}`}>
              {r.state === 'running' ? '◌' : r.result === 'PASS' ? '✓' : '✗'} {catalog.formats[r.format]?.short} · {name(catalog, r.issuer)} → {name(catalog, r.verifier)}
            </button>
          ))}
        </div>
      )}

      {openRunId ? <RunView key={openRunId} runId={openRunId} catalog={catalog} /> : (
        <div className="card grid place-items-center p-12 text-center text-sm text-slate-500">
          <div className="max-w-lg">
            <div className="mb-2 text-base font-semibold text-slate-700 dark:text-slate-200">Pick an issuer, a wallet and a verifier, then run the flow.</div>
            Every OpenID4VCI and OpenID4VP exchange shows up live in the protocol inspector below, with JWTs, SD-JWT disclosures and credentials decoded.
          </div>
        </div>
      )}
    </div>
  );
}

const name = (c: Catalog, id: string) => c.parties.find((p) => p.id === id)?.name ?? id;

function PartyCard({ party, selected, onSelect }: { party: Party; selected: boolean; onSelect: () => void }) {
  const inji = party.vendor === 'Inji';
  return (
    <button onClick={onSelect} aria-pressed={selected}
      className={`w-full rounded-lg border p-3 text-left transition ${selected ? 'border-brand-600 bg-brand-50/60 ring-1 ring-brand-600 dark:bg-brand-700/10' : 'border-slate-200 hover:border-slate-400 dark:border-slate-800 dark:hover:border-slate-600'}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${party.health?.up === false ? 'bg-red-500' : 'bg-emerald-500'}`} title={party.health?.detail} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold">{party.name}</span>
            <span className={`chip ${inji ? 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200' : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200'}`}>{inji ? 'Inji' : 'non-Inji'}</span>
            <span className="chip bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">v{party.version}</span>
            {party.mode === 'manual' && <span className="chip bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">manual · QR</span>}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">{party.protocol}</div>
          {selected && <div className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">{party.description}</div>}
          {selected && party.health && !party.health.up && <div className="mt-1 text-xs text-red-600">{party.health.detail}</div>}
        </div>
      </div>
    </button>
  );
}

function ScenarioButton({ active, disabled, onClick, label, hint, tamper }: { active: boolean; disabled?: boolean; onClick: () => void; label: string; hint: string; tamper?: boolean }) {
  return (
    <button disabled={disabled} onClick={onClick} title={hint}
      className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-35 ${active ? (tamper ? 'border-red-600 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200' : 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100') : 'border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'}`}>
      {tamper && '⚠ '}{label}
    </button>
  );
}
