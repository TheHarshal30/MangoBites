import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Ed25519VerificationKey2020 } from '@digitalbazaar/ed25519-verification-key-2020';
import { DATA_DIR } from '../config.js';
import { emit } from '../events.js';
import { traced } from '../http.js';
import { keys, signEdJwt, signJwt, type EdKey } from '../crypto/keys.js';
import { presentLdp } from '../formats/ldp.js';
import { presentSdJwt, splitSdJwt } from '../formats/sdjwt.js';
import { presentMdoc, describeMdoc } from '../formats/mdoc.js';
import { b64urlJson, decodeJwt } from '../util/decode.js';
import { requestedSdClaims, type Format } from './presentation-definition.js';

/**
 * Playground Wallet — a headless holder that speaks OpenID4VCI (pre-authorized code, draft 13
 * request shape) and OpenID4VP (direct_post). Every HTTP exchange is traced to the run timeline.
 */

export type Tamper = 'none' | 'bad-signature' | 'wrong-type' | 'replay' | 'wrong-holder';

export const TAMPER_MODES: Record<Tamper, { label: string; description: string; formats: Format[] }> = {
  none: { label: 'None', description: 'Honest presentation', formats: ['ldp_vc', 'vc+sd-jwt', 'mso_mdoc'] },
  'bad-signature': { label: 'Bad signature', description: 'Alter a signed claim after issuance (forgery)', formats: ['ldp_vc', 'vc+sd-jwt'] },
  'wrong-type': { label: 'Wrong type', description: 'Rewrite the credential type / vct the verifier asked for', formats: ['ldp_vc', 'vc+sd-jwt'] },
  replay: { label: 'Replay (stale nonce)', description: 'Bind the presentation to an old nonce instead of the verifier’s', formats: ['ldp_vc', 'vc+sd-jwt', 'mso_mdoc'] },
  'wrong-holder': { label: 'Wrong holder', description: 'Sign the presentation with a key the credential is not bound to', formats: ['ldp_vc', 'vc+sd-jwt', 'mso_mdoc'] },
};

export interface StoredCredential {
  id: string;
  format: Format;
  configId: string;
  issuer: string;
  /** JSON-LD object for ldp_vc; compact string for SD-JWT; base64url mdoc. */
  credential: any;
  receivedAt: string;
  summary: Record<string, unknown>;
}

const walletFile = () => path.join(DATA_DIR, 'wallet.json');
let store: StoredCredential[] | undefined;

export function walletCredentials(): StoredCredential[] {
  if (!store) store = fs.existsSync(walletFile()) ? JSON.parse(fs.readFileSync(walletFile(), 'utf8')) : [];
  return store!;
}

function save(c: StoredCredential) {
  const all = walletCredentials();
  all.unshift(c);
  all.splice(50);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(walletFile(), JSON.stringify(all, null, 2));
}

export function summarize(format: Format, credential: any): Record<string, unknown> {
  try {
    if (format === 'ldp_vc') {
      return { type: credential.type, issuer: credential.issuer?.id ?? credential.issuer, expires: credential.expirationDate ?? credential.validUntil, subject: credential.credentialSubject, proof: credential.proof?.type };
    }
    if (format === 'vc+sd-jwt') {
      const { jwt, disclosures } = splitSdJwt(credential);
      const p = decodeJwt(jwt)!.payload;
      const claims = Object.fromEntries(disclosures.map((d) => { const [, k, v] = b64urlJson(d); return [k, v]; }));
      return { vct: p.vct, issuer: p.iss, expires: p.exp ? new Date(p.exp * 1000).toISOString() : undefined, alg: decodeJwt(jwt)!.header.alg, claims };
    }
    const [doc] = describeMdoc(credential);
    return { docType: doc?.docType, claims: doc?.claims, validityInfo: doc?.validityInfo };
  } catch (e: any) {
    return { error: `could not decode credential: ${e.message}` };
  }
}

const VCI_STEP = 'OpenID4VCI';

function parseOffer(uri: string): { offer?: any; offerUri?: string } {
  const q = uri.includes('?') ? uri.slice(uri.indexOf('?') + 1) : uri;
  const params = new URLSearchParams(q);
  if (params.get('credential_offer')) return { offer: JSON.parse(params.get('credential_offer')!) };
  if (params.get('credential_offer_uri')) return { offerUri: params.get('credential_offer_uri')! };
  throw new Error('Not a credential offer: expected credential_offer or credential_offer_uri');
}

