import { createRequire } from 'node:module';
import type * as jose from 'jose';
import { Document, MDoc, DeviceResponse, Verifier, DataItem, parse } from '@auth0/mdl';
import { keys, issuerCertificate, type EcKey } from '../crypto/keys.js';

const require = createRequire(import.meta.url);
const { cborEncode } = require('@auth0/mdl/lib/cbor') as { cborEncode: (x: unknown) => Buffer };

/** ISO/IEC 18013-5 mDL ("mso_mdoc"), mock data, with OID4VP device authentication (18013-7 Annex B). */

export const MDL_DOCTYPE = 'org.iso.18013.5.1.mDL';
export const MDL_NAMESPACE = 'org.iso.18013.5.1';

export async function issueMdoc(opts: { holderJwk: jose.JWK; issuedAt: Date; expiresAt: Date }) {
  const { issuerEc } = await keys();
  const cert = await issuerCertificate();
  const { d: _d, ...deviceKey } = opts.holderJwk;
  const doc = await new Document(MDL_DOCTYPE)
    .addIssuerNameSpace(MDL_NAMESPACE, {
      family_name: 'Rao', given_name: 'Asha', birth_date: '1994-03-12',
      issuing_country: 'IN', document_number: 'PG-DL-2026-0042',
      driving_privileges: [{ vehicle_category_code: 'B' }],
    })
    .useDigestAlgorithm('SHA-256')
    .addValidityInfo({ signed: opts.issuedAt, validFrom: opts.issuedAt, validUntil: opts.expiresAt })
    .addDeviceKeyInfo({ deviceKey: deviceKey as any })
    .sign({ issuerPrivateKey: issuerEc.privateJwk as any, issuerCertificate: cert.pem, alg: 'ES256' });
  return Buffer.from(new MDoc([doc]).encode()).toString('base64url');
}

export function sessionTranscript(mdocGeneratedNonce: string, clientId: string, responseUri: string, nonce: string) {
  return cborEncode(DataItem.fromData([null, null, [mdocGeneratedNonce, clientId, responseUri, nonce]]));
}

export async function presentMdoc(credentialB64: string, holder: EcKey, pd: any, t: { mdocGeneratedNonce: string; clientId: string; responseUri: string; nonce: string }) {
  const response = await DeviceResponse.from(Buffer.from(credentialB64, 'base64url'))
    .usingPresentationDefinition(pd)
    .usingSessionTranscriptForOID4VP(t.mdocGeneratedNonce, t.clientId, t.responseUri, t.nonce)
    .authenticateWithSignature(holder.privateJwk as any, 'ES256')
    .sign();
  return Buffer.from(response.encode()).toString('base64url');
}

export function describeMdoc(b64: string) {
  const mdoc = parse(Buffer.from(b64, 'base64url'));
  return mdoc.documents.map((d: any) => ({
    docType: d.docType,
    claims: d.getIssuerNameSpace(MDL_NAMESPACE),
    validityInfo: d.issuerSigned?.issuerAuth?.decodedPayload?.validityInfo,
  }));
}

export async function verifyMdocPresentation(b64: string, t: { mdocGeneratedNonce: string; clientId: string; responseUri: string; nonce: string }) {
  const cert = await issuerCertificate();
  const errors: string[] = [];
  const failed = new Set<string>();
  try {
    await new Verifier([cert.rootPem]).verify(Buffer.from(b64, 'base64url'), {
      encodedSessionTranscript: sessionTranscript(t.mdocGeneratedNonce, t.clientId, t.responseUri, t.nonce),
      onCheck: (check: any) => {
        if (check.status === 'FAILED') {
          failed.add(check.category);
          errors.push(`${check.category}: ${check.check}${check.reason ? ` (${check.reason})` : ''}`);
        }
      },
    });
  } catch (e: any) {
    if (!errors.length) errors.push(e.message);
  }
  const docs = (() => { try { return describeMdoc(b64); } catch { return []; } })();
  const until = docs[0]?.validityInfo?.validUntil;
  const expired = until ? new Date(until).getTime() < Date.now() : false;
  // The library reports an expired MSO as an ISSUER_AUTH failure; separate it so EXPIRED ≠ INVALID.
  const onlyExpiry = errors.length > 0 && errors.every((e) => /validity period of the certificate|valid at the time of verification|valid until|expired/i.test(e));
  return {
    issuerAuthValid: !failed.has('ISSUER_AUTH') || onlyExpiry,
    deviceAuthValid: !failed.has('DEVICE_AUTH'),
    dataIntegrityValid: !failed.has('DATA_INTEGRITY'),
    expired,
    claims: docs[0]?.claims ?? {},
    errors,
  };
}
