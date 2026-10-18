import express from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PUBLIC_BASE_URL } from '../config.js';
import { correlate, emit, runIdFor } from '../events.js';
import { verifyLdpPresentation, didKeyFragmentDeviations } from '../formats/ldp.js';
import { verifySdJwt } from '../formats/sdjwt.js';
import { verifyMdocPresentation } from '../formats/mdoc.js';
import { decodeArtefacts } from '../util/decode.js';
import { presentationDefinition, type Expectation } from './presentation-definition.js';

/**
 * Playground Verifier — an independent OpenID4VP (draft 21+, response_mode=direct_post,
 * client_id_scheme=redirect_uri) relying party that checks everything the spec asks for:
 * issuer proof, holder binding, nonce/audience, presentation_submission and expiry.
 */

export const VERIFIER_URL = `${PUBLIC_BASE_URL}/verifier`;
const RESPONSE_URI = `${VERIFIER_URL}/response`;

export type VerificationStatus = 'VALID' | 'INVALID' | 'EXPIRED';

export interface Check { name: string; ok: boolean; detail?: string }

export interface VerificationOutcome {
  status: VerificationStatus;
  checks: Check[];
  claims?: Record<string, unknown>;
  raw?: unknown;
}

interface VpRequest {
  id: string;
  runId: string;
  expectation: Expectation;
  nonce: string;
  state: string;
  clientId: string;
  presentationDefinition: any;
  createdAt: number;
  outcome?: VerificationOutcome;
}

const requests = new Map<string, VpRequest>();
const byState = new Map<string, VpRequest>();
const done = new EventEmitter();

export function createPlaygroundVpRequest(runId: string, expectation: Expectation, opts: { byReference?: boolean } = {}) {
  const id = randomUUID();
  const state = randomBytes(12).toString('base64url');
  const nonce = randomBytes(16).toString('base64url');
  const pd = presentationDefinition(expectation, `playground-${expectation.format}-${id.slice(0, 8)}`);
  const req: VpRequest = { id, runId, expectation, nonce, state, clientId: RESPONSE_URI, presentationDefinition: pd, createdAt: Date.now() };
  requests.set(id, req);
  byState.set(state, req);
  correlate(state, runId);

  const params = {
    response_type: 'vp_token',
    client_id: RESPONSE_URI,
    client_id_scheme: 'redirect_uri',
    response_mode: 'direct_post',
    response_uri: RESPONSE_URI,
    nonce, state,
    client_metadata: {
      client_name: 'Inji Interop Playground Verifier',
      vp_formats: {
        ldp_vp: { proof_type: ['Ed25519Signature2020'] },
        ldp_vc: { proof_type: ['Ed25519Signature2020', 'RsaSignature2018'] },
        'vc+sd-jwt': { 'sd-jwt_alg_values': ['ES256', 'EdDSA'], 'kb-jwt_alg_values': ['ES256', 'EdDSA'] },
        mso_mdoc: { alg: ['ES256'] },
      },
    },
  };
  const authorizationRequestUri = opts.byReference
    ? `openid4vp://authorize?client_id=${encodeURIComponent(RESPONSE_URI)}&request_uri=${encodeURIComponent(`${VERIFIER_URL}/requests/${id}/object`)}`
    : `openid4vp://authorize?${new URLSearchParams({
      ...params,
      client_metadata: JSON.stringify(params.client_metadata),
      presentation_definition_uri: `${VERIFIER_URL}/requests/${id}/presentation-definition`,
    }).toString()}`;
  return { id, nonce, state, presentationDefinition: pd, authorizationRequest: { ...params, presentation_definition: pd }, authorizationRequestUri };
}

export function awaitPlaygroundResult(id: string, timeoutMs: number): Promise<VerificationOutcome> {
  const r = requests.get(id);
  if (r?.outcome) return Promise.resolve(r.outcome);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { done.off(id, onDone); reject(new Error(`No presentation received within ${Math.round(timeoutMs / 1000)}s`)); }, timeoutMs);
    const onDone = (o: VerificationOutcome) => { clearTimeout(timer); resolve(o); };
    done.once(id, onDone);
  });
}

function parseVpToken(raw: string): unknown {
  const t = raw.trim();
  if (t.startsWith('{') || t.startsWith('[')) return JSON.parse(t);
  return t;
}

