import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated key store for the run; config is read at import time, so set it first.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'inji-playground-test-'));

const { keys, signJwt, signEdJwt } = await import('../crypto/keys.js');
const { issueLdp, presentLdp, verifyLdpCredential, verifyLdpPresentation, PLAYGROUND_VOCAB_CONTEXT } = await import('../formats/ldp.js');
const { issueSdJwt, presentSdJwt, verifySdJwt, splitSdJwt } = await import('../formats/sdjwt.js');
const { issueMdoc, presentMdoc, verifyMdocPresentation } = await import('../formats/mdoc.js');
const { verifyKeyProof } = await import('../util/proof.js');
const { presentationDefinition, requestedSdClaims } = await import('../actors/presentation-definition.js');

const ring = await keys();
const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, 'Z');

async function ldpCredential(expired = false) {
  const now = Date.now();
  return issueLdp(ring.issuerEd, {
    '@context': ['https://www.w3.org/2018/credentials/v1', 'https://w3id.org/security/suites/ed25519-2020/v1', PLAYGROUND_VOCAB_CONTEXT],
    type: ['VerifiableCredential', 'PlaygroundIdentityCredential'],
    issuer: ring.issuerEd.did,
    issuanceDate: iso(new Date(expired ? now - 400 * 864e5 : now)),
    expirationDate: iso(new Date(expired ? now - 30 * 864e5 : now + 365 * 864e5)),
    credentialSubject: { id: ring.holderEd.did, fullName: 'Asha Rao' },
  });
}

test('ldp_vc: issue and verify; forged claim breaks the proof', async () => {
  const vc = await ldpCredential();
  assert.equal((await verifyLdpCredential(vc)).signatureValid, true);
  const forged = structuredClone(vc);
  forged.credentialSubject.fullName = 'Mallory';
  assert.equal((await verifyLdpCredential(forged)).signatureValid, false);
});

test('ldp_vc: expired credential keeps a valid signature but is flagged expired', async () => {
  const r = await verifyLdpCredential(await ldpCredential(true));
  assert.equal(r.signatureValid, true);
  assert.equal(r.expired, true);
});

test('ldp_vp: holder proof is bound to challenge and domain', async () => {
  const vp = await presentLdp(ring.holderEd, [await ldpCredential()], 'nonce-1', 'https://verifier.example');
  assert.equal((await verifyLdpPresentation(vp, 'nonce-1', 'https://verifier.example')).verified, true);
  const replay = await verifyLdpPresentation(vp, 'nonce-2', 'https://verifier.example');
  assert.equal(replay.verified, false);
  assert.equal(replay.holderProofValid, false);
});

test('SD-JWT VC: selective disclosure and key binding', async () => {
  const sd = await issueSdJwt(ring.issuerEc, {
    iss: 'https://issuer.example', vct: 'urn:test', disclosable: { fullName: 'Asha Rao', email: 'a@example.org' },
    holderJwk: ring.holderEc.publicJwk, exp: Math.floor(Date.now() / 1000) + 3600,
    header: { jwk: ring.issuerEc.publicJwk },
  });
  assert.equal(splitSdJwt(sd).disclosures.length, 2);
  const presented = await presentSdJwt(sd, ring.holderEc, { nonce: 'n', aud: 'v', disclose: ['fullName'] });
  const ok = await verifySdJwt(presented, { nonce: 'n', aud: 'v', requireKeyBinding: true });
  assert.deepEqual([ok.signatureValid, ok.disclosuresValid, ok.keyBindingValid], [true, true, true]);
  assert.equal(ok.claims.fullName, 'Asha Rao');
  assert.equal(ok.claims.email, undefined, 'undisclosed claim must stay hidden');

  const replay = await verifySdJwt(presented, { nonce: 'other', aud: 'v', requireKeyBinding: true });
  assert.equal(replay.keyBindingValid, false);
  const stolen = await presentSdJwt(sd, ring.attackerEc, { nonce: 'n', aud: 'v' });
  assert.equal((await verifySdJwt(stolen, { nonce: 'n', aud: 'v', requireKeyBinding: true })).keyBindingValid, false);
});

test('mso_mdoc: device response verifies against the session transcript', async () => {
  const cred = await issueMdoc({ holderJwk: ring.holderEc.publicJwk, issuedAt: new Date(), expiresAt: new Date(Date.now() + 864e5) });
  const pd = presentationDefinition({ format: 'mso_mdoc' });
  const t = { mdocGeneratedNonce: 'm', clientId: 'https://verifier.example/response', responseUri: 'https://verifier.example/response', nonce: 'n' };
  const ok = await verifyMdocPresentation(await presentMdoc(cred, ring.holderEc, pd, t), t);
  assert.deepEqual([ok.issuerAuthValid, ok.deviceAuthValid, ok.dataIntegrityValid], [true, true, true], ok.errors.join('; '));
  const replay = await verifyMdocPresentation(await presentMdoc(cred, ring.holderEc, pd, { ...t, nonce: 'stale' }), t);
  assert.equal(replay.deviceAuthValid, false);
});

test('OpenID4VCI key proof: typ, aud and nonce are enforced', async () => {
  const good = await signJwt(ring.holderEc, { typ: 'openid4vci-proof+jwt', kid: ring.holderEc.kid }, { aud: 'https://issuer', nonce: 'c', iat: Math.floor(Date.now() / 1000) });
  assert.equal((await verifyKeyProof(good, { aud: 'https://issuer', nonce: 'c' })).holderDid, ring.holderEc.did);
  await assert.rejects(verifyKeyProof(good, { aud: 'https://issuer', nonce: 'other' }), /nonce/);
  await assert.rejects(verifyKeyProof(good, { aud: 'https://elsewhere', nonce: 'c' }), /aud/);
  const ed = await signEdJwt(ring.holderEd, { typ: 'openid4vci-proof+jwt', kid: ring.holderEd.verificationMethod }, { aud: 'https://issuer', nonce: 'c' });
  assert.equal((await verifyKeyProof(ed, { aud: 'https://issuer', nonce: 'c' })).holderDid, ring.holderEd.did);
});

test('presentation definition: SD-JWT requests only the listed claims', () => {
  const pd = presentationDefinition({ format: 'vc+sd-jwt', vct: 'urn:x', claims: ['fullName', 'dateOfBirth'] });
  assert.deepEqual(requestedSdClaims(pd), ['fullName', 'dateOfBirth']);
});