export async function receiveCredential(runId: string, offerUri: string, opts: { txCode?: string } = {}): Promise<StoredCredential> {
  const H = { 'x-playground-run': runId };
  const ring = await keys();

  let { offer, offerUri: byRef } = parseOffer(offerUri);
  emit({ runId, step: `${VCI_STEP} · Credential offer`, kind: 'action', from: 'wallet', to: 'wallet', summary: byRef ? 'Wallet scanned offer (by reference)' : 'Wallet scanned offer (by value)', data: { offerUri, offer } });
  if (byRef) offer = (await traced({ runId, step: `${VCI_STEP} · Resolve credential_offer_uri`, from: 'wallet', to: 'issuer', url: byRef, headers: H })).body;

  const issuer: string = offer.credential_issuer.replace(/\/$/, '');
  const configId: string = offer.credential_configuration_ids?.[0] ?? offer.credentials?.[0];
  const grant = offer.grants?.['urn:ietf:params:oauth:grant-type:pre-authorized_code'];
  if (!grant) throw new Error('Offer has no pre-authorized_code grant (authorization_code flow needs an interactive login; not automated)');

  const meta = (await traced({ runId, step: `${VCI_STEP} · Issuer metadata`, from: 'wallet', to: 'issuer', url: `${issuer}/.well-known/openid-credential-issuer`, headers: H })).body;
  const cfg = meta.credential_configurations_supported?.[configId];
  if (!cfg) throw new Error(`Issuer metadata has no credential configuration "${configId}"`);
  const format: Format = cfg.format;

  const asBase = (meta.authorization_servers?.[0] ?? meta.authorization_server ?? issuer).replace(/\/$/, '');
  let tokenEndpoint: string | undefined = meta.token_endpoint;
  if (!tokenEndpoint) {
    const as = await traced({ runId, step: `${VCI_STEP} · Authorization server metadata`, from: 'wallet', to: 'issuer', url: `${asBase}/.well-known/oauth-authorization-server`, headers: H, allowError: true });
    tokenEndpoint = as.status < 400 ? as.body.token_endpoint : undefined;
    if (!tokenEndpoint) {
      const oidc = await traced({ runId, step: `${VCI_STEP} · Authorization server metadata (OIDC fallback)`, from: 'wallet', to: 'issuer', url: `${asBase}/.well-known/openid-configuration`, headers: H });
      tokenEndpoint = oidc.body.token_endpoint;
    }
  }

  const form = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:pre-authorized_code', 'pre-authorized_code': grant['pre-authorized_code'] });
  if (grant.tx_code || grant.user_pin_required) {
    if (!opts.txCode) throw new Error('Offer requires a tx_code (PIN) but none was supplied');
    form.set('tx_code', opts.txCode);
    form.set('user_pin', opts.txCode);
  }
  const token = (await traced({ runId, step: `${VCI_STEP} · Token request (pre-authorized_code)`, from: 'wallet', to: 'issuer', url: tokenEndpoint!, body: form, headers: H })).body;

  let cNonce: string | undefined = token.c_nonce;
  if (!cNonce && meta.nonce_endpoint) {
    cNonce = (await traced({ runId, step: `${VCI_STEP} · Nonce request`, from: 'wallet', to: 'issuer', url: meta.nonce_endpoint, body: {}, headers: H })).body.c_nonce;
  }

  // Holder key choice: JSON-LD credentials bind to the Ed25519 did:key that also signs the VP;
  // SD-JWT and mdoc bind to the P-256 key that signs the KB-JWT / DeviceAuth.
  const algs: string[] = cfg.proof_types_supported?.jwt?.proof_signing_alg_values_supported ?? ['ES256'];
  const edAlg = algs.includes('EdDSA') ? 'EdDSA' : algs.includes('Ed25519') ? 'Ed25519' : undefined;
  const useEd = format === 'ldp_vc' && edAlg !== undefined;
  const makeProof = async (nonce?: string) => {
    const payload = { aud: issuer, iat: Math.floor(Date.now() / 1000), ...(nonce ? { nonce } : {}) };
    if (useEd) return signEdJwt(ring.holderEd, { alg: edAlg, typ: 'openid4vci-proof+jwt', kid: ring.holderEd.verificationMethod }, payload);
    if (!algs.includes('ES256')) throw new Error(`Issuer accepts proof algs [${algs.join(', ')}]; wallet supports EdDSA/Ed25519 and ES256`);
    return signJwt(ring.holderEc, { typ: 'openid4vci-proof+jwt', kid: ring.holderEc.kid }, payload);
  };

  const requestBody = (proofJwt: string) => ({
    format,
    ...(format === 'ldp_vc' ? { credential_definition: { '@context': cfg.credential_definition?.['@context'], type: cfg.credential_definition?.type } } : {}),
    ...(format === 'vc+sd-jwt' ? { vct: cfg.vct } : {}),
    ...(format === 'mso_mdoc' ? { doctype: cfg.doctype } : {}),
    proof: { proof_type: 'jwt', jwt: proofJwt },
  });
  const auth = { ...H, authorization: `${token.token_type ?? 'Bearer'} ${token.access_token}` };
  const credentialEndpoint: string = meta.credential_endpoint;
  let res = await traced({ runId, step: `${VCI_STEP} · Credential request (proof of possession)`, from: 'wallet', to: 'issuer', url: credentialEndpoint, body: requestBody(await makeProof(cNonce)), headers: auth, allowError: true });
  if (res.status === 400 && res.body?.c_nonce && (res.body.error === 'invalid_proof' || res.body.error === 'use_dpop_nonce' || !cNonce)) {
    res = await traced({ runId, step: `${VCI_STEP} · Credential request (retry with fresh c_nonce)`, from: 'wallet', to: 'issuer', url: credentialEndpoint, body: requestBody(await makeProof(res.body.c_nonce)), headers: auth, allowError: true });
  }
  if (res.status >= 400) throw new Error(`Credential request failed (${res.status}): ${res.body?.error_description ?? res.body?.error ?? JSON.stringify(res.body)}`);
  const credential = res.body.credential ?? res.body.credentials?.[0]?.credential ?? res.body.credentials?.[0];
  if (!credential) throw new Error(res.body.transaction_id ? 'Issuer returned a deferred transaction_id (deferred issuance not supported)' : 'Credential response has no credential');

  const stored: StoredCredential = {
    id: randomUUID(), format, configId, issuer, credential,
    receivedAt: new Date().toISOString(), summary: summarize(format, credential),
  };
  save(stored);
  emit({ runId, step: `${VCI_STEP} · Credential stored`, kind: 'action', from: 'wallet', to: 'wallet', summary: `Wallet stored ${format} credential`, data: { credential, summary: stored.summary } });
  return stored;
}

