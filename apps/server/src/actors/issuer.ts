import express, { type Request, type Response, type NextFunction } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { PUBLIC_BASE_URL } from '../config.js';
import { correlate, emit, runIdFor } from '../events.js';
import { keys, issuerCertificate } from '../crypto/keys.js';
import { issueLdp, PLAYGROUND_VOCAB_CONTEXT } from '../formats/ldp.js';
import { issueSdJwt } from '../formats/sdjwt.js';
import { issueMdoc } from '../formats/mdoc.js';
import { verifyKeyProof } from '../util/proof.js';

/**
 * Playground Issuer — an independent OpenID4VCI (draft 13, pre-authorized code flow) issuer.
 * It is the "non-Inji" reference issuer in the matrix and the source of deliberately broken
 * credentials (already-expired) for negative-path tests.
 */

export const ISSUER_URL = `${PUBLIC_BASE_URL}/issuer`;
const PRE_AUTH_GRANT = 'urn:ietf:params:oauth:grant-type:pre-authorized_code';
export const PLAYGROUND_VCT = 'urn:inji-playground:PlaygroundIdentityCredential';

export const SUBJECT = {
  fullName: 'Asha Rao',
  dateOfBirth: '1994-03-12',
  nationality: 'IN',
  documentNumber: 'PG-4471-2026',
  email: 'asha.rao@example.org',
};

export const CREDENTIAL_CONFIGS: Record<string, any> = {
  PlaygroundIdentity_ldp_vc: {
    format: 'ldp_vc',
    scope: 'playground_identity_ldp',
    cryptographic_binding_methods_supported: ['did:key', 'did:jwk'],
    credential_signing_alg_values_supported: ['Ed25519Signature2020'],
    proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['EdDSA', 'ES256'] } },
    credential_definition: {
      '@context': ['https://www.w3.org/2018/credentials/v1', 'https://w3id.org/security/suites/ed25519-2020/v1'],
      type: ['VerifiableCredential', 'PlaygroundIdentityCredential'],
    },
    display: [{ name: 'Playground Identity (JSON-LD)', locale: 'en', background_color: '#12355b', text_color: '#ffffff' }],
  },
  PlaygroundIdentity_sd_jwt: {
    format: 'vc+sd-jwt',
    scope: 'playground_identity_sd_jwt',
    vct: PLAYGROUND_VCT,
    cryptographic_binding_methods_supported: ['jwk'],
    credential_signing_alg_values_supported: ['ES256'],
    proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256'] } },
    claims: Object.fromEntries(Object.keys(SUBJECT).map((k) => [k, { display: [{ name: k, locale: 'en' }] }])),
    display: [{ name: 'Playground Identity (SD-JWT)', locale: 'en', background_color: '#5b1d12', text_color: '#ffffff' }],
  },
  PlaygroundMDL_mso_mdoc: {
    format: 'mso_mdoc',
    scope: 'playground_mdl',
    doctype: 'org.iso.18013.5.1.mDL',
    cryptographic_binding_methods_supported: ['cose_key'],
    credential_signing_alg_values_supported: ['ES256'],
    proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256'] } },
    display: [{ name: 'Playground mDL (mock mdoc)', locale: 'en', background_color: '#1d5b12', text_color: '#ffffff' }],
  },
};

interface OfferState {
  runId: string;
  configId: string;
  txCode?: string;
  expired: boolean;
  offer: Record<string, unknown>;
}
interface TokenState { runId: string; configId: string; cNonce: string; expired: boolean }

const offers = new Map<string, OfferState>(); // by pre-authorized code
const offersById = new Map<string, OfferState>();
const tokens = new Map<string, TokenState>();

