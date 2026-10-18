# Inji Interoperability Report

Generated 2026-10-18T00:42:15.017Z · 65 runs · **59 pass / 6 fail**

A run **passes** when the verifier reaches the verdict the scenario calls for: `VALID` for the happy path, `EXPIRED` for an expired credential, `INVALID` for every tamper mode. A verifier that accepts a forged or replayed presentation therefore *fails* that row.

## Compatibility matrix (happy path)

| Issuer → Verifier | Format | Inji Verify · OpenID4VP | Inji Verify · VC upload | Reference Verifier |
|---|---|:-:|:-:|:-:|
| Inji Certify | JSON-LD | ✅ | ✅ | ✅ |
| Inji Certify | SD-JWT | ✅ | ✅ | ✅ |
| Reference Issuer | JSON-LD | ✅ | ✅ | ✅ |
| Reference Issuer | SD-JWT | ✅ | ✅ | ✅ |
| Reference Issuer | mDoc | — | — | ✅ |

## All runs

| Issuer | Wallet | Verifier | Format | Proof | Scenario | Expected | Actual | Result | Detail |
|---|---|---|---|---|---|---|---|---|---|
| Inji Certify | Reference Wallet | Inji Verify · OpenID4VP | JSON-LD | Ed25519Signature2020 | Happy path | VALID | VALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Inji Verify · OpenID4VP | JSON-LD | Ed25519Signature2020 | Bad signature | INVALID | INVALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Inji Verify · OpenID4VP | JSON-LD | Ed25519Signature2020 | Wrong type | INVALID | INVALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Inji Verify · OpenID4VP | JSON-LD | Ed25519Signature2020 | Replay (stale nonce) | INVALID | VALID | ❌ FAIL | Verifier said VALID, scenario expects INVALID |
| Inji Certify | Reference Wallet | Inji Verify · OpenID4VP | JSON-LD | Ed25519Signature2020 | Wrong holder | INVALID | VALID | ❌ FAIL | Verifier said VALID, scenario expects INVALID |
| Inji Certify | Reference Wallet | Inji Verify · OpenID4VP | SD-JWT | JWS ES256 | Happy path | VALID | VALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Inji Verify · OpenID4VP | SD-JWT | JWS ES256 | Expired credential | EXPIRED | EXPIRED | ✅ PASS |  |
| Inji Certify | Reference Wallet | Inji Verify · OpenID4VP | SD-JWT | JWS ES256 | Bad signature | INVALID | INVALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Inji Verify · OpenID4VP | SD-JWT | JWS ES256 | Wrong type | INVALID | INVALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Inji Verify · OpenID4VP | SD-JWT | JWS ES256 | Replay (stale nonce) | INVALID | VALID | ❌ FAIL | Verifier said VALID, scenario expects INVALID |
| Inji Certify | Reference Wallet | Inji Verify · OpenID4VP | SD-JWT | JWS ES256 | Wrong holder | INVALID | INVALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Inji Verify · VC upload | JSON-LD | Ed25519Signature2020 | Happy path | VALID | VALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Inji Verify · VC upload | JSON-LD | Ed25519Signature2020 | Bad signature | INVALID | INVALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Inji Verify · VC upload | JSON-LD | Ed25519Signature2020 | Wrong type | INVALID | INVALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Inji Verify · VC upload | SD-JWT | JWS ES256 | Happy path | VALID | VALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Inji Verify · VC upload | SD-JWT | JWS ES256 | Expired credential | EXPIRED | EXPIRED | ✅ PASS |  |
| Inji Certify | Reference Wallet | Inji Verify · VC upload | SD-JWT | JWS ES256 | Bad signature | INVALID | INVALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Inji Verify · VC upload | SD-JWT | JWS ES256 | Wrong type | INVALID | INVALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Reference Verifier | JSON-LD | Ed25519Signature2020 | Happy path | VALID | VALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Reference Verifier | JSON-LD | Ed25519Signature2020 | Bad signature | INVALID | INVALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Reference Verifier | JSON-LD | Ed25519Signature2020 | Wrong type | INVALID | INVALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Reference Verifier | JSON-LD | Ed25519Signature2020 | Replay (stale nonce) | INVALID | INVALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Reference Verifier | JSON-LD | Ed25519Signature2020 | Wrong holder | INVALID | INVALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Reference Verifier | SD-JWT | JWS ES256 | Happy path | VALID | VALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Reference Verifier | SD-JWT | JWS ES256 | Expired credential | EXPIRED | EXPIRED | ✅ PASS |  |
| Inji Certify | Reference Wallet | Reference Verifier | SD-JWT | JWS ES256 | Bad signature | INVALID | INVALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Reference Verifier | SD-JWT | JWS ES256 | Wrong type | INVALID | INVALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Reference Verifier | SD-JWT | JWS ES256 | Replay (stale nonce) | INVALID | INVALID | ✅ PASS |  |
| Inji Certify | Reference Wallet | Reference Verifier | SD-JWT | JWS ES256 | Wrong holder | INVALID | INVALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Inji Verify · OpenID4VP | JSON-LD | Ed25519Signature2020 | Happy path | VALID | VALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Inji Verify · OpenID4VP | JSON-LD | Ed25519Signature2020 | Expired credential | EXPIRED | EXPIRED | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Inji Verify · OpenID4VP | JSON-LD | Ed25519Signature2020 | Bad signature | INVALID | INVALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Inji Verify · OpenID4VP | JSON-LD | Ed25519Signature2020 | Wrong type | INVALID | INVALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Inji Verify · OpenID4VP | JSON-LD | Ed25519Signature2020 | Replay (stale nonce) | INVALID | VALID | ❌ FAIL | Verifier said VALID, scenario expects INVALID |
| Reference Issuer | Reference Wallet | Inji Verify · OpenID4VP | JSON-LD | Ed25519Signature2020 | Wrong holder | INVALID | VALID | ❌ FAIL | Verifier said VALID, scenario expects INVALID |
| Reference Issuer | Reference Wallet | Inji Verify · OpenID4VP | SD-JWT | JWS ES256 | Happy path | VALID | VALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Inji Verify · OpenID4VP | SD-JWT | JWS ES256 | Expired credential | EXPIRED | EXPIRED | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Inji Verify · OpenID4VP | SD-JWT | JWS ES256 | Bad signature | INVALID | INVALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Inji Verify · OpenID4VP | SD-JWT | JWS ES256 | Wrong type | INVALID | INVALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Inji Verify · OpenID4VP | SD-JWT | JWS ES256 | Replay (stale nonce) | INVALID | VALID | ❌ FAIL | Verifier said VALID, scenario expects INVALID |
| Reference Issuer | Reference Wallet | Inji Verify · OpenID4VP | SD-JWT | JWS ES256 | Wrong holder | INVALID | INVALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Inji Verify · VC upload | JSON-LD | Ed25519Signature2020 | Happy path | VALID | VALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Inji Verify · VC upload | JSON-LD | Ed25519Signature2020 | Expired credential | EXPIRED | EXPIRED | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Inji Verify · VC upload | JSON-LD | Ed25519Signature2020 | Bad signature | INVALID | INVALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Inji Verify · VC upload | JSON-LD | Ed25519Signature2020 | Wrong type | INVALID | INVALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Inji Verify · VC upload | SD-JWT | JWS ES256 | Happy path | VALID | VALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Inji Verify · VC upload | SD-JWT | JWS ES256 | Expired credential | EXPIRED | EXPIRED | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Inji Verify · VC upload | SD-JWT | JWS ES256 | Bad signature | INVALID | INVALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Inji Verify · VC upload | SD-JWT | JWS ES256 | Wrong type | INVALID | INVALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Reference Verifier | JSON-LD | Ed25519Signature2020 | Happy path | VALID | VALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Reference Verifier | JSON-LD | Ed25519Signature2020 | Expired credential | EXPIRED | EXPIRED | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Reference Verifier | JSON-LD | Ed25519Signature2020 | Bad signature | INVALID | INVALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Reference Verifier | JSON-LD | Ed25519Signature2020 | Wrong type | INVALID | INVALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Reference Verifier | JSON-LD | Ed25519Signature2020 | Replay (stale nonce) | INVALID | INVALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Reference Verifier | JSON-LD | Ed25519Signature2020 | Wrong holder | INVALID | INVALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Reference Verifier | SD-JWT | JWS ES256 | Happy path | VALID | VALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Reference Verifier | SD-JWT | JWS ES256 | Expired credential | EXPIRED | EXPIRED | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Reference Verifier | SD-JWT | JWS ES256 | Bad signature | INVALID | INVALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Reference Verifier | SD-JWT | JWS ES256 | Wrong type | INVALID | INVALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Reference Verifier | SD-JWT | JWS ES256 | Replay (stale nonce) | INVALID | INVALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Reference Verifier | SD-JWT | JWS ES256 | Wrong holder | INVALID | INVALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Reference Verifier | mDoc | COSE ES256 | Happy path | VALID | VALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Reference Verifier | mDoc | COSE ES256 | Expired credential | EXPIRED | EXPIRED | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Reference Verifier | mDoc | COSE ES256 | Replay (stale nonce) | INVALID | INVALID | ✅ PASS |  |
| Reference Issuer | Reference Wallet | Reference Verifier | mDoc | COSE ES256 | Wrong holder | INVALID | INVALID | ✅ PASS |  |
