import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { DATA_DIR } from './config.js';
import { bus, emit, type ProtocolEvent } from './events.js';
import { party, FORMATS } from './catalog.js';
import type { Expectation, Format } from './actors/presentation-definition.js';
import { createPlaygroundOffer, CREDENTIAL_CONFIGS, PLAYGROUND_VCT } from './actors/issuer.js';
import { createPlaygroundVpRequest, awaitPlaygroundResult, type VerificationOutcome, type VerificationStatus } from './actors/verifier.js';
import { receiveCredential, presentCredential, summarize, TAMPER_MODES, type StoredCredential, type Tamper } from './actors/wallet.js';
import { createCertifyOffer } from './adapters/inji-certify.js';
import { createInjiVpRequest, awaitInjiVpResult, injiDirectVerify } from './adapters/inji-verify.js';
import { decodeJwt } from './util/decode.js';
import { splitSdJwt } from './formats/sdjwt.js';
import { MDL_DOCTYPE } from './formats/mdoc.js';

export interface RunInput {
  issuer: string;
  wallet: string;
  verifier: string;
  format: Format;
  tamper?: Tamper;
  expired?: boolean;
  txCode?: boolean;
  /** Tag runs started by a matrix sweep so the dashboard can group them. */
  batchId?: string;
  /** Set when this run re-executes a failed one (flakiness check). */
  retryOf?: string;
}

type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'waiting' | 'skipped';

export interface Run extends Required<Omit<RunInput, 'batchId' | 'retryOf'>> {
  id: string;
  batchId?: string;
  retryOf?: string;
  createdAt: string;
  finishedAt?: string;
  durationMs?: number;
  state: 'running' | 'completed' | 'error';
  stages: Record<'issue' | 'present' | 'verify', { status: StageStatus; detail?: string }>;
  versions: Record<string, string>;
  proofType?: string;
  expected: VerificationStatus;
  actual?: VerificationStatus;
  /** PASS when the verifier reached the verdict the scenario calls for (incl. rejecting forgeries). */
  result?: 'PASS' | 'FAIL';
  error?: string;
  failedStage?: 'issue' | 'present' | 'verify';
  outcome?: VerificationOutcome;
  credential?: { format: Format; summary: Record<string, unknown> };
  /** Values a manual (phone) wallet needs: offer QR, PIN, presentation QR. */
  interaction?: { offerUri?: string; txCode?: string; authorizationRequestUri?: string; prompt?: string };
  events: ProtocolEvent[];
}

const runs = new Map<string, Run>();
const runsDir = () => path.join(DATA_DIR, 'runs');
export const runUpdates = new EventEmitter();
runUpdates.setMaxListeners(100);
const manualSignals = new EventEmitter();

function load() {
  if (!fs.existsSync(runsDir())) return;
  for (const f of fs.readdirSync(runsDir())) {
    try {
      const r: Run = JSON.parse(fs.readFileSync(path.join(runsDir(), f), 'utf8'));
      if (r.state === 'running') { r.state = 'error'; r.error = 'Interrupted by server restart'; r.result = 'FAIL'; }
      runs.set(r.id, r);
    } catch { /* skip corrupt file */ }
  }
}
load();

function persist(r: Run) {
  fs.mkdirSync(runsDir(), { recursive: true });
  fs.writeFileSync(path.join(runsDir(), `${r.id}.json`), JSON.stringify(r));
}

function publish(r: Run) {
  runUpdates.emit('run', summaryOf(r));
}

bus.on('event', (e: ProtocolEvent) => {
  const r = runs.get(e.runId);
  if (r) r.events.push(e);
});

export function summaryOf(r: Run) {
  const { events, outcome, ...rest } = r;
  return { ...rest, outcomeChecks: outcome?.checks, eventCount: events.length };
}

