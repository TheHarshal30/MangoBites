import { party, FORMATS, PARTIES } from './catalog.js';
import { startRun, whenDone, validateInput, type Run, type RunInput } from './runs.js';
import { TAMPER_MODES, type Tamper } from './actors/wallet.js';
import type { Format } from './actors/presentation-definition.js';

export interface Scenario { id: string; label: string; tamper: Tamper; expired: boolean }

export const SCENARIOS: Scenario[] = [
  { id: 'happy', label: 'Happy path', tamper: 'none', expired: false },
  { id: 'expired', label: 'Expired credential', tamper: 'none', expired: true },
  ...(['bad-signature', 'wrong-type', 'replay', 'wrong-holder'] as Tamper[]).map((t) => ({ id: t, label: TAMPER_MODES[t].label, tamper: t, expired: false })),
];

/** Every automatable issuer × verifier × format × scenario combination (Reference Wallet as holder). */
export function matrixInputs(opts: { scenarios?: string[]; issuers?: string[]; verifiers?: string[]; formats?: Format[] } = {}): RunInput[] {
  const issuers = PARTIES.filter((p) => p.role === 'issuer' && (!opts.issuers || opts.issuers.includes(p.id)));
  const verifiers = PARTIES.filter((p) => p.role === 'verifier' && p.mode === 'auto' && (!opts.verifiers || opts.verifiers.includes(p.id)));
  const scenarios = SCENARIOS.filter((s) => !opts.scenarios || opts.scenarios.includes(s.id));
  const out: RunInput[] = [];
  for (const i of issuers) for (const v of verifiers) for (const f of Object.keys(FORMATS) as Format[]) {
    if (opts.formats && !opts.formats.includes(f)) continue;
    for (const s of scenarios) {
      const input: RunInput = { issuer: i.id, wallet: 'playground-wallet', verifier: v.id, format: f, tamper: s.tamper, expired: s.expired };
      if (!validateInput(input)) out.push(input);
    }
  }
  return out;
}

export async function runMatrix(inputs: RunInput[], batchId: string, onProgress?: (done: number, total: number, run: Run) => void) {
  const results: Run[] = [];
  for (const input of inputs) {
    const r = await whenDone(startRun({ ...input, batchId }).id);
    results.push(r);
    onProgress?.(results.length, inputs.length, r);
  }
  return results;
}

const scenarioOf = (r: { tamper: string; expired: boolean }) => (r.tamper !== 'none' ? TAMPER_MODES[r.tamper as Tamper].label : r.expired ? 'Expired credential' : 'Happy path');

export function markdownReport(runs: Array<Pick<Run, 'issuer' | 'wallet' | 'verifier' | 'format' | 'tamper' | 'expired' | 'expected' | 'actual' | 'result' | 'error' | 'proofType' | 'failedStage' | 'createdAt' | 'durationMs'>>, title = 'Inji Interoperability Report') {
  const pass = runs.filter((r) => r.result === 'PASS').length;
  const lines: string[] = [];
  lines.push(`# ${title}`, '');
  lines.push(`Generated ${new Date().toISOString()} · ${runs.length} runs · **${pass} pass / ${runs.length - pass} fail**`, '');
  lines.push('A run **passes** when the verifier reaches the verdict the scenario calls for: `VALID` for the happy path, `EXPIRED` for an expired credential, `INVALID` for every tamper mode. A verifier that accepts a forged or replayed presentation therefore *fails* that row.', '');
  lines.push('## Compatibility matrix (happy path)', '');
  const verifiers = [...new Set(runs.map((r) => r.verifier))];
  lines.push(`| Issuer → Verifier | Format | ${verifiers.map((v) => party(v)?.name ?? v).join(' | ')} |`);
  lines.push(`|---|---|${verifiers.map(() => ':-:').join('|')}|`);
  const happy = runs.filter((r) => r.tamper === 'none' && !r.expired);
  const issuers = [...new Set(happy.map((r) => r.issuer))];
  for (const i of issuers) for (const f of Object.keys(FORMATS) as Format[]) {
    const rows = happy.filter((r) => r.issuer === i && r.format === f);
    if (!rows.length) continue;
    const cells = verifiers.map((v) => {
      const r = rows.find((x) => x.verifier === v);
      return r ? (r.result === 'PASS' ? '✅' : `❌ ${r.actual ?? r.failedStage ?? ''}`) : '—';
    });
    lines.push(`| ${party(i)?.name ?? i} | ${FORMATS[f].short} | ${cells.join(' | ')} |`);
  }
  lines.push('', '## All runs', '');
  lines.push('| Issuer | Wallet | Verifier | Format | Proof | Scenario | Expected | Actual | Result | Detail |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of runs) {
    const detail = r.result === 'PASS' ? '' : (r.error ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 220);
    lines.push(`| ${party(r.issuer)?.name ?? r.issuer} | ${party(r.wallet)?.name ?? r.wallet} | ${party(r.verifier)?.name ?? r.verifier} | ${FORMATS[r.format]?.short ?? r.format} | ${r.proofType ?? '—'} | ${scenarioOf(r)} | ${r.expected} | ${r.actual ?? '—'} | ${r.result === 'PASS' ? '✅ PASS' : '❌ FAIL'} | ${detail} |`);
  }
  return lines.join('\n') + '\n';
}