/* ─────────────────────────── OpenID4VP ─────────────────────────── */

const VP_STEP = 'OpenID4VP';

async function resolveAuthorizationRequest(runId: string, uri: string) {
  const q = new URLSearchParams(uri.slice(uri.indexOf('?') + 1));
  const H = { 'x-playground-run': runId };
  let params: Record<string, any> = Object.fromEntries(q.entries());
  if (params.request_uri) {
    const r = await traced({ runId, step: `${VP_STEP} · Fetch request object (request_uri)`, from: 'wallet', to: 'verifier', url: params.request_uri, headers: { ...H, accept: 'application/oauth-authz-req+jwt, application/jwt, application/json' } });
    const body = r.body;
    params = typeof body === 'string' ? { ...params, ...decodeJwt(body.trim())?.payload } : { ...params, ...body };
  } else if (params.request) {
    params = { ...params, ...decodeJwt(params.request)?.payload };
  }
  for (const k of ['client_metadata', 'presentation_definition']) {
    if (typeof params[k] === 'string') params[k] = JSON.parse(params[k]);
  }
  if (!params.presentation_definition && params.presentation_definition_uri) {
    params.presentation_definition = (await traced({ runId, step: `${VP_STEP} · Fetch presentation_definition_uri`, from: 'wallet', to: 'verifier', url: params.presentation_definition_uri, headers: H })).body;
  }
  return params;
}