export function listRuns() {
  return [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(summaryOf);
}

export function getRun(id: string) {
  return runs.get(id);
}

export function deleteRuns() {
  runs.clear();
  fs.rmSync(runsDir(), { recursive: true, force: true });
}

/** Phone-wallet runs pause until the user confirms the step happened on the device. */
export function signalManual(runId: string, step: 'issued') {
  manualSignals.emit(`${runId}:${step}`);
}

function waitManual(runId: string, step: 'issued', timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timed out waiting for the mobile wallet')), timeoutMs);
    manualSignals.once(`${runId}:${step}`, () => { clearTimeout(t); resolve(); });
  });
}

export function validateInput(input: RunInput): string | undefined {
  const iss = party(input.issuer), wal = party(input.wallet), ver = party(input.verifier);
  if (!iss || iss.role !== 'issuer') return `Unknown issuer ${input.issuer}`;
  if (!wal || wal.role !== 'wallet') return `Unknown wallet ${input.wallet}`;
  if (!ver || ver.role !== 'verifier') return `Unknown verifier ${input.verifier}`;
  if (!FORMATS[input.format]) return `Unknown format ${input.format}`;
  for (const p of [iss, wal, ver]) if (!p.formats.includes(input.format)) return `${p.name} does not support ${FORMATS[input.format].short}`;
  const tamper = input.tamper ?? 'none';
  if (!TAMPER_MODES[tamper]) return `Unknown tamper mode ${tamper}`;
  if (tamper !== 'none' && wal.mode === 'manual') return 'Tamper modes need the Reference Wallet (a real wallet will not forge presentations)';
  if (tamper !== 'none' && !TAMPER_MODES[tamper].formats.includes(input.format)) return `Tamper "${tamper}" is not available for ${FORMATS[input.format].short}`;
  if (input.expired && !iss.expiredIssuance?.includes(input.format)) return `${iss.name} cannot issue already-expired ${FORMATS[input.format].short} credentials`;
  if (input.verifier === 'inji-verify-direct' && ['replay', 'wrong-holder'].includes(tamper)) return 'Replay / wrong-holder only apply to presentations (VC upload has no holder proof)';
  return undefined;
}

function proofTypeOf(c: StoredCredential): string {
  try {
    if (c.format === 'ldp_vc') return c.credential.proof?.type ?? 'none';
    if (c.format === 'vc+sd-jwt') return `JWS ${decodeJwt(splitSdJwt(c.credential).jwt)?.header.alg}`;
    return 'COSE ES256';
  } catch { return 'unknown'; }
}

function expectationFor(c: StoredCredential): Expectation {
  if (c.format === 'ldp_vc') {
    const types: string[] = [].concat(c.credential.type ?? []);
    return { format: 'ldp_vc', type: types.find((t) => t !== 'VerifiableCredential') };
  }
  if (c.format === 'vc+sd-jwt') return { format: 'vc+sd-jwt', vct: String(c.summary.vct ?? PLAYGROUND_VCT), claims: ['fullName', 'dateOfBirth'] };
  return { format: 'mso_mdoc', doctype: String(c.summary.docType ?? MDL_DOCTYPE) };
}

const playgroundConfigFor = (format: Format) => Object.keys(CREDENTIAL_CONFIGS).find((k) => CREDENTIAL_CONFIGS[k].format === format)!;

export function startRun(input: RunInput): Run {
  const tamper = input.tamper ?? 'none';
  const run: Run = {
    id: randomUUID(),
    batchId: input.batchId,
    retryOf: input.retryOf,
    issuer: input.issuer, wallet: input.wallet, verifier: input.verifier, format: input.format,
    tamper, expired: Boolean(input.expired), txCode: Boolean(input.txCode),
    createdAt: new Date().toISOString(),
    state: 'running',
    stages: { issue: { status: 'pending' }, present: { status: 'pending' }, verify: { status: 'pending' } },
    versions: Object.fromEntries([input.issuer, input.wallet, input.verifier].map((id) => [id, party(id)!.version])),
    expected: tamper !== 'none' ? 'INVALID' : input.expired ? 'EXPIRED' : 'VALID',
    events: [],
  };
  runs.set(run.id, run);
  publish(run);
  void execute(run);
  return run;
}