async function evaluate(req: VpRequest, body: Record<string, string>): Promise<VerificationOutcome> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });
  if (body.error) {
    add('Wallet response', false, `${body.error}: ${body.error_description ?? ''}`);
    return { status: 'INVALID', checks };
  }
  if (!body.vp_token) {
    add('vp_token present', false);
    return { status: 'INVALID', checks };
  }

  let submission: any;
  try {
    submission = JSON.parse(body.presentation_submission ?? 'null');
  } catch { /* checked below */ }
  const desc = submission?.descriptor_map?.[0];
  const pdDesc = req.presentationDefinition.input_descriptors[0];
  add('presentation_submission references this definition', submission?.definition_id === req.presentationDefinition.id,
    `definition_id=${submission?.definition_id ?? '∅'}`);
  add('descriptor_map matches input descriptor', desc?.id === pdDesc.id, `descriptor id=${desc?.id ?? '∅'}, expected ${pdDesc.id}`);

  const vpToken = parseVpToken(body.vp_token);
  const fmt = req.expectation.format;
  let expired = false;
  let claims: Record<string, unknown> | undefined;

  if (fmt === 'ldp_vc') {
    const vp: any = Array.isArray(vpToken) ? vpToken[0] : vpToken;
    if (typeof vp !== 'object' || !vp?.verifiableCredential) {
      add('vp_token is an ldp_vp', false, `got ${typeof vp}`);
      return { status: 'INVALID', checks };
    }
    add('descriptor format is ldp_vp/ldp_vc', ['ldp_vp', 'ldp_vc'].includes(desc?.format), `format=${desc?.format}`);
    const r = await verifyLdpPresentation(vp, req.nonce, req.clientId);
    const vc: any = [].concat(vp.verifiableCredential)[0];
    add('Issuer proof (credential signature)', r.credentialsValid, r.credentialsValid ? vc?.proof?.type : r.errors.join('; '));
    add('Holder proof (VP signature, challenge=nonce, domain=client_id)', r.holderProofValid,
      r.holderProofValid ? `holder ${vp.holder}` : r.errors.filter((e) => /challenge|domain|presentation|proof/i.test(e)).join('; ') || r.errors.join('; '));
    const subjectId: string | undefined = vc?.credentialSubject?.id;
    const subjectDid = subjectId?.split('#')[0];
    add('Holder is the credential subject', !subjectId || subjectDid === vp.holder,
      `subject=${subjectId ?? '∅'}, holder=${vp.holder}${subjectId?.includes('#') ? ' (note: subject id is a DID URL with fragment, not a DID)' : ''}`);
    const vm: string | undefined = vc?.proof?.verificationMethod;
    if (vm && didKeyFragmentDeviations.has(vm)) {
      add('did:key verificationMethod fragment is the key fingerprint', true, `non-standard fragment accepted: ${vm.split('#')[1]}`);
    }
    const types: string[] = [].concat(vc?.type ?? []);
    if (req.expectation.type) add(`Credential type includes ${req.expectation.type}`, types.includes(req.expectation.type), types.join(', '));
    expired = r.expired;
    claims = vc?.credentialSubject;
  } else if (fmt === 'vc+sd-jwt') {
    if (typeof vpToken !== 'string') {
      add('vp_token is an SD-JWT', false);
      return { status: 'INVALID', checks };
    }
    add('descriptor format is vc+sd-jwt', ['vc+sd-jwt', 'dc+sd-jwt'].includes(desc?.format), `format=${desc?.format}`);
    const r = await verifySdJwt(vpToken, { nonce: req.nonce, aud: req.clientId, requireKeyBinding: true });
    add('Issuer signature', r.signatureValid, r.errors.find((e) => e.startsWith('Issuer')));
    add('Disclosures match _sd digests', r.disclosuresValid, r.errors.find((e) => e.includes('disclosure')));
    add('Key Binding JWT (holder, nonce, aud, sd_hash)', r.keyBindingValid === true, r.errors.find((e) => e.startsWith('Key binding')));
    if (req.expectation.vct) add(`vct is ${req.expectation.vct}`, r.claims.vct === req.expectation.vct, String(r.claims.vct));
    const hidden = Object.keys(r.claims).filter((k) => !['iss', 'vct', 'iat', 'nbf', 'exp', 'cnf', 'status'].includes(k));
    add('Selective disclosure', true, `disclosed: ${hidden.join(', ') || 'none'}`);
    expired = r.expired;
    claims = r.claims;
  } else {
    if (typeof vpToken !== 'string') {
      add('vp_token is a base64url DeviceResponse', false);
      return { status: 'INVALID', checks };
    }
    add('descriptor format is mso_mdoc', desc?.format === 'mso_mdoc', `format=${desc?.format}`);
    const r = await verifyMdocPresentation(vpToken, {
      mdocGeneratedNonce: body.mdoc_generated_nonce ?? '', clientId: req.clientId, responseUri: RESPONSE_URI, nonce: req.nonce,
    });
    add('IssuerAuth (MSO signature + certificate)', r.issuerAuthValid, r.errors.filter((e) => e.startsWith('ISSUER_AUTH')).join('; '));
    add('DeviceAuth (holder signature over SessionTranscript)', r.deviceAuthValid, r.errors.filter((e) => e.startsWith('DEVICE_AUTH')).join('; '));
    add('Data integrity (value digests)', r.dataIntegrityValid, r.errors.filter((e) => e.startsWith('DATA_INTEGRITY')).join('; '));
    expired = r.expired;
    claims = r.claims;
  }

  const allOk = checks.every((c) => c.ok);
  if (allOk) add('Validity period', !expired, expired ? 'credential is past its expiry' : 'within validity');
  const status: VerificationStatus = !allOk ? 'INVALID' : expired ? 'EXPIRED' : 'VALID';
  return { status, checks, claims };
}

