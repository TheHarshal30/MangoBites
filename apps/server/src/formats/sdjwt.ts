import { createHash, randomBytes } from 'node:crypto';
import * as jose from 'jose';
import { signJwt, type EcKey } from '../crypto/keys.js';
import { b64urlJson, decodeJwt } from '../util/decode.js';
import { didWebUrl } from './ldp.js';
import { jwkFromDid } from '../util/proof.js';

/** IETF SD-JWT VC (draft-ietf-oauth-sd-jwt-vc) with Key Binding JWT, ES256. */

const sha256b64 = (s: string) => createHash('sha256').update(s).digest('base64url');

export interface SdJwtIssueInput {
  iss: string;
  vct: string;
  /** Claims that are always visible. */
  plain?: Record<string, unknown>;
  /** Top-level claims made selectively disclosable. */
  disclosable: Record<string, unknown>;
  holderJwk: jose.JWK;
  iat?: number;
  exp?: number;
  typ?: string;
  /** Extra protected-header members, e.g. x5c. */
  header?: Record<string, unknown>;
}

export async function issueSdJwt(issuer: EcKey, input: SdJwtIssueInput) {
  const disclosures: string[] = [];
  const digests: string[] = [];
  for (const [name, value] of Object.entries(input.disclosable)) {
    const d = Buffer.from(JSON.stringify([randomBytes(16).toString('base64url'), name, value])).toString('base64url');
    disclosures.push(d);
    digests.push(sha256b64(d));
  }
  const now = input.iat ?? Math.floor(Date.now() / 1000);
  const { d: _d, ...holderPub } = input.holderJwk;
  const payload = {
    iss: input.iss, vct: input.vct, iat: now, nbf: now,
    ...(input.exp ? { exp: input.exp } : {}),
    ...(input.plain ?? {}),
    cnf: { jwk: holderPub },
    _sd: digests.sort(),
    _sd_alg: 'sha-256',
  };
  const jwt = await signJwt(issuer, { typ: input.typ ?? 'vc+sd-jwt', kid: issuer.kid, ...input.header }, payload);
  return `${jwt}~${disclosures.join('~')}~`;
}

export function splitSdJwt(sdjwt: string) {
  const parts = sdjwt.split('~');
  const hasKb = parts[parts.length - 1] !== '';
  return {
    jwt: parts[0],
    // The last segment is either the KB-JWT or the empty string after the trailing '~'.
    disclosures: parts.slice(1, -1).filter(Boolean),
    kbJwt: hasKb ? parts[parts.length - 1] : undefined,
  };
}

export function disclosureMap(sdjwt: string) {
  const { disclosures } = splitSdJwt(sdjwt);
  return disclosures.map((d) => {
    const [salt, name, value] = b64urlJson(d);
    return { encoded: d, salt, name, value };
  });
}

/** Builds a presentation: chosen disclosures + a Key Binding JWT over nonce/aud/sd_hash. */
export async function presentSdJwt(sdjwt: string, holder: EcKey, opts: { nonce: string; aud: string; disclose?: string[] }) {
  const { jwt } = splitSdJwt(sdjwt);
  const chosen = disclosureMap(sdjwt).filter((d) => !opts.disclose || opts.disclose.includes(d.name)).map((d) => d.encoded);
  const presented = `${jwt}~${chosen.map((d) => `${d}~`).join('')}`;
  const kb = await signJwt(holder, { typ: 'kb+jwt' }, {
    iat: Math.floor(Date.now() / 1000), aud: opts.aud, nonce: opts.nonce, sd_hash: sha256b64(presented),
  });
  return presented + kb;
}

