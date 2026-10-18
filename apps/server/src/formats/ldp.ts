import { createRequire } from 'node:module';
import * as vc from '@digitalbazaar/vc';
import { Ed25519Signature2020 } from '@digitalbazaar/ed25519-signature-2020';
import { Ed25519VerificationKey2020 } from '@digitalbazaar/ed25519-verification-key-2020';
import type { EdKey } from '../crypto/keys.js';

const require = createRequire(import.meta.url);

/** W3C VC Data Model 1.1 + Ed25519Signature2020 (JSON-LD, "ldp_vc"). */

const STATIC_CONTEXTS = new Map<string, unknown>();
for (const pkg of ['@digitalbazaar/credentials-context', 'ed25519-signature-2020-context', '@digitalbazaar/security-context']) {
  for (const [url, doc] of require(pkg).contexts as Map<string, unknown>) STATIC_CONTEXTS.set(url, doc);
}
STATIC_CONTEXTS.set('https://www.w3.org/ns/did/v1', {
  '@context': { '@protected': true, id: '@id', type: '@type', alsoKnownAs: { '@id': 'https://www.w3.org/ns/activitystreams#alsoKnownAs', '@type': '@id' }, assertionMethod: { '@id': 'https://w3id.org/security#assertionMethod', '@type': '@id', '@container': '@set' }, authentication: { '@id': 'https://w3id.org/security#authenticationMethod', '@type': '@id', '@container': '@set' }, controller: { '@id': 'https://w3id.org/security#controller', '@type': '@id' }, verificationMethod: { '@id': 'https://w3id.org/security#verificationMethod', '@type': '@id' }, service: { '@id': 'https://www.w3.org/ns/did#service', '@type': '@id' } },
});

// W3C-hosted "@vocab"-only context used by the Inji Certify credential template.
STATIC_CONTEXTS.set('https://www.w3.org/ns/credentials/examples/v2', { '@context': { '@vocab': 'https://www.w3.org/ns/credentials/examples#' } });

/**
 * Vocabulary for the playground's demo credential. Embedded inline so no verifier (including
 * Inji Verify inside Docker) needs network access to a context we host.
 */
export const PLAYGROUND_VOCAB_CONTEXT = {
  '@vocab': 'https://w3id.org/inji-playground/vocab#',
};

const remoteCache = new Map<string, unknown>();

/**
 * did:key resolution. The spec'd fragment is the key fingerprint, but Inji Certify appends its
 * own key id (did:key:z6Mk…#<keymanager-kid>); we accept any fragment for the same key and
 * record it so the inspector can flag the deviation.
 */
export const didKeyFragmentDeviations = new Set<string>();

function didKeyDocument(did: string, fragment?: string) {
  const fingerprint = did.slice('did:key:'.length);
  const key = Ed25519VerificationKey2020.fromFingerprint({ fingerprint });
  const ids = [...new Set([`${did}#${fingerprint}`, ...(fragment ? [`${did}#${fragment}`] : [])])];
  if (fragment && fragment !== fingerprint) didKeyFragmentDeviations.add(`${did}#${fragment}`);
  const vms = ids.map((id) => ({ id, type: 'Ed25519VerificationKey2020', controller: did, publicKeyMultibase: key.publicKeyMultibase }));
  return {
    doc: {
      '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/ed25519-2020/v1'],
      id: did, verificationMethod: vms, assertionMethod: ids, authentication: ids,
    },
    vm: vms[vms.length - 1],
  };
}