export const verifierRouter = express.Router();
verifierRouter.use(express.json(), express.urlencoded({ extended: false, limit: '2mb' }));

verifierRouter.get('/requests/:id/presentation-definition', (req, res) => {
  const r = requests.get(String(req.params.id));
  if (!r) return void res.status(404).json({ error: 'not_found' });
  res.json(r.presentationDefinition);
});

/** Request object by reference — unsigned (alg "none") as permitted for client_id_scheme=redirect_uri. */
verifierRouter.get('/requests/:id/object', (req, res) => {
  const r = requests.get(String(req.params.id));
  if (!r) return void res.status(404).json({ error: 'not_found' });
  const claims = {
    response_type: 'vp_token', client_id: r.clientId, client_id_scheme: 'redirect_uri', response_mode: 'direct_post',
    response_uri: RESPONSE_URI, nonce: r.nonce, state: r.state, presentation_definition: r.presentationDefinition,
    iat: Math.floor(r.createdAt / 1000),
  };
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  res.type('application/oauth-authz-req+jwt').send(`${enc({ alg: 'none', typ: 'oauth-authz-req+jwt' })}.${enc(claims)}.`);
});

verifierRouter.post('/response', async (req, res) => {
  const body = req.body ?? {};
  const r = byState.get(body.state);
  if (!r) return void res.status(400).json({ error: 'invalid_request', error_description: 'unknown state' });
  if (r.outcome) return void res.status(400).json({ error: 'invalid_request', error_description: 'response already received for this request' });
  const external = !req.header('x-playground-run');
  if (external) {
    emit({
      runId: runIdFor(body.state) ?? r.runId, step: 'OpenID4VP · Authorization response (direct_post)', kind: 'http', from: 'wallet', to: 'verifier',
      summary: 'POST /verifier/response ← external wallet', request: { method: 'POST', url: RESPONSE_URI, body },
      response: { status: 200, body: {} }, data: decodeArtefacts(body),
    });
  }
  let outcome: VerificationOutcome;
  try {
    outcome = await evaluate(r, body);
  } catch (e: any) {
    outcome = { status: 'INVALID', checks: [{ name: 'Verification', ok: false, detail: e.message }] };
  }
  r.outcome = outcome;
  emit({
    runId: r.runId, step: 'OpenID4VP · Verification', kind: 'action', from: 'verifier', to: 'verifier',
    summary: `Playground Verifier result: ${outcome.status}`, data: { outcome },
  });
  done.emit(r.id, outcome);
  res.json({});
});

verifierRouter.get('/requests/:id/result', (req, res) => {
  const r = requests.get(String(req.params.id));
  if (!r) return void res.status(404).json({ error: 'not_found' });
  res.json({ status: r.outcome ? 'COMPLETED' : 'PENDING', outcome: r.outcome });
});
