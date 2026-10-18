import * as jose from 'jose';
import * as base58 from 'base58-universal';
import { decodeJwt, b64urlJson } from './decode.js';
import { didJwk } from '../crypto/keys.js';

/** Public JWK for a did:jwk or Ed25519 did:key reference. */
export function jwkFromDid(didUrl: string): jose.JWK {
  const did = didUrl.split('#')[0];
  if (did.startsWith('did:jwk:')) return b64urlJson(did.slice(8));
  if (did.startsWith('did:key:z6Mk')) {
    const bytes = base58.decode(did.slice('did:key:z'.length));
    return { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(bytes.slice(2)).toString('base64url') };
  }
  throw new Error(`Unsupported holder key reference ${didUrl} (expected did:jwk or Ed25519 did:key)`);
}

/**
 * Validates an OpenID4VCI key proof (proof_type "jwt") and returns the holder key it binds to.
 * Checks typ, signature, aud and nonce as required by OpenID4VCI §7.2.
 */
export async function verifyKeyProof(proofJwt: string, opts: { aud: string; nonce: string }) {
  const decoded = decodeJwt(proofJwt);
  if (!decoded) throw new Error('proof.jwt is not a compact JWS');
  const { header } = decoded;
  if (header.typ !== 'openid4vci-proof+jwt') throw new Error(`proof typ must be openid4vci-proof+jwt (got ${header.typ})`);
  const holderJwk: jose.JWK = header.jwk ?? (header.kid ? jwkFromDid(header.kid) : undefined);
  if (!holderJwk) throw new Error('proof header carries neither jwk nor kid');
  const { payload } = await jose.jwtVerify(proofJwt, await jose.importJWK(holderJwk, header.alg));
  const audOk = Array.isArray(payload.aud) ? payload.aud.includes(opts.aud) : payload.aud === opts.aud;
  if (!audOk) throw new Error(`proof aud ${JSON.stringify(payload.aud)} does not match credential issuer ${opts.aud}`);
  if (payload.nonce !== opts.nonce) throw new Error('proof nonce does not match the c_nonce issued by this issuer');
  const holderDid = header.kid?.startsWith('did:') ? header.kid.split('#')[0] : didJwk(holderJwk);
  return { holderJwk, holderDid, alg: header.alg as string };
}