export function createPlaygroundOffer(runId: string, configId: string, opts: { txCode?: boolean; expired?: boolean } = {}) {
  if (!CREDENTIAL_CONFIGS[configId]) throw new Error(`Unknown credential configuration ${configId}`);
  const code = randomBytes(18).toString('base64url');
  const txCode = opts.txCode ? String(Math.floor(100000 + Math.random() * 900000)) : undefined;
  const offer = {
    credential_issuer: ISSUER_URL,
    credential_configuration_ids: [configId],
    grants: {
      [PRE_AUTH_GRANT]: {
        'pre-authorized_code': code,
        ...(txCode ? { tx_code: { input_mode: 'numeric', length: 6, description: 'PIN shown in the playground' } } : {}),
      },
    },
  };
  const state: OfferState = { runId, configId, txCode, expired: Boolean(opts.expired), offer };
  const offerId = randomUUID();
  offers.set(code, state);
  offersById.set(offerId, state);
  correlate(code, runId);
  return {
    offer,
    txCode,
    offerByValueUri: `openid-credential-offer://?credential_offer=${encodeURIComponent(JSON.stringify(offer))}`,
    offerByReferenceUri: `openid-credential-offer://?credential_offer_uri=${encodeURIComponent(`${ISSUER_URL}/offers/${offerId}`)}`,
  };
}

/** Log requests that come from wallets other than the playground's own (which traces its own calls). */
function logExternal(step: string, key: (req: Request) => string | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.header('x-playground-run')) return next();
    const runId = runIdFor(key(req));
    if (!runId) return next();
    const started = Date.now();
    const send = res.json.bind(res);
    res.json = (body: any) => {
      emit({
        runId, step, kind: 'http', from: 'wallet', to: 'issuer',
        summary: `${req.method} ${req.path} → ${res.statusCode} (external wallet)`,
        request: { method: req.method, url: `${ISSUER_URL}${req.path}`, body: req.body },
        response: { status: res.statusCode, body, durationMs: Date.now() - started },
      });
      return send(body);
    };
    next();
  };
}

const bearer = (req: Request) => req.header('authorization')?.replace(/^Bearer\s+/i, '');

export const issuerRouter = express.Router();
issuerRouter.use(express.json(), express.urlencoded({ extended: false }));

issuerRouter.get('/.well-known/openid-credential-issuer', (_req, res) => {
  res.json({
    credential_issuer: ISSUER_URL,
    authorization_servers: [ISSUER_URL],
    credential_endpoint: `${ISSUER_URL}/credential`,
    nonce_endpoint: `${ISSUER_URL}/nonce`,
    display: [{ name: 'Inji Interop Playground Issuer', locale: 'en' }],
    credential_configurations_supported: CREDENTIAL_CONFIGS,
  });
});

const asMetadata = (_req: Request, res: Response) => {
  res.json({
    issuer: ISSUER_URL,
    token_endpoint: `${ISSUER_URL}/token`,
    grant_types_supported: [PRE_AUTH_GRANT],
    'pre-authorized_grant_anonymous_access_supported': true,
    response_types_supported: ['token'],
  });
};
issuerRouter.get('/.well-known/oauth-authorization-server', asMetadata);
issuerRouter.get('/.well-known/openid-configuration', asMetadata);

/** JWT VC Issuer Metadata so SD-JWT verifiers that resolve keys via `iss` can find ours. */
issuerRouter.get('/.well-known/jwt-vc-issuer', async (_req, res) => {
  const { issuerEc } = await keys();
  res.json({ issuer: ISSUER_URL, jwks: { keys: [{ ...issuerEc.publicJwk, kid: issuerEc.kid, use: 'sig', alg: 'ES256' }] } });
});

issuerRouter.get('/offers/:id', logExternal('OpenID4VCI · Credential offer (by reference)', (req) => {
  const s = offersById.get(String(req.params.id));
  return s ? String((s.offer.grants as any)[PRE_AUTH_GRANT]['pre-authorized_code']) : undefined;
}), (req, res) => {
  const s = offersById.get(String(req.params.id));
  if (!s) return void res.status(404).json({ error: 'not_found' });
  res.json(s.offer);
});