export function didWebUrl(did: string) {
  const [host, ...segments] = did.slice('did:web:'.length).split(':').map(decodeURIComponent);
  const scheme = /^(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?$/.test(host) ? 'http' : 'https';
  return segments.length ? `${scheme}://${host}/${segments.join('/')}/did.json` : `${scheme}://${host}/.well-known/did.json`;
}

async function fetchJson(url: string) {
  if (remoteCache.has(url)) return remoteCache.get(url);
  const res = await fetch(url, { headers: { accept: 'application/ld+json, application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Could not load ${url}: HTTP ${res.status}`);
  const json = await res.json();
  remoteCache.set(url, json);
  return json;
}

/** Resolves contexts, did:key, did:web and plain HTTPS documents (with a cache). */
export async function documentLoader(url: string) {
  const ok = (document: unknown) => ({ contextUrl: null, documentUrl: url, document });
  if (STATIC_CONTEXTS.has(url)) return ok(STATIC_CONTEXTS.get(url));
  const [base, fragment] = url.split('#');
  if (base.startsWith('did:key:')) {
    const { doc, vm } = didKeyDocument(base, fragment);
    return ok(fragment ? { '@context': 'https://w3id.org/security/suites/ed25519-2020/v1', ...vm } : doc);
  }
  if (base.startsWith('did:web:')) {
    const doc: any = await fetchJson(didWebUrl(base));
    if (!fragment) return ok(doc);
    const vm = (doc.verificationMethod ?? []).find((m: any) => m.id === url || m.id === `#${fragment}`);
    if (!vm) throw new Error(`Verification method ${url} not found in DID document`);
    return ok({ '@context': doc['@context'], ...vm, id: url });
  }
  if (/^https?:\/\//.test(url)) return ok(await fetchJson(url));
  throw new Error(`documentLoader: unsupported URL ${url}`);
}

export async function issueLdp(issuer: EdKey, credential: Record<string, unknown>) {
  const key = await Ed25519VerificationKey2020.from(issuer.exported);
  const suite = new Ed25519Signature2020({ key });
  return vc.issue({ credential, suite, documentLoader });
}

export async function presentLdp(holder: EdKey, credentials: unknown[], challenge: string, domain: string) {
  const key = await Ed25519VerificationKey2020.from(holder.exported);
  const presentation = vc.createPresentation({ verifiableCredential: credentials, holder: holder.did });
  return vc.signPresentation({ presentation, suite: new Ed25519Signature2020({ key }), challenge, domain, documentLoader });
}

export interface LdpCheck {
  signatureValid: boolean;
  expired: boolean;
  errors: string[];
}

function issuanceInstant(c: any): Date {
  return new Date(c.issuanceDate ?? c.validFrom ?? Date.now());
}

function isExpired(c: any) {
  const end = c.expirationDate ?? c.validUntil;
  return Boolean(end && new Date(end).getTime() < Date.now());
}

function flattenErrors(result: any): string[] {
  const errs: string[] = [];
  const walk = (r: any) => {
    if (!r) return;
    if (r.error) {
      const e = r.error;
      for (const x of e.errors ?? [e]) errs.push(x.message ?? String(x));
    }
    for (const x of r.results ?? []) if (!x.verified && x.error) errs.push(...(x.error.errors ?? [x.error]).map((y: any) => y.message ?? String(y)));
    for (const x of r.credentialResults ?? []) if (!x.verified) walk(x);
    if (r.presentationResult && !r.presentationResult.verified) walk(r.presentationResult);
  };
  walk(result);
  return [...new Set(errs)];
}

/**
 * Verifies a credential's proof independently of its validity period, so the caller can tell
 * "signature broken" (INVALID) apart from "authentic but past expirationDate" (EXPIRED).
 */
export async function verifyLdpCredential(credential: any): Promise<LdpCheck> {
  const result = await vc.verifyCredential({
    credential, suite: new Ed25519Signature2020(), documentLoader, now: issuanceInstant(credential), checkStatus: async () => ({ verified: true }),
  });
  return { signatureValid: result.verified, expired: isExpired(credential), errors: result.verified ? [] : flattenErrors(result) };
}

export async function verifyLdpPresentation(presentation: any, challenge: string, domain: string) {
  const first = [].concat(presentation.verifiableCredential ?? [])[0];
  const result = await vc.verify({
    presentation, challenge, domain, suite: new Ed25519Signature2020(), documentLoader,
    now: first ? issuanceInstant(first) : new Date(), checkStatus: async () => ({ verified: true }),
  });
  return {
    verified: result.verified,
    holderProofValid: Boolean(result.presentationResult?.verified),
    credentialsValid: (result.credentialResults ?? []).every((r: any) => r.verified),
    expired: [].concat(presentation.verifiableCredential ?? []).some(isExpired),
    errors: result.verified ? [] : flattenErrors(result),
  };
}