/** Resolves once the run has finished (used by the matrix sweep and the CLI). */
export function whenDone(id: string): Promise<Run> {
  return new Promise((resolve) => {
    const check = () => {
      const r = runs.get(id)!;
      if (r.state !== 'running') { runUpdates.off('run', onRun); resolve(r); return true; }
      return false;
    };
    const onRun = (s: { id: string }) => { if (s.id === id) check(); };
    runUpdates.on('run', onRun);
    check();
  });
}

async function execute(run: Run) {
  const started = Date.now();
  const stage = (name: keyof Run['stages'], status: StageStatus, detail?: string) => {
    run.stages[name] = { status, detail };
    publish(run);
  };
  const manual = party(run.wallet)!.mode === 'manual';
  let current: keyof Run['stages'] = 'issue';
  emit({
    runId: run.id, step: 'Run', kind: 'note', from: 'playground', to: 'playground',
    summary: `${party(run.issuer)!.name} → ${party(run.wallet)!.name} → ${party(run.verifier)!.name} · ${FORMATS[run.format].short}` +
      `${run.tamper !== 'none' ? ` · tamper: ${run.tamper}` : ''}${run.expired ? ' · expired credential' : ''} · expecting ${run.expected}`,
  });

  try {
    /* 1 ─ Issue (OpenID4VCI) */
    stage('issue', 'running');
    let offerUri: string;
    let txCode: string | undefined;
    if (run.issuer === 'playground-issuer') {
      const o = createPlaygroundOffer(run.id, playgroundConfigFor(run.format), { txCode: run.txCode, expired: run.expired });
      offerUri = o.offerByReferenceUri;
      txCode = o.txCode;
      emit({ runId: run.id, step: 'OpenID4VCI · Create offer (Reference Issuer)', kind: 'action', from: 'playground', to: 'issuer', summary: 'Pre-authorized credential offer created', data: { offer: o.offer, offerUri, txCode } });
    } else {
      const o = await createCertifyOffer(run.id, run.format, { txCode: run.txCode, expired: run.expired });
      offerUri = o.offerUri;
      txCode = o.txCode;
    }

    let credential: StoredCredential;
    if (manual) {
      run.interaction = { offerUri, txCode, prompt: 'Scan this credential offer with Inji Wallet, then press “Credential received”.' };
      stage('issue', 'waiting', 'Waiting for the mobile wallet to accept the offer');
      emit({ runId: run.id, step: 'OpenID4VCI · Waiting for wallet', kind: 'await', from: 'issuer', to: 'wallet', summary: 'Scan the offer QR with Inji Wallet', data: { offerUri, txCode } });
      await waitManual(run.id, 'issued', 10 * 60_000);
      // The phone keeps the credential; the playground only knows its shape.
      credential = { id: 'external', format: run.format, configId: '', issuer: run.issuer, credential: null, receivedAt: new Date().toISOString(), summary: {} };
    } else {
      credential = await receiveCredential(run.id, offerUri, { txCode });
      run.proofType = proofTypeOf(credential);
      run.credential = { format: credential.format, summary: summarize(credential.format, credential.credential) };
    }
    stage('issue', 'done', run.proofType);

    /* 2 ─ Present (OpenID4VP) */
    current = 'present';
    stage('present', 'running');
    const expectation = credential.credential ? expectationFor(credential) : { format: run.format } as Expectation;
    let outcome: VerificationOutcome;

    if (run.verifier === 'inji-verify-direct') {
      if (manual) throw new Error('VC upload verification needs the credential; use the Reference Wallet or Inji Verify · OpenID4VP');
      let raw = credential.credential;
      if (run.tamper === 'bad-signature' || run.tamper === 'wrong-type') {
        raw = tamperRaw(credential, run.tamper);
        emit({ runId: run.id, step: 'Tamper', kind: 'action', from: 'wallet', to: 'wallet', summary: `Wallet tampered the credential (${run.tamper})`, data: { tampered: raw } });
      }
      stage('present', 'skipped', 'VC upload — no presentation');
      current = 'verify';
      stage('verify', 'running');
      outcome = await injiDirectVerify(run.id, run.format, raw);
    } else {
      const request = run.verifier === 'playground-verifier'
        ? createPlaygroundVpRequest(run.id, expectation)
        : await createInjiVpRequest(run.id, expectation);
      emit({
        runId: run.id, step: 'OpenID4VP · Authorization request', kind: 'action', from: 'verifier', to: 'wallet',
        summary: 'Verifier created an authorization request (presentation_definition attached)',
        data: { authorizationRequestUri: request.authorizationRequestUri, presentation_definition: request.presentationDefinition },
      });
      if (manual) {
        run.interaction = { ...run.interaction, authorizationRequestUri: request.authorizationRequestUri, prompt: 'Scan this presentation request with Inji Wallet and share the credential.' };
        stage('present', 'waiting', 'Waiting for the mobile wallet to share');
      } else {
        const sent = await presentCredential(run.id, request.authorizationRequestUri, credential, run.tamper);
        if (sent.status >= 400) {
          emit({ runId: run.id, step: 'OpenID4VP · Verifier rejected submission', kind: 'note', from: 'verifier', to: 'wallet', summary: `response_uri returned ${sent.status}`, data: { response: sent.response } });
        }
      }
      stage('present', 'done');
      current = 'verify';
      stage('verify', 'running');
      const timeout = manual ? 10 * 60_000 : 60_000;
      outcome = run.verifier === 'playground-verifier'
        ? await awaitPlaygroundResult((request as any).id, timeout)
        : await awaitInjiVpResult(run.id, (request as any).requestId, (request as any).transactionId, timeout);
    }

    /* 3 ─ Grade */
    run.outcome = outcome;
    run.actual = outcome.status;
    run.result = outcome.status === run.expected ? 'PASS' : 'FAIL';
    if (run.result === 'FAIL') {
      run.failedStage = 'verify';
      run.error = `Verifier said ${outcome.status}, scenario expects ${run.expected}` +
        (outcome.checks.filter((c) => !c.ok).length ? ` — ${outcome.checks.filter((c) => !c.ok).map((c) => `${c.name}${c.detail ? `: ${c.detail}` : ''}`).join('; ')}` : '');
    }
    stage('verify', run.result === 'PASS' ? 'done' : 'failed', outcome.status);
    run.state = 'completed';
    emit({
      runId: run.id, step: 'Report', kind: 'note', from: 'playground', to: 'playground',
      summary: `${run.result}: verifier returned ${outcome.status}, expected ${run.expected}`, data: { outcome },
    });
  } catch (e: any) {
    run.state = 'error';
    run.result = 'FAIL';
    run.failedStage = current;
    run.error = e.message;
    stage(current, 'failed', e.message);
    emit({ runId: run.id, step: 'Error', kind: 'error', from: 'playground', to: 'playground', summary: e.message });
  } finally {
    run.finishedAt = new Date().toISOString();
    run.durationMs = Date.now() - started;
    persist(run);
    publish(run);
  }
}

function tamperRaw(c: StoredCredential, tamper: Tamper) {
  if (c.format === 'ldp_vc') {
    const vc = structuredClone(c.credential);
    if (tamper === 'wrong-type') vc.type = ['VerifiableCredential', 'ForgedCredential'];
    else vc.credentialSubject.fullName = `${vc.credentialSubject.fullName} (forged)`;
    return vc;
  }
  const { jwt } = splitSdJwt(c.credential);
  const [h, p, s] = jwt.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (tamper === 'wrong-type') payload.vct = 'urn:forged:OtherCredential';
  else payload.exp = (payload.exp ?? 0) + 10 * 365 * 86400;
  return `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}${c.credential.slice(jwt.length)}`;
}