/** Resolves the issuer's verification key from kid (did:jwk / did:web), x5c, or JWT VC Issuer Metadata. */
export async function resolveIssuerKey(header: any, payload: any): Promise<jose.CryptoKey | Uint8Array> {
  const alg = header.alg;
  if (header.jwk) return jose.importJWK(header.jwk, alg);
  if (Array.isArray(header.x5c) && header.x5c.length) {
    const pem = `-----BEGIN CERTIFICATE-----\n${header.x5c[0]}\n-----END CERTIFICATE-----`;
    return jose.importX509(pem, alg);
  }
  const kid: string | undefined = header.kid;
  const did = kid?.startsWith('did:') ? kid.split('#')[0] : typeof payload.iss === 'string' && payload.iss.startsWith('did:') ? payload.iss : undefined;
  if (did?.startsWith('did:jwk:')) return jose.importJWK(b64urlJson(did.slice(8)), alg);
  if (did?.startsWith('did:web:')) {
    const doc: any = await (await fetch(didWebUrl(did))).json();
    const vm = (doc.verificationMethod ?? []).find((m: any) => !kid || m.id === kid || kid.endsWith(m.id)) ?? doc.verificationMethod?.[0];
    if (!vm?.publicKeyJwk) throw new Error(`No publicKeyJwk for ${kid ?? did} in DID document`);
    return jose.importJWK(vm.publicKeyJwk, alg);
  }
  if (typeof payload.iss === 'string' && /^https?:\/\//.test(payload.iss)) {
    const iss = new URL(payload.iss);
    const metaUrl = `${iss.origin}/.well-known/jwt-vc-issuer${iss.pathname === '/' ? '' : iss.pathname}`;
    const meta: any = await (await fetch(metaUrl)).json();
    const jwks = meta.jwks ?? (meta.jwks_uri ? await (await fetch(meta.jwks_uri)).json() : undefined);
    const jwk = jwks?.keys?.find((k: any) => !kid || k.kid === kid) ?? jwks?.keys?.[0];
    if (!jwk) throw new Error(`No key found in JWT VC issuer metadata at ${metaUrl}`);
    return jose.importJWK(jwk, alg);
  }
  throw new Error('Cannot resolve SD-JWT issuer key (no jwk/x5c/did:jwk/did:web/https iss)');
}

export interface SdJwtCheck {
  signatureValid: boolean;
  disclosuresValid: boolean;
  keyBindingValid: boolean | null;
  expired: boolean;
  claims: Record<string, unknown>;
  errors: string[];
}

export async function verifySdJwt(sdjwt: string, opts: { nonce?: string; aud?: string; requireKeyBinding: boolean }): Promise<SdJwtCheck> {
  const errors: string[] = [];
  const { jwt, disclosures, kbJwt } = splitSdJwt(sdjwt);
  const decoded = decodeJwt(jwt);
  if (!decoded) return { signatureValid: false, disclosuresValid: false, keyBindingValid: false, expired: false, claims: {}, errors: ['Issuer-signed JWT is malformed'] };
  const { header, payload } = decoded;

  let signatureValid = false;
  try {
    const key = await resolveIssuerKey(header, payload);
    await jose.compactVerify(jwt, key);
    signatureValid = true;
  } catch (e: any) {
    errors.push(`Issuer signature: ${e.message}`);
  }

  const digests = new Set<string>(payload._sd ?? []);
  const claims: Record<string, unknown> = { ...payload };
  delete claims._sd; delete claims._sd_alg;
  let disclosuresValid = true;
  for (const d of disclosures) {
    if (!digests.has(sha256b64(d))) {
      disclosuresValid = false;
      errors.push('A disclosure does not match any digest in the issuer-signed JWT (tampered disclosure)');
      continue;
    }
    const [, name, value] = b64urlJson(d);
    claims[name] = value;
  }

  let keyBindingValid: boolean | null = null;
  if (kbJwt) {
    keyBindingValid = false;
    try {
      // cnf.jwk per SD-JWT VC; Inji Certify templates bind with cnf.kid = holder DID instead.
      const cnfJwk = payload.cnf?.jwk ?? (typeof payload.cnf?.kid === 'string' ? jwkFromDid(payload.cnf.kid) : undefined);
      if (!cnfJwk) throw new Error('credential has no cnf.jwk / cnf.kid to bind to');
      const { payload: kb, protectedHeader } = await jose.jwtVerify(kbJwt, await jose.importJWK(cnfJwk, decodeJwt(kbJwt)?.header.alg ?? 'ES256'));
      if (protectedHeader.typ !== 'kb+jwt') throw new Error(`typ must be kb+jwt, got ${protectedHeader.typ}`);
      const presented = sdjwt.slice(0, sdjwt.length - kbJwt.length);
      if (kb.sd_hash !== sha256b64(presented)) throw new Error('sd_hash does not match the presented SD-JWT');
      if (opts.nonce && kb.nonce !== opts.nonce) throw new Error(`nonce mismatch (expected ${opts.nonce}, got ${kb.nonce}) — possible replay`);
      if (opts.aud && kb.aud !== opts.aud) throw new Error(`aud mismatch (expected ${opts.aud}, got ${kb.aud})`);
      keyBindingValid = true;
    } catch (e: any) {
      errors.push(`Key binding: ${e.message.includes('signature verification failed') ? 'KB-JWT not signed by the key in cnf (holder mismatch)' : e.message}`);
    }
  } else if (opts.requireKeyBinding) {
    keyBindingValid = false;
    errors.push('Key Binding JWT missing');
  }

  const expired = typeof payload.exp === 'number' && payload.exp * 1000 < Date.now();
  return { signatureValid, disclosuresValid, keyBindingValid, expired, claims, errors };
}
