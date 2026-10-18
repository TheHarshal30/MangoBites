import fs from 'node:fs';
import path from 'node:path';
import * as jose from 'jose';
import * as x509 from '@peculiar/x509';
import * as base58 from 'base58-universal';
import { Ed25519VerificationKey2020 } from '@digitalbazaar/ed25519-verification-key-2020';
import { DATA_DIR } from '../config.js';

/**
 * Long-lived key material for the playground's own actors. Persisted under data/ so DIDs stay
 * stable across restarts (credentials issued yesterday must still verify today).
 */

export interface EdKey {
  did: string;
  verificationMethod: string;
  /** Serialized Ed25519VerificationKey2020 incl. private key. */
  exported: any;
}

export interface EcKey {
  /** did:jwk of the public key; kid is `${did}#0`. */
  did: string;
  kid: string;
  publicJwk: jose.JWK;
  privateJwk: jose.JWK;
}

interface KeyFile {
  issuerEd: any;
  issuerEc: jose.JWK;
  holderEd: any;
  holderEc: jose.JWK;
  attackerEc: jose.JWK;
  verifierEc: jose.JWK;
}

async function newEd() {
  const k = await Ed25519VerificationKey2020.generate();
  return k.export({ publicKey: true, privateKey: true, includeContext: true });
}

async function newEc() {
  const { privateKey } = await jose.generateKeyPair('ES256', { extractable: true });
  return jose.exportJWK(privateKey);
}

async function loadEd(exported: any): Promise<EdKey> {
  const key = await Ed25519VerificationKey2020.from(exported);
  const did = `did:key:${key.fingerprint()}`;
  const verificationMethod = `${did}#${key.fingerprint()}`;
  return { did, verificationMethod, exported: { ...exported, id: verificationMethod, controller: did } };
}

export function didJwk(publicJwk: jose.JWK) {
  const { kty, crv, x, y } = publicJwk;
  const minimal = y ? { crv, kty, x, y } : { crv, kty, x };
  return `did:jwk:${Buffer.from(JSON.stringify(minimal)).toString('base64url')}`;
}

function loadEc(privateJwk: jose.JWK): EcKey {
  const { d: _d, ...publicJwk } = privateJwk;
  const did = didJwk(publicJwk);
  return { did, kid: `${did}#0`, publicJwk, privateJwk };
}

export interface KeyRing {
  issuerEd: EdKey;
  issuerEc: EcKey;
  holderEd: EdKey;
  holderEc: EcKey;
  /** A key the holder does NOT control, used by the "wrong holder" tamper mode. */
  attackerEc: EcKey;
  /** Signs OpenID4VP request objects of the playground verifier. */
  verifierEc: EcKey;
}

let ring: KeyRing | undefined;

export async function keys(): Promise<KeyRing> {
  if (ring) return ring;
  const file = path.join(DATA_DIR, 'keys.json');
  let raw: KeyFile;
  if (fs.existsSync(file)) {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    raw = {
      issuerEd: await newEd(), issuerEc: await newEc(),
      holderEd: await newEd(), holderEc: await newEc(),
      attackerEc: await newEc(), verifierEc: await newEc(),
    };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(raw, null, 2));
  }
  ring = {
    issuerEd: await loadEd(raw.issuerEd),
    issuerEc: loadEc(raw.issuerEc),
    holderEd: await loadEd(raw.holderEd),
    holderEc: loadEc(raw.holderEc),
    attackerEc: loadEc(raw.attackerEc),
    verifierEc: loadEc(raw.verifierEc),
  };
  return ring;
}

export async function signJwt(key: EcKey, header: Record<string, unknown>, payload: Record<string, unknown>) {
  const pk = await jose.importJWK(key.privateJwk, 'ES256');
  return new jose.CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: 'ES256', ...header })
    .sign(pk);
}

/** Raw 32-byte Ed25519 public key as an OKP JWK (multibase 'z' + base58btc(0xed01 ‖ key)). */
export function edPublicJwk(key: EdKey): jose.JWK {
  const bytes = base58.decode(key.exported.publicKeyMultibase.slice(1));
  return { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(bytes.slice(2)).toString('base64url') };
}

/** EdDSA JWS made with the same Ed25519 key that signs JSON-LD proofs, so one DID covers both. */
export async function signEdJwt(key: EdKey, header: Record<string, unknown>, payload: Record<string, unknown>) {
  const k = await Ed25519VerificationKey2020.from(key.exported);
  const h = Buffer.from(JSON.stringify({ alg: 'EdDSA', ...header })).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = await k.signer().sign({ data: new TextEncoder().encode(`${h}.${p}`) });
  return `${h}.${p}.${Buffer.from(sig).toString('base64url')}`;
}

/**
 * Self-signed X.509 certificate for the issuer's ES256 key. Inji Verify's SD-JWT verifier only
 * resolves issuer keys from the x5c header, and mso_mdoc requires an issuer certificate anyway.
 */
export async function issuerCertificate(): Promise<{ pem: string; derB64: string; rootPem: string; rootDerB64: string }> {
  const file = path.join(DATA_DIR, 'issuer-certs.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));

  // ISO 18013-5 style two-level PKI: a self-signed IACA root (trust anchor) and a
  // document-signer certificate for the issuer key. Verifiers trust the root only.
  const { issuerEc } = await keys();
  x509.cryptoProvider.set(globalThis.crypto);
  const alg = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
  const rootKeys = (await crypto.subtle.generateKey(alg, true, ['sign', 'verify'])) as CryptoKeyPair;
  const now = Date.now();
  const root = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=Inji Interop Playground IACA, C=IN',
    notBefore: new Date(now - 86_400_000),
    notAfter: new Date(now + 10 * 365 * 86_400_000),
    keys: rootKeys,
    signingAlgorithm: alg,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      await x509.SubjectKeyIdentifierExtension.create(rootKeys.publicKey),
    ],
  });
  const publicKey = await crypto.subtle.importKey('jwk', issuerEc.publicJwk as JsonWebKey, alg, true, ['verify']);
  const ds = await x509.X509CertificateGenerator.create({
    serialNumber: '02',
    subject: 'CN=Inji Interop Playground Issuer, C=IN',
    issuer: root.subject,
    notBefore: new Date(now - 86_400_000),
    notAfter: new Date(now + 5 * 365 * 86_400_000),
    publicKey,
    signingKey: rootKeys.privateKey,
    signingAlgorithm: alg,
    extensions: [
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      await x509.AuthorityKeyIdentifierExtension.create(rootKeys.publicKey),
      await x509.SubjectKeyIdentifierExtension.create(publicKey),
    ],
  });
  const out = { pem: ds.toString('pem'), derB64: ds.toString('base64'), rootPem: root.toString('pem'), rootDerB64: root.toString('base64') };
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  return out;
}