function tamperJwtPayload(jwt: string, mutate: (p: any) => void) {
  const [h, p, s] = jwt.split('.');
  const payload = b64urlJson(p);
  mutate(payload);
  return `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
}

function matchesDefinition(cred: StoredCredential, pd: any): { ok: boolean; reason: string } {
  const field = pd?.input_descriptors?.[0]?.constraints?.fields?.[0];
  const pattern = field?.filter?.pattern ?? field?.filter?.const;
  if (!pattern) return { ok: true, reason: 'no type constraint' };
  const re = new RegExp(pattern);
  const values: string[] = cred.format === 'ldp_vc' ? [].concat(cred.credential.type ?? []) : [String(cred.summary.vct ?? cred.summary.docType ?? '')];
  const ok = values.some((v) => re.test(v));
  return { ok, reason: `${field.path?.[0]} ${ok ? 'matches' : 'does not match'} /${pattern}/ (have ${values.join(', ')})` };
}

export async function presentCredential(runId: string, authorizationRequestUri: string, cred: StoredCredential, tamper: Tamper = 'none') {
  const ring = await keys();
  const req = await resolveAuthorizationRequest(runId, authorizationRequestUri);
  const pd = req.presentation_definition;
  const clientId: string = req.client_id;
  const responseUri: string = req.response_uri ?? req.redirect_uri;
  const nonce: string = tamper === 'replay' ? `stale-${randomBytes(8).toString('base64url')}` : req.nonce;
  const match = matchesDefinition(cred, pd);
  emit({
    runId, step: `${VP_STEP} · Authorization request`, kind: 'action', from: 'wallet', to: 'wallet',
    summary: `Wallet parsed request from ${clientId}; credential ${match.ok ? 'matches' : 'does NOT match'} the presentation definition`,
    data: { authorizationRequest: req, match, tamper },
  });
  if (!responseUri) throw new Error('Authorization request has no response_uri (only direct_post is supported)');
  if (req.response_mode && !['direct_post'].includes(req.response_mode)) throw new Error(`response_mode ${req.response_mode} is not supported by the playground wallet`);

  let vpToken: string;
  let descriptorFormat: string;
  let pathNested: any;
  const extra: Record<string, string> = {};
  if (cred.format === 'ldp_vc') {
    let vc = structuredClone(cred.credential);
    if (tamper === 'bad-signature') {
      const subj = vc.credentialSubject;
      const key = Object.keys(subj).find((k) => k !== 'id' && typeof subj[k] === 'string') ?? 'id';
      subj[key] = `${subj[key]} (forged)`;
    }
    if (tamper === 'wrong-type') vc.type = ['VerifiableCredential', 'ForgedCredential'];
    let holder: EdKey = ring.holderEd;
    if (tamper === 'wrong-holder') {
      const k = await Ed25519VerificationKey2020.generate();
      const exported = k.export({ publicKey: true, privateKey: true, includeContext: true });
      const did = `did:key:${k.fingerprint()}`;
      holder = { did, verificationMethod: `${did}#${k.fingerprint()}`, exported: { ...exported, id: `${did}#${k.fingerprint()}`, controller: did } };
    }
    const vp = await presentLdp(holder, [vc], nonce, clientId);
    vpToken = JSON.stringify(vp);
    descriptorFormat = 'ldp_vp';
    pathNested = { id: pd?.input_descriptors?.[0]?.id, format: 'ldp_vc', path: '$.verifiableCredential[0]' };
  } else if (cred.format === 'vc+sd-jwt') {
    let sd: string = cred.credential;
    if (tamper === 'bad-signature' || tamper === 'wrong-type') {
      const { jwt } = splitSdJwt(sd);
      const forged = tamperJwtPayload(jwt, (p) => {
        if (tamper === 'wrong-type') p.vct = 'urn:forged:OtherCredential';
        // Forgery: extend the validity period without re-signing.
        else p.exp = (p.exp ?? Math.floor(Date.now() / 1000)) + 10 * 365 * 86400;
      });
      sd = forged + sd.slice(jwt.length);
    }
    const disclose = requestedSdClaims(pd);
    const holderKey = tamper === 'wrong-holder' ? ring.attackerEc : ring.holderEc;
    const available = Object.keys((cred.summary.claims as Record<string, unknown>) ?? {});
    const chosen = disclose?.filter((d) => available.includes(d));
    vpToken = await presentSdJwt(sd, holderKey, { nonce, aud: clientId, disclose: chosen?.length ? chosen : undefined });
    descriptorFormat = 'vc+sd-jwt';
    emit({ runId, step: `${VP_STEP} · Selective disclosure`, kind: 'action', from: 'wallet', to: 'wallet', summary: chosen?.length ? `Disclosing only: ${chosen.join(', ')}` : 'Disclosing all claims', data: { requested: disclose, disclosed: chosen ?? available } });
  } else {
    const mdocGeneratedNonce = randomBytes(16).toString('base64url');
    extra.mdoc_generated_nonce = mdocGeneratedNonce;
    const holderKey = tamper === 'wrong-holder' ? ring.attackerEc : ring.holderEc;
    vpToken = await presentMdoc(cred.credential, holderKey, pd, { mdocGeneratedNonce, clientId, responseUri, nonce });
    descriptorFormat = 'mso_mdoc';
  }

  const submission = {
    id: randomUUID(),
    definition_id: pd?.id,
    descriptor_map: [{ id: pd?.input_descriptors?.[0]?.id, format: descriptorFormat, path: '$', ...(pathNested ? { path_nested: pathNested } : {}) }],
  };
  const form = new URLSearchParams({ vp_token: vpToken, presentation_submission: JSON.stringify(submission), state: req.state ?? '', ...extra });
  const res = await traced({
    runId, step: `${VP_STEP} · Authorization response (direct_post)`, from: 'wallet', to: 'verifier',
    url: responseUri, body: form, headers: { 'x-playground-run': runId }, allowError: true,
  });
  return { request: req, status: res.status, response: res.body, vpToken, submission };
}
