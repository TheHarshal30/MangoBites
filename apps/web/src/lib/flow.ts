import { useSyncExternalStore } from 'react';
import { BadgeCheck, FileWarning, Hourglass, Repeat, Tag, UserX, type LucideIcon } from 'lucide-react';
import type { Catalog, Format, Party, RunSummary, Tamper, Verdict } from '../api';

export type ScenarioId = 'happy' | 'expired' | 'bad-signature' | 'wrong-type' | 'replay' | 'wrong-holder';

export interface FlowConfig {
  issuer: string;
  wallet: string;
  verifier: string;
  format: Format;
  scenario: ScenarioId;
  txCode: boolean;
}

export const SCENARIOS: Record<ScenarioId, { label: string; short: string; icon: LucideIcon; expected: Verdict; description: string; negative: boolean }> = {
  happy: { label: 'Happy path', short: 'OK', icon: BadgeCheck, expected: 'VALID', negative: false, description: 'Honest issuance and presentation' },
  expired: { label: 'Expired credential', short: 'EXP', icon: Hourglass, expected: 'EXPIRED', negative: true, description: 'Issuer signs a credential whose validity has already ended' },
  'bad-signature': { label: 'Bad signature', short: 'SIG', icon: FileWarning, expected: 'INVALID', negative: true, description: 'Wallet edits a signed claim after issuance' },
  'wrong-type': { label: 'Wrong type', short: 'TYP', icon: Tag, expected: 'INVALID', negative: true, description: 'Wallet rewrites the credential type the verifier asked for' },
  replay: { label: 'Replay', short: 'RPL', icon: Repeat, expected: 'INVALID', negative: true, description: 'Presentation bound to a stale nonce instead of the verifier’s' },
  'wrong-holder': { label: 'Wrong holder', short: 'HLD', icon: UserX, expected: 'INVALID', negative: true, description: 'Presentation signed by a key the credential isn’t bound to' },
};

export const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];

export const scenarioOf = (r: Pick<RunSummary, 'tamper' | 'expired'>): ScenarioId =>
  r.tamper !== 'none' ? (r.tamper as ScenarioId) : r.expired ? 'expired' : 'happy';

export const toRunInput = (c: FlowConfig) => ({
  issuer: c.issuer,
  wallet: c.wallet,
  verifier: c.verifier,
  format: c.format,
  tamper: (c.scenario === 'happy' || c.scenario === 'expired' ? 'none' : c.scenario) as Tamper,
  expired: c.scenario === 'expired',
  txCode: c.txCode,
});

export const fromRun = (r: RunSummary): FlowConfig => ({
  issuer: r.issuer, wallet: r.wallet, verifier: r.verifier, format: r.format, scenario: scenarioOf(r), txCode: r.txCode,
});

export const sameFlow = (a: FlowConfig, b: FlowConfig) =>
  a.issuer === b.issuer && a.wallet === b.wallet && a.verifier === b.verifier && a.format === b.format && a.scenario === b.scenario && a.txCode === b.txCode;

const partiesOf = (c: FlowConfig, cat: Catalog) => {
  const find = (id: string) => cat.parties.find((p) => p.id === id);
  return [find(c.issuer), find(c.wallet), find(c.verifier)].filter(Boolean) as Party[];
};

/** Why a format can't be picked with the current parties, or undefined if it can. */
export function formatBlocker(c: FlowConfig, cat: Catalog, f: Format) {
  const missing = partiesOf(c, cat).filter((p) => !p.formats.includes(f));
  return missing.length ? `Not supported by ${missing.map((p) => p.name).join(' or ')}` : undefined;
}

/** Why a scenario can't be picked with the current parties and format, or undefined if it can. */
export function scenarioBlocker(c: FlowConfig, cat: Catalog, s: ScenarioId) {
  const [issuer, wallet] = partiesOf(c, cat);
  const short = cat.formats[c.format]?.short ?? c.format;
  if (s === 'happy') return undefined;
  if (s === 'expired') return issuer?.expiredIssuance?.includes(c.format) ? undefined : `${issuer?.name ?? 'This issuer'} can’t issue an expired ${short} credential`;
  if (wallet?.mode === 'manual') return 'Needs the Reference Wallet — a real wallet won’t forge presentations';
  if (!cat.tamperModes[s as Tamper]?.formats.includes(c.format)) return `Not available for ${short}`;
  if (c.verifier === 'inji-verify-direct' && (s === 'replay' || s === 'wrong-holder')) return 'VC upload verifies the bare credential — there is no holder proof to tamper with';
  return undefined;
}

/** Blocking problem with the whole configuration (shown next to the Run button). */
export function flowProblem(c: FlowConfig, cat: Catalog) {
  const blocker = formatBlocker(c, cat, c.format);
  if (blocker) return `No common credential format — ${blocker.toLowerCase()}`;
  const down = partiesOf(c, cat).find((p) => p.health && !p.health.up);
  if (down) return `${down.name} is unreachable: ${down.health!.detail}`;
  return scenarioBlocker(c, cat, c.scenario);
}

/** Keeps a configuration valid after a party or format change (falls back to the first allowed option). */
export function normalize(c: FlowConfig, cat: Catalog): FlowConfig {
  const next = { ...c };
  for (const role of ['issuer', 'wallet', 'verifier'] as const) {
    if (!cat.parties.some((p) => p.id === next[role] && p.role === role)) next[role] = cat.parties.find((p) => p.role === role)?.id ?? next[role];
  }
  if (formatBlocker(next, cat, next.format)) {
    const f = (Object.keys(cat.formats) as Format[]).find((x) => !formatBlocker(next, cat, x));
    if (f) next.format = f;
  }
  if (scenarioBlocker(next, cat, next.scenario)) next.scenario = 'happy';
  return next;
}

// ── Persisted configuration store ────────────────────────────────────────────

const KEY = 'playground.flow';
const DEFAULT: FlowConfig = { issuer: 'inji-certify', wallet: 'playground-wallet', verifier: 'inji-verify', format: 'ldp_vc', scenario: 'happy', txCode: false };

let current: FlowConfig = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT;
})();
const subs = new Set<() => void>();

export function setFlowConfig(next: FlowConfig) {
  current = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  for (const s of subs) s();
}

/** The configurator selection; survives tab switches and reloads. */
export function useFlowConfig() {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => current,
  );
}
