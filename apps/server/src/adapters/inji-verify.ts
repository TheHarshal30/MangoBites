import { randomBytes } from 'node:crypto';
import { INJI_VERIFY_URL } from '../config.js';
import { emit } from '../events.js';
import { traced, rewrite } from '../http.js';
import { presentationDefinition, type Expectation, type Format } from '../actors/presentation-definition.js';
import type { VerificationOutcome, VerificationStatus } from '../actors/verifier.js';

/**
 * Inji Verify 0.16 verify-service. Two integration surfaces:
 *  - OpenID4VP cross-device flow: /vp-request → wallet direct_post → /vp-request/{id}/status → /vp-result/{txn}
 *  - Direct VC verification (what the QR-scan/upload UI uses): POST /vc-verification
 */

const API = `${INJI_VERIFY_URL}/v1/verify`;
/** A non-DID client_id → Inji Verify returns authorizationDetails by value (pre-registered scheme). */
export const INJI_VERIFY_CLIENT_ID = 'inji-interop-playground';

const mapStatus = (s: string | undefined): VerificationStatus =>
  s === 'SUCCESS' ? 'VALID' : s === 'EXPIRED' ? 'EXPIRED' : 'INVALID';

export async function verifyHealth() {
  try {
    const r = await fetch(rewrite(`${API}/actuator/health`), { signal: AbortSignal.timeout(4000) });
    const b: any = await r.json();
    return { up: b.status === 'UP', detail: b.status === 'UP' ? 'ready' : `status ${b.status}` };
  } catch (e: any) {
    return { up: false, detail: `unreachable at ${INJI_VERIFY_URL} (${e.cause?.code ?? e.message}) — run "docker compose up -d"` };
  }
}

/** Builds the openid4vp:// URL the same way @mosip/react-inji-verify-sdk's OpenID4VPVerification does. */
function authorizationUri(d: any, requestId: string) {
  const params = new URLSearchParams({
    client_id: d.clientId,
    state: requestId,
    response_mode: d.responseMode,
    response_type: d.responseType,
    nonce: d.nonce,
    response_uri: d.responseUri,
  });
  if (d.presentationDefinitionUri) params.set('presentation_definition_uri', `${API}${d.presentationDefinitionUri}`);
  else params.set('presentation_definition', JSON.stringify(d.presentationDefinition));
  params.set('client_metadata', JSON.stringify({ client_name: 'Inji Verify (via Interop Playground)', vp_formats: d.clientMetadata?.vp_formats ?? undefined }));
  return `openid4vp://authorize?${params.toString()}`;
}

export async function createInjiVpRequest(runId: string, expectation: Expectation) {
  const pd = presentationDefinition(expectation, `inji-${expectation.format.replace(/\W/g, '')}-${randomBytes(4).toString('hex')}`);
  const res = await traced({
    runId, step: 'OpenID4VP · Create VP request (Inji Verify /vp-request)', from: 'playground', to: 'verifier',
    url: `${API}/vp-request`,
    body: { clientId: INJI_VERIFY_CLIENT_ID, nonce: randomBytes(16).toString('base64url'), presentationDefinition: pd },
  });
  const { transactionId, requestId, authorizationDetails } = res.body;
  return { transactionId, requestId, presentationDefinition: pd, authorizationRequestUri: authorizationUri(authorizationDetails, requestId) };
}

export async function awaitInjiVpResult(runId: string, requestId: string, transactionId: string, timeoutMs: number): Promise<VerificationOutcome> {
  const deadline = Date.now() + timeoutMs;
  let status = 'ACTIVE';
  let first = true;
  while (status === 'ACTIVE' && Date.now() < deadline) {
    const r = await traced({
      runId, step: 'OpenID4VP · Poll status (Inji Verify)', from: 'playground', to: 'verifier',
      url: `${API}/vp-request/${requestId}/status`, allowError: true,
    });
    status = r.body?.status ?? 'ERROR';
    if (first && status === 'ACTIVE') {
      emit({ runId, step: 'OpenID4VP · Waiting for wallet', kind: 'await', from: 'verifier', to: 'wallet', summary: 'Inji Verify is waiting for the wallet to submit a presentation' });
      first = false;
    }
  }
  if (status !== 'VP_SUBMITTED') {
    return { status: 'INVALID', checks: [{ name: 'Presentation received', ok: false, detail: `request status ${status}` }] };
  }
  const res = await traced({
    runId, step: 'OpenID4VP · Fetch result (Inji Verify /vp-result)', from: 'playground', to: 'verifier',
    url: `${API}/vp-result/${transactionId}`, allowError: true,
  });
  const body = res.body ?? {};
  if (res.status >= 400) {
    return { status: 'INVALID', checks: [{ name: 'Inji Verify result', ok: false, detail: body.errorMessage ?? body.errorCode ?? `HTTP ${res.status}` }], raw: body };
  }
  const vcResults: any[] = body.vcResults ?? [];
  const checks = vcResults.map((v, i) => ({ name: `VC #${i + 1} verificationStatus`, ok: v.verificationStatus === 'SUCCESS', detail: v.verificationStatus }));
  checks.unshift({ name: 'vpResultStatus', ok: body.vpResultStatus === 'SUCCESS', detail: body.vpResultStatus });
  const statuses = vcResults.map((v) => mapStatus(v.verificationStatus));
  const overall: VerificationStatus = body.vpResultStatus === 'SUCCESS' && statuses.every((s) => s === 'VALID') ? 'VALID'
    : statuses.length && statuses.every((s) => s === 'EXPIRED' || s === 'VALID') && statuses.includes('EXPIRED') ? 'EXPIRED' : 'INVALID';
  return { status: overall, checks, raw: body };
}

const CONTENT_TYPES: Partial<Record<Format, string>> = {
  ldp_vc: 'application/vc+ld+json',
  'vc+sd-jwt': 'application/vc+sd-jwt',
};

/** The QR-scan / upload path: hand Inji Verify the raw credential. */
export async function injiDirectVerify(runId: string, format: Format, credential: unknown): Promise<VerificationOutcome> {
  const contentType = CONTENT_TYPES[format];
  if (!contentType) return { status: 'INVALID', checks: [{ name: 'Format supported by /vc-verification', ok: false, detail: `${format} is not accepted by Inji Verify 0.16 /vc-verification` }] };
  const res = await traced({
    runId, step: 'Direct verification (Inji Verify /vc-verification)', from: 'wallet', to: 'verifier',
    url: `${API}/vc-verification`, body: typeof credential === 'string' ? credential : JSON.stringify(credential),
    headers: { 'content-type': contentType }, allowError: true,
  });
  const s = res.body?.verificationStatus;
  return {
    status: mapStatus(s),
    checks: [{ name: 'verificationStatus', ok: s === 'SUCCESS', detail: s ?? `HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}` }],
    raw: res.body,
  };
}