issuerRouter.post('/token', logExternal('OpenID4VCI · Token request', (req) => req.body?.['pre-authorized_code']), (req, res) => {
  const { grant_type, tx_code } = req.body ?? {};
  const code = req.body?.['pre-authorized_code'];
  if (grant_type !== PRE_AUTH_GRANT) return void res.status(400).json({ error: 'unsupported_grant_type' });
  const offer = offers.get(code);
  if (!offer) return void res.status(400).json({ error: 'invalid_grant', error_description: 'unknown or already used pre-authorized_code' });
  if (offer.txCode && tx_code !== offer.txCode) return void res.status(400).json({ error: 'invalid_grant', error_description: 'tx_code mismatch' });
  offers.delete(code); // single use
  const accessToken = randomBytes(24).toString('base64url');
  const cNonce = randomBytes(16).toString('base64url');
  tokens.set(accessToken, { runId: offer.runId, configId: offer.configId, cNonce, expired: offer.expired });
  correlate(accessToken, offer.runId);
  res.json({
    access_token: accessToken, token_type: 'Bearer', expires_in: 600,
    c_nonce: cNonce, c_nonce_expires_in: 300,
    authorization_details: [{ type: 'openid_credential', credential_configuration_id: offer.configId }],
  });
});

issuerRouter.post('/nonce', (req, res) => {
  const t = tokens.get(bearer(req) ?? '');
  const cNonce = randomBytes(16).toString('base64url');
  if (t) t.cNonce = cNonce;
  res.json({ c_nonce: cNonce });
});

issuerRouter.post('/credential', logExternal('OpenID4VCI · Credential request', bearer), async (req, res) => {
  const t = tokens.get(bearer(req) ?? '');
  if (!t) return void res.status(401).json({ error: 'invalid_token' });
  const cfg = CREDENTIAL_CONFIGS[t.configId];
  const body = req.body ?? {};
  const requestedFormat = body.format ?? (body.credential_configuration_id ? CREDENTIAL_CONFIGS[body.credential_configuration_id]?.format : cfg.format);
  if (requestedFormat !== cfg.format) {
    return void res.status(400).json({ error: 'unsupported_credential_format', error_description: `token is for ${cfg.format}, request asked for ${requestedFormat}` });
  }
  const proofJwt = body.proof?.jwt ?? body.proofs?.jwt?.[0];
  if (!proofJwt) return void res.status(400).json({ error: 'invalid_proof', error_description: 'proof.jwt required' });
  let holder;
  try {
    holder = await verifyKeyProof(proofJwt, { aud: ISSUER_URL, nonce: t.cNonce });
  } catch (e: any) {
    const cNonce = randomBytes(16).toString('base64url');
    t.cNonce = cNonce;
    return void res.status(400).json({ error: 'invalid_proof', error_description: e.message, c_nonce: cNonce, c_nonce_expires_in: 300 });
  }

  const ring = await keys();
  const issuedAt = t.expired ? new Date(Date.now() - 400 * 86_400_000) : new Date();
  const expiresAt = t.expired ? new Date(Date.now() - 35 * 86_400_000) : new Date(Date.now() + 365 * 86_400_000);
  try {
    let credential: unknown;
    if (cfg.format === 'ldp_vc') {
      credential = await issueLdp(ring.issuerEd, {
        '@context': [...cfg.credential_definition['@context'], PLAYGROUND_VOCAB_CONTEXT],
        id: `urn:uuid:${randomUUID()}`,
        type: cfg.credential_definition.type,
        issuer: ring.issuerEd.did,
        issuanceDate: issuedAt.toISOString().replace(/\.\d+Z$/, 'Z'),
        expirationDate: expiresAt.toISOString().replace(/\.\d+Z$/, 'Z'),
        credentialSubject: { id: holder.holderDid, ...SUBJECT },
      });
    } else if (cfg.format === 'vc+sd-jwt') {
      const cert = await issuerCertificate();
      credential = await issueSdJwt(ring.issuerEc, {
        iss: ISSUER_URL, vct: PLAYGROUND_VCT,
        disclosable: SUBJECT,
        holderJwk: holder.holderJwk,
        iat: Math.floor(issuedAt.getTime() / 1000),
        exp: Math.floor(expiresAt.getTime() / 1000),
        header: { x5c: [cert.derB64, cert.rootDerB64] },
      });
    } else {
      credential = await issueMdoc({ holderJwk: holder.holderJwk, issuedAt, expiresAt });
    }
    const cNonce = randomBytes(16).toString('base64url');
    t.cNonce = cNonce;
    res.json({ credential, format: cfg.format, c_nonce: cNonce, c_nonce_expires_in: 300 });
  } catch (e: any) {
    res.status(500).json({ error: 'server_error', error_description: e.message });
  }
});
