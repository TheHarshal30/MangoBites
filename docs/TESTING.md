# Testing: test data, test cases and results

This document covers how the Inji Interoperability Playground is tested, the test data it uses, every test case with its result, and what the tests do not cover.

There are three layers:

| Layer | What it exercises | Needs Docker | Latest result |
|---|---|:-:|---|
| Unit tests (`npm test`) | Credential formats and proofs (JSON-LD, SD-JWT, mDoc), OpenID4VCI key proof, presentation definition, retry helper | no | **9/9 pass**, 1.24 s (2026-10-26) |
| Interop sweep (`npm run interop`) | Every automatable issuer × verifier × format × scenario, with the Reference Wallet as holder | yes | **65 runs: 59 pass / 6 fail** (2026-10-26) |
| Edge-case checks | Protocol and tool behaviour outside the sweep: PIN, single-use codes, input validation, timeouts, concurrency, CLI flags | partly | see [§3.4](#34-edge-cases) |

The 6 sweep failures are findings in Inji Verify 0.16.0, not playground errors: it accepts replayed presentations (gap **V1**) and JSON-LD presentations signed by the wrong holder (gap **V2**). See [§4](#4-results-summary) and [INTEROP_GAPS.md](INTEROP_GAPS.md).

---

## 1. How to run the tests

### 1.1 Unit tests

```bash
npm ci
npm test            # from the repo root; runs `node --import tsx --test src/test/*.test.ts` in apps/server
```

No Docker, network or running server is needed. `formats.test.ts` points `DATA_DIR` at a fresh temp directory (`$TMPDIR/inji-playground-test-*`) before importing anything, so every run generates its own keys and never touches `apps/server/data/`. JSON-LD contexts come from bundled npm packages and `did:key` is resolved locally, so nothing is fetched.

| File | Tests |
|---|---|
| `apps/server/src/test/formats.test.ts` | U1–U7 |
| `apps/server/src/test/retry.test.ts` | U8–U9 |

### 1.2 Full interop sweep

```bash
./scripts/up.sh                       # Inji Certify, Inji Verify, Postgres, context mirror, playground; bootstraps Certify
npm ci
npm run interop                       # all 65 runs → docs/INTEROP_REPORT.md
```

`up.sh` runs `docker compose --profile app up -d --build`, derives a `did:key` from Inji Certify's Ed25519 signing key, writes it to `.env` as `CERTIFY_ISSUER_DID`, restarts Certify with it, and registers the two credential configurations. It is idempotent.

The sweep runs sequentially against `http://localhost:4000`. A failed run is retried once (see E29). Once the stack is up, the full sweep (65 runs plus 6 retries) took 8 s locally and 12 s in CI.

**CLI options** (`apps/server/src/cli/interop.ts`):

| Option | Values | Default |
|---|---|---|
| `--scenarios` | comma list of `happy`, `expired`, `bad-signature`, `wrong-type`, `replay`, `wrong-holder` | all |
| `--formats` | comma list of `ldp_vc`, `vc+sd-jwt`, `mso_mdoc` | all |
| `--issuers` | `inji-certify`, `playground-issuer` | all |
| `--verifiers` | `inji-verify`, `inji-verify-direct`, `playground-verifier` | all |
| `--strict` | flag: also fail on negative-path (security) findings | off |
| `--url` | playground base URL (or env `PLAYGROUND_URL`) | `http://localhost:4000` |
| `--out` | report path, relative to the repo root | `docs/INTEROP_REPORT.md` |

| Exit code | Meaning |
|:-:|---|
| 0 | Every happy-path run passed (negative-path failures are reported but tolerated), or with `--strict`, every run passed |
| 1 | A happy-path run failed (a regression in basic interop), or with `--strict`, any run failed |
| 2 | The sweep could not start, e.g. `409` because another sweep is already running |

Pass flags after `--`, from the repo root:

```bash
npm run interop -- --scenarios happy --formats ldp_vc
npm run interop -- --strict
```

(Fixed 2026-10-26, E39: the root script used to drop these flags; it now forwards them with a trailing `--`.)

### 1.3 A single run from the UI

1. `./scripts/up.sh`, then open http://localhost:4000.
2. **Playground** tab: pick an issuer, a wallet and a verifier in the 3-column selector. Unreachable parties, unsupported formats and impossible scenarios are disabled, with the reason shown.
3. Pick a credential format and a scenario. Optionally switch on **Require a transaction code** (PIN).
4. The **Expected verdict** panel shows what the verifier must return for the run to pass.
5. Press **Run flow** (or ⌘/Ctrl + Enter).
6. Read the result: stage tracker, verdict (actual vs expected), the verifier's individual checks, the live sequence diagram, and the protocol inspector with the decoded messages.

Every run is also listed in **Run history**. The **Interop matrix** tab runs the same sweep as the CLI (**Run sweep**) and exports the Markdown report (**Export report**, `GET /api/report.md`).

Runs between the reference parties only (Reference Issuer → Reference Wallet → Reference Verifier) need no Docker: `npm ci && npm run dev` (server on :4000, UI on :5173) is enough, and the Inji parties show as unreachable.

**Inji Wallet (mobile)** runs are manual: the run pauses and shows the credential-offer QR code (and the PIN, if enabled), waits for **Credential received**, then shows the presentation-request QR code. The phone must reach the services, so set `PUBLIC_BASE_URL` and `VERIFY_PUBLIC_URL` (see the README). This mode has **not** been tested with a physical device ([§5](#5-known-limitations-of-the-test-coverage)).

### 1.4 CI

`.github/workflows/interop.yml`, triggered nightly (`cron: '30 2 * * *'`), on push to `main`, and manually (`workflow_dispatch`).

| Job | Steps | Fails when |
|---|---|---|
| `unit` | Node 22 · `npm ci` · `npm run typecheck -w apps/server` · `npm test` · `npm run build -w apps/web` | a type error, a unit test failure or a UI build failure |
| `sweep` (40 min limit) | `npm ci` · `./scripts/up.sh` · `npm run interop` · report appended to the job summary and uploaded as artifact `interop-report` · on failure, the last 200 log lines of `certify`, `verify-service` and `playground` | the stack does not come up, or any **happy-path** run fails. CI does not pass `--strict`, so the 6 known security findings do not fail the job |

---

## 2. Test data

**There are no user accounts or passwords to log in with.** The playground is a local tool: the UI, the REST/WebSocket API, the Reference Issuer and the Reference Verifier have no login and no API keys. All issuance uses the OpenID4VCI pre-authorized code flow, so no end-user authentication (eSignet) is involved.

**All keys, certificates and personal data below are test-only.** The identity "Asha Rao" is fictitious. Keys are generated locally on first start. The one private key committed to the repo (the context-mirror CA) protects nothing outside the local Docker network.

### 2.1 Credential subject

All issuers issue the same fictitious person, so results are comparable across issuers and formats.

| Claim | Value | Inji Certify JSON-LD / SD-JWT | Reference Issuer JSON-LD / SD-JWT | Reference Issuer mDoc (`org.iso.18013.5.1`) |
|---|---|:-:|:-:|---|
| `fullName` | `Asha Rao` | ✓ | ✓ | `family_name` = `Rao`, `given_name` = `Asha` |
| `dateOfBirth` | `1994-03-12` | ✓ | ✓ | `birth_date` = `1994-03-12` |
| `nationality` | `IN` | ✓ | ✓ | `issuing_country` = `IN` |
| `documentNumber` | `PG-4471-2026` | ✓ | ✓ | `document_number` = `PG-DL-2026-0042` |
| `email` | `asha.rao@example.org` | ✓ | ✓ | — |
| — | — | — | — | `driving_privileges` = `[{ vehicle_category_code: "B" }]` |

Sources: `SUBJECT` in `apps/server/src/actors/issuer.ts`; the claims pushed to Certify's `POST /v1/certify/pre-authorized-data` in `apps/server/src/adapters/inji-certify.ts`; `issueMdoc` in `apps/server/src/formats/mdoc.ts`. In SD-JWT all five claims are selectively disclosable. The unit tests use smaller subsets (`fullName` = `Asha Rao`; `email` = `a@example.org`).

### 2.2 Credential configurations

| Issuer | `credential_configuration_id` | Format | Type / `vct` / doctype | Key-proof algs advertised | Credential signature |
|---|---|---|---|---|---|
| Inji Certify | `CertifyIdentity_ldp_vc` | `ldp_vc` | `VerifiableCredential`, `CertifyIdentityCredential`; contexts: credentials v1, ed25519-2020 v1, `https://www.w3.org/ns/credentials/examples/v2` | `RS256`, `PS256`, `ES256`, `Ed25519` (C4) | Ed25519Signature2020 (keymanager `CERTIFY_VC_SIGN_ED25519` / `ED25519_SIGN`) |
| Inji Certify | `CertifyIdentity_sd_jwt` | `vc+sd-jwt` | `urn:inji-playground:CertifyIdentityCredential` | same | ES256 (`CERTIFY_VC_SIGN_EC_R1` / `EC_SECP256R1_SIGN`) |
| Reference Issuer | `PlaygroundIdentity_ldp_vc` | `ldp_vc` | `VerifiableCredential`, `PlaygroundIdentityCredential`; credentials v1, ed25519-2020 v1, inline `{"@vocab": "https://w3id.org/inji-playground/vocab#"}` | `EdDSA`, `ES256` | Ed25519Signature2020 |
| Reference Issuer | `PlaygroundIdentity_sd_jwt` | `vc+sd-jwt` | `urn:inji-playground:PlaygroundIdentityCredential` | `ES256` | ES256 + `x5c` |
| Reference Issuer | `PlaygroundMDL_mso_mdoc` | `mso_mdoc` | `org.iso.18013.5.1.mDL` | `ES256` | COSE ES256 |

The Certify configurations are created or updated by `npm run setup` / `up.sh` (`upsertCertifyConfigs`). Certify also lists a `FarmerCredential` configuration seeded by its stock database script (`docker/postgres/01-certify.sql`); the playground does not use it.

### 2.3 Validity windows

| Credential | Happy path | Expired scenario |
|---|---|---|
| Reference Issuer (all formats) | issued now, expires now + 365 d | issued now − 400 d, expired now − 35 d; signed "as of" the issuance date |
| Inji Certify SD-JWT | `iat` = now, `exp` = now + 365 d, passed as pre-auth claims | `iat` = now − 400 d, `exp` = now − 35 d |
| Inji Certify JSON-LD | set by Certify itself; observed 2 years (2026-10-26 → 2028-10-25) | not possible: Certify ignores supplied validity (C8) |
| Unit test U2 | — | issued now − 400 d, expired now − 30 d |

### 2.4 Keys

The playground's own keys are generated on first start and persisted in `DATA_DIR/keys.json`, so DIDs stay stable across restarts. `DATA_DIR` is `apps/server/data/` in development (gitignored) and the `playground-data` volume in Docker. Deleting the file, or a fresh volume, gives new keys.

| Key | Type | Used for | Identifier |
|---|---|---|---|
| `issuerEd` | Ed25519 | Reference Issuer signs `ldp_vc` | `did:key:z6Mk…`, verification method `#<fingerprint>` |
| `issuerEc` | P-256 | Reference Issuer signs SD-JWT and the mDoc MSO; it is the key in the document-signer certificate (§2.8) | `did:jwk:…#0` (SD-JWT `kid`) |
| `holderEd` | Ed25519 | Holder for `ldp_vc`: signs the OpenID4VCI proof JWT (`EdDSA`, or `Ed25519` for Certify) and the VP | `did:key:z6Mk…` |
| `holderEc` | P-256 | Holder for SD-JWT and mDoc: proof JWT (`ES256`), KB-JWT, mDoc DeviceAuth | `did:jwk:…#0` |
| `attackerEc` | P-256 | *Wrong holder* scenario for SD-JWT (KB-JWT) and mDoc (DeviceAuth); never bound to any credential | `did:jwk:…` |
| fresh Ed25519 key | Ed25519 | *Wrong holder* scenario for JSON-LD; generated per run, never stored | new `did:key` each run |
| `verifierEc` | P-256 | Generated and stored but not used: request objects are unsigned (`alg: none`, allowed for `client_id_scheme=redirect_uri`) | — |
| IACA root key | P-256 | Signs the document-signer certificate once; held in memory only, never written to disk | — |
| Inji Certify keys | Ed25519, P-256 | Certify's own signing keys, generated by its keymanager on first boot | PKCS12 keystore in the `certify-keys` volume, metadata in `pg-data` |

Holder key choice: JSON-LD credentials bind to the Ed25519 `did:key`, because the same key signs the VP. SD-JWT and mDoc bind to the P-256 key that signs the KB-JWT or DeviceAuth.

### 2.5 DIDs and identifiers

| Party | Identifier | How it is formed | Example from the install that produced the 2026-10-26 report |
|---|---|---|---|
| Inji Certify issuer | `did:key` | `npm run setup` reads Certify's `/.well-known/did.json`, takes the `Ed25519VerificationKey2020` `publicKeyMultibase` (`z6Mk…`) and writes `did:key:<multibase>` to `.env` (`CERTIFY_ISSUER_DID`). Without it Certify uses `did:web:localhost%3A8090`, which Inji Verify cannot resolve (V5) | `did:key:z6MkgRMRSMgU7UdZxAsqVZJgJYvhiWrAfRxYBsx1ws3V1LoG` |
| Certify proof `verificationMethod` | DID URL | `<did>#<keymanager kid>`, not the key fingerprint (C3) | `…#kiPoAJSKvTI0Wg87qFSny2pl4TTYblqExC9EIOlmv2I` |
| Reference Issuer, JSON-LD | `did:key` of `issuerEd` | fingerprint of the Ed25519 key | `did:key:z6MkjQZCrWe7asePgBJHGQMXErPHZdMpeoJkmv9qFC4636rs` |
| Reference Issuer, SD-JWT | `iss` = `http://localhost:4000/issuer`, `kid` = `did:jwk` of `issuerEc` + `#0`, plus `x5c` | JWT VC Issuer Metadata at `/issuer/.well-known/jwt-vc-issuer` | `did:jwk:eyJjcnYiOiJQLTI1NiIs…#0` |
| Holder, JSON-LD | `did:key` of `holderEd` | `did:key:<fingerprint>`, proof `kid` = `<did>#<fingerprint>`. Reference Issuer puts the DID in `credentialSubject.id`; Certify puts the full DID URL (C7) | `did:key:z6MkvQ27MzexPfJXRsC3h2byHXYYr8axAnW5TXkBP79KYc3g` |
| Holder, SD-JWT / mDoc | `did:jwk` of `holderEc` | `did:jwk:<base64url({crv,kty,x,y})>`, `kid` = `#0`. Reference Issuer binds `cnf.jwk` (SD-JWT) or `deviceKey` (mDoc); Certify binds `cnf.kid` = the DID URL | `did:jwk:eyJjcnYiOiJQLTI1NiIsImt0eSI6IkVDIiwieCI6IjJIZVVydWlX…#0` |
| Reference Verifier | `client_id` = `response_uri` = `http://localhost:4000/verifier/response` | `client_id_scheme=redirect_uri` | — |
| Inji Verify (as used) | `clientId` = `inji-interop-playground` | a plain (non-DID) string chosen by the playground; no secret | — |
| Inji Verify's own DID | `did:web:localhost%3A8082:v1:verify` | `INJI_DID_VERIFY_URI` in `docker-compose.yml` | — |

The example values are regenerated on a fresh install.

### 2.6 Transaction code (PIN)

| Where | Behaviour |
|---|---|
| Reference Issuer | Random 6-digit numeric PIN (100000–999999) per offer. The offer grant carries `tx_code: { input_mode: "numeric", length: 6, description: "PIN shown in the playground" }`. `POST /issuer/token` compares it; a missing or wrong PIN gives `400 invalid_grant "tx_code mismatch"` |
| Inji Certify | Random 4-digit numeric PIN (1000–9999), sent as `tx_code` in `POST /v1/certify/pre-authorized-data`, so Certify's offer requires it at the token endpoint (not exercised, E4) |
| Reference Wallet | Sends the PIN as both `tx_code` (draft 13) and `user_pin` (draft 11). Refuses a PIN-protected offer when no PIN is supplied |
| Inji Wallet (mobile) | The run page shows the PIN with **Copy PIN**; the user types it into the app |
| Sweep | Never sets a PIN. The PIN path is covered by single runs (E1–E4) |

Other lifetimes: Certify offers `expires_in: 1800` s and `mosip.certify.cnonce-expire-seconds=600`. The Reference Issuer advertises `expires_in: 600` and `c_nonce_expires_in: 300` but does not enforce them; its pre-authorized codes are single-use (E5).

### 2.7 Presentation definitions requested

Built by `presentationDefinition()` in `apps/server/src/actors/presentation-definition.ts`. Both verifiers receive the same definition. Filters use `pattern`, like Inji Verify's own templates.

| Format | `input_descriptors[0].id` | Format constraint | Fields requested | `limit_disclosure` |
|---|---|---|---|---|
| `ldp_vc` | `ldp-credential` | `ldp_vc.proof_type`: Ed25519Signature2020, RsaSignature2018, Ed25519Signature2018, JsonWebSignature2020 | `$.type` matching the credential's own type (`PlaygroundIdentityCredential` or `CertifyIdentityCredential`) | — |
| `vc+sd-jwt` | `sd-jwt-credential` | `sd-jwt_alg_values`: ES256, EdDSA, RS256, PS256; `kb-jwt_alg_values`: ES256, EdDSA | `$.vct` matching the credential's `vct`; `$.fullName`, `$.dateOfBirth` (optional) | `required` |
| `mso_mdoc` | `org.iso.18013.5.1.mDL` | `mso_mdoc.alg`: ES256, EdDSA | `family_name`, `given_name`, `birth_date`, `document_number` in `org.iso.18013.5.1`, `intent_to_retain: false` | `required` |

| Request detail | Reference Verifier | Inji Verify · OpenID4VP |
|---|---|---|
| Definition id | `playground-<format>-<8 chars of the request id>` | `inji-<format>-<8 hex>` |
| Transport | `presentation_definition_uri` | `presentation_definition` or `presentation_definition_uri`, as returned by `POST /v1/verify/vp-request` |
| `nonce` | 16 random bytes, base64url | 16 random bytes, base64url, sent in `/vp-request` |
| `response_mode` | `direct_post` | `direct_post` |

### 2.8 Test PKI for SD-JWT `x5c` and mDoc

Inji Verify reads SD-JWT issuer keys only from `x5c` (V4), and mDoc needs an issuer certificate, so the Reference Issuer has a two-level ISO 18013-5 style PKI (`issuerCertificate()` in `apps/server/src/crypto/keys.ts`). It is generated on first use and stored in `DATA_DIR/issuer-certs.json`.

| Certificate | Subject | Issuer | Key / alg | Validity | Extensions |
|---|---|---|---|---|---|
| IACA root (trust anchor) | `CN=Inji Interop Playground IACA, C=IN`, serial `01` | self-signed | P-256 / ECDSA-SHA256 | now − 3 y → now + 10 y | `basicConstraints` CA, pathLen 0 (critical); `keyUsage` keyCertSign, cRLSign |
| Document signer | `CN=Inji Interop Playground Issuer, C=IN`, serial `02` | IACA root | `issuerEc` (P-256) | now − 3 y → now + 5 y | `keyUsage` digitalSignature; AKI/SKI |

Use: the SD-JWT header carries `x5c: [document signer, root]`. The mDoc MSO is signed with `issuerEc` and the document-signer certificate. The Reference Verifier trusts only the root for mDoc. Observed in the 2026-10-26 install: document signer 2023-10-27 → 2031-10-25, root 2023-10-27 → 2036-10-23.

Inji Certify signs its SD-JWTs with its own keymanager chain: `CN=www.example.com (CERTIFY_VC_SIGN_EC_R1-EC_SECP256R1_SIGN)`, issued by `CN=www.example.com (ROOT)` (`O=IIITB, L=BANGALORE`), generated by Certify on first boot.

### 2.9 JSON-LD context mirror test CA

www.w3.org rate-limits JSON-LD context fetches (HTTP 429), which made genuine credentials verify as INVALID (V3, C2). `docker/context-mirror` (nginx) serves the standard contexts over HTTPS inside the Docker network.

| Item | Value |
|---|---|
| CA | `docker/context-mirror/certs/ca.crt` + `ca.key`: RSA 2048, self-signed, `CN=Inji Playground Context Mirror CA (local testing only)`, valid 2026-10-18 → 2036-10-15. **The private key is committed on purpose**: it is trusted only inside the two Inji containers and protects nothing |
| Server certificate | `mirror.crt` + `mirror.key`: `CN=www.w3.org`, SAN `www.w3.org`, `w3.org`, `w3id.org`, `serverAuth`, signed by the CA, same validity. Extension files: `ca.ext`, `leaf.ext` |
| Trust | Identical copies in `docker/inji-certify/context-mirror-ca.crt` and `docker/inji-verify/context-mirror-ca.crt`, imported into each container's Java `cacerts` (alias `inji-playground-context-mirror`, default store password `changeit`) |
| Routing | Mirror at `172.31.250.10` on the compose network `172.31.250.0/24`; `extra_hosts` maps `www.w3.org`, `w3.org` and `w3id.org` to it, for the `certify` and `verify-service` containers only |
| Contexts served (11) | `www.w3.org`: `2018/credentials/v1`, `ns/credentials/v2`, `ns/credentials/examples/v2`, `ns/credentials/undefined-terms/v2`, `ns/did/v1`. `w3id.org`: `security/v1`, `security/v2`, `security/suites/ed25519-2020/v1`, `security/data-integrity/v1`, `security/data-integrity/v2`, `security/multikey/v1`. Anything else is proxied to the real host |
| Regenerate contexts | `node scripts/build-context-mirror.mjs` (copies them from the canonical npm packages) |

### 2.10 Service credentials

| Service | Credential | Source |
|---|---|---|
| Postgres 15 | user `postgres`, password `postgres`; databases `inji_certify` (schema `certify`) and `inji_verify` (schema `verify`); host port 5433 | `docker-compose.yml`, `docker/postgres/*.sql`, `certify-default.properties` |
| Inji Certify keystore | PKCS12, password `local` | `mosip.kernel.keymanager.hsm.keystore-pass` in `docker/inji-certify/certify-default.properties` |
| Inji Verify keystore | `INJI_KEYSTORE_FILE_PASS=mosip` | `docker-compose.yml` |
| Playground UI and API | none | — |

### 2.11 Ports, URLs and environment

| Port | Service |
|---|---|
| 4000 | Playground: UI, REST API (`/api`), WebSocket (`/ws`), Reference Issuer (`/issuer`), Reference Verifier (`/verifier`) |
| 5173 | Vite dev server for the UI (development only), proxied to 4000 |
| 8090 | `certify-nginx` → Inji Certify 0.14.0 (`/v1/certify/*` and the root `.well-known` documents) |
| 8082 | Inji Verify service 0.16.0 (`/v1/verify/*`; container port 8080) |
| 5433 | Postgres 15 (container port 5432) |
| — | Context mirror, `172.31.250.10:443`, compose network only |

| Variable | Effect on tests |
|---|---|
| `PUBLIC_BASE_URL` | Base URL in Reference Issuer offers and Reference Verifier requests (set to a tunnel or LAN URL for a phone) |
| `VERIFY_PUBLIC_URL` | Inji Verify `response_uri` handed to wallets |
| `INJI_CERTIFY_URL`, `INJI_VERIFY_URL` | Where the playground reaches the Inji services (defaults `http://localhost:8090`, `http://localhost:8082`) |
| `CERTIFY_ISSUER_DID` | Certify's issuer DID, written to `.env` by setup |
| `DATA_DIR` | Keys, PKI, run history (`runs/`), wallet store (`wallet.json`, last 50 credentials) |
| `PLAYGROUND_URL` | Target of `npm run interop` |

### 2.12 Sample credentials (decoded)

Taken from the Reference Wallet after the 2026-10-26 sweep (`GET /api/wallet`). Values that differ per install are shortened.

| Credential | Signed by | Holder binding | Notes |
|---|---|---|---|
| Inji Certify · JSON-LD | Ed25519Signature2020, `verificationMethod` `did:key:z6MkgRMR…#kiPoAJSK…` | `credentialSubject.id` = `did:key:z6MkvQ27…#z6MkvQ27…` (DID URL, C7) | `id` `https://mosip.io/credential/<uuid>`; contexts v1, ed25519-2020, examples/v2 |
| Inji Certify · SD-JWT | ES256, `x5c` = Certify keymanager chain, `kid` = Certify's keymanager key id | `cnf.kid` = holder `did:jwk:…#0` | `iss` `http://localhost:8090`; 5 disclosures; `id` is a plain (non-disclosable) claim |
| Reference Issuer · JSON-LD | Ed25519Signature2020, `verificationMethod` `did:key:z6MkjQZC…#z6MkjQZC…` | `credentialSubject.id` = `did:key:z6MkvQ27…` | `id` `urn:uuid:<uuid>`; inline `@vocab` context |
| Reference Issuer · SD-JWT | ES256, `kid` `did:jwk:…#0`, `x5c` = [document signer, IACA root] | `cnf.jwk` = holder P-256 key | `iat` = `nbf`; 5 disclosures, `_sd_alg: sha-256` |
| Reference Issuer · mDoc | COSE ES256 with the document-signer certificate | `deviceKey` = holder P-256 key | doctype `org.iso.18013.5.1.mDL`; `validFrom` → `validUntil` 1 year |

---

## 3. Test cases

**Result legend**

| Result | Meaning |
|---|---|
| **PASS** | Automated: unit test (`npm test`, 2026-10-26) or interop sweep (2026-10-26, Reference Wallet as holder) |
| **PASS (manual)** / **FAIL (manual)** | Checked by hand on 2026-10-26 against a local playground instance (reference parties, except E30 and E39, which involved the full stack), following the "How it's produced" column. Not part of the automated suite |
| **Not run** | Implemented in code, not exercised by any test |
| **FAIL** | The expected behaviour was not met |

### 3.1 Unit tests

| ID | Area | Case | How it's produced | Expected | Result |
|---|---|---|---|---|---|
| U1 | JSON-LD VC | Issue and verify; a forged claim breaks the proof | Issue a `PlaygroundIdentityCredential` (`fullName` = `Asha Rao`) with the issuer Ed25519 key; copy it and set `fullName` = `Mallory` | Original: `signatureValid` true. Forged: false | PASS (19.8 ms) |
| U2 | JSON-LD VC | An expired credential keeps a valid signature but is flagged expired | Issue with `issuanceDate` now − 400 d, `expirationDate` now − 30 d | `signatureValid` true **and** `expired` true, so it maps to EXPIRED, not INVALID | PASS (2.1 ms) |
| U3 | JSON-LD VP | Holder proof is bound to challenge and domain | Holder `did:key` signs a VP with challenge `nonce-1`, domain `https://verifier.example`; verify with `nonce-1`, then with `nonce-2` | `nonce-1`: verified. `nonce-2`: `verified` false, `holderProofValid` false (replay rejected) | PASS (19.4 ms) |
| U4 | SD-JWT VC | Selective disclosure and key binding | Issue with 2 disclosable claims (`fullName`, `email`); present only `fullName` with a KB-JWT (`nonce` n, `aud` v); re-verify with nonce `other`; present with the attacker key | 2 disclosures; signature, disclosures and key binding valid; `fullName` visible, `email` undefined; wrong nonce → `keyBindingValid` false; attacker KB-JWT → false | PASS (34.8 ms) |
| U5 | mDoc | DeviceResponse verifies against the OpenID4VP session transcript | Issue an mDL bound to the holder P-256 key; present with transcript (`mdoc_generated_nonce` m, `client_id` = `response_uri` = `https://verifier.example/response`, nonce n); present again with nonce `stale` | IssuerAuth, DeviceAuth, data integrity all valid; stale nonce → `deviceAuthValid` false | PASS (40.9 ms) |
| U6 | OpenID4VCI | Key proof `aud` and `nonce` are enforced | ES256 proof JWT (`typ` `openid4vci-proof+jwt`, `kid` holder `did:jwk`, `aud` `https://issuer`, `nonce` c); same proof against nonce `other` and aud `https://elsewhere`; EdDSA proof with the holder `did:key` | Returns the holder DID; wrong nonce rejected (`/nonce/`); wrong aud rejected (`/aud/`); EdDSA proof → holder `did:key`. `verifyKeyProof` also rejects a wrong `typ`, but this test does not assert it | PASS (3.6 ms) |
| U7 | Presentation definition | SD-JWT definition requests only the listed claims | `presentationDefinition({ format: 'vc+sd-jwt', vct: 'urn:x', claims: ['fullName', 'dateOfBirth'] })` → `requestedSdClaims()` | `['fullName', 'dateOfBirth']` (`vct` excluded) | PASS (0.25 ms) |
| U8 | Bring-up | Retry until the dependency is ready, logging each distinct reason once | `fn` throws `Certify DID document has no Ed25519VerificationKey2020 key` twice, then returns | Value returned after 3 calls; 1 log line | PASS (14.2 ms) |
| U9 | Bring-up | Retry gives up after the timeout with the last error | `fn` always throws `still missing`; timeout 30 ms, interval 5 ms | Rejects with `still missing` | PASS (33.7 ms) |

### 3.2 How the interop scenarios are produced

**Grading rule** (`apps/server/src/runs.ts`): each scenario has an expected verdict: `INVALID` if any tamper mode is set, else `EXPIRED` if the credential is expired, else `VALID`. A run **passes only if the verifier returns exactly that verdict**. A verifier that accepts a forgery returns VALID and fails the run.

| Scenario | Expected | JSON-LD (`ldp_vc`) | SD-JWT (`vc+sd-jwt`) | mDoc (`mso_mdoc`) |
|---|---|---|---|---|
| Happy path | VALID | Honest issuance and VP | Honest; the wallet discloses only the requested claims (`fullName`, `dateOfBirth`) | Honest DeviceResponse |
| Expired credential | EXPIRED | The **issuer** signs an already-expired credential (§2.3); not possible with Certify (C8) | Issuer signs an expired SD-JWT (Reference Issuer, and Certify through pre-auth `iat`/`exp`) | Reference Issuer signs an expired MSO |
| Bad signature | INVALID | Wallet appends ` (forged)` to a signed `credentialSubject` claim after issuance: the first string claim other than `id` (OpenID4VP), or `fullName` (VC upload). No re-signing | Wallet extends `exp` by 10 years in the issuer-signed JWT, keeping the old signature | not implemented |
| Wrong type | INVALID | Wallet sets `type` = `["VerifiableCredential", "ForgedCredential"]` | Wallet sets `vct` = `urn:forged:OtherCredential` | not implemented |
| Replay (stale nonce) | INVALID | VP proof `challenge` = `stale-<random>` instead of the verifier's nonce | KB-JWT `nonce` = `stale-<random>` | SessionTranscript built with `stale-<random>` |
| Wrong holder | INVALID | VP signed by a freshly generated `did:key` (valid VP signature, but the holder is not `credentialSubject.id`) | KB-JWT signed by `attackerEc` instead of the `cnf` key | DeviceAuth signed by `attackerEc` |

Tamper modes are produced by the Reference Wallet only (`apps/server/src/actors/wallet.ts`; VC-upload tampering in `tamperRaw()` in `runs.ts`). The API refuses tamper modes with the mobile wallet (E27).

**Checks the Reference Verifier performs** (`apps/server/src/actors/verifier.ts`). Any failed check gives INVALID; if all pass, the validity period decides between EXPIRED and VALID.

| Format | Checks |
|---|---|
| All | Wallet did not return `error`; `vp_token` present; `presentation_submission.definition_id` = this definition's id; `descriptor_map[0].id` = the input descriptor id |
| JSON-LD | `vp_token` is an `ldp_vp`; descriptor format `ldp_vp`/`ldp_vc`; issuer proof (credential signature); holder proof (VP signature, `challenge` = nonce, `domain` = `client_id`); holder is the credential subject (subject DID without fragment = `vp.holder`); credential type includes the requested type; non-standard `did:key` fragments are accepted but logged as a separate check (C3) |
| SD-JWT | `vp_token` is an SD-JWT; descriptor format `vc+sd-jwt`/`dc+sd-jwt`; issuer signature (key from `jwk`, `x5c[0]`, `did:jwk`/`did:web` `kid`, or JWT VC Issuer Metadata); every disclosure matches an `_sd` digest; KB-JWT required, signed by the `cnf.jwk` or `cnf.kid` key, `typ` `kb+jwt`, `sd_hash`, `nonce`, `aud`; `vct` equals the requested `vct`; disclosed claims listed |
| mDoc | `vp_token` is a base64url DeviceResponse; descriptor format `mso_mdoc`; IssuerAuth (MSO signature, certificate chains to the IACA root); DeviceAuth (holder signature over the SessionTranscript `[mdoc_generated_nonce, client_id, response_uri, nonce]`); data integrity (value digests) |
| Then | Validity period, evaluated only when every check above passed: expired → EXPIRED, else VALID |

Inji Verify's answer is mapped by `apps/server/src/adapters/inji-verify.ts`. OpenID4VP: `vpResultStatus` SUCCESS and every VC SUCCESS → VALID; every VC SUCCESS or EXPIRED with at least one EXPIRED → EXPIRED; anything else → INVALID. VC upload: `verificationStatus` SUCCESS → VALID, EXPIRED → EXPIRED, else INVALID.

### 3.3 Interop scenario × verifier

108 combinations are possible (2 issuers × 3 automatable verifiers × 3 formats × 6 scenarios). 65 are generated (`matrixInputs()` in `apps/server/src/report.ts`, filtered by `validateInput()` in `runs.ts`); 43 are not applicable (NA1–NA5). Every run uses the Reference Wallet. Per-run detail is in [INTEROP_REPORT.md](INTEROP_REPORT.md).

Abbreviations: C = Inji Certify, R = Reference Issuer; LD = JSON-LD, SD = SD-JWT, MD = mDoc.

| ID | Area | Case | How it's produced | Expected | Result |
|---|---|---|---|---|---|
| I1 | Inji Verify · OpenID4VP | Happy path | C·LD, C·SD, R·LD, R·SD | VALID | **PASS 4/4** |
| I2 | Inji Verify · OpenID4VP | Expired credential | C·SD, R·LD, R·SD | EXPIRED | **PASS 3/3** |
| I3 | Inji Verify · OpenID4VP | Bad signature | C·LD, C·SD, R·LD, R·SD | INVALID | **PASS 4/4** |
| I4 | Inji Verify · OpenID4VP | Wrong type | C·LD, C·SD, R·LD, R·SD | INVALID | **PASS 4/4** |
| I5 | Inji Verify · OpenID4VP | Replay (stale nonce) | C·LD, C·SD, R·LD, R·SD | INVALID | **FAIL 0/4**: VALID every time, `vpResultStatus` SUCCESS (gap V1, nonce never checked) |
| I6 | Inji Verify · OpenID4VP | Wrong holder | C·LD, C·SD, R·LD, R·SD | INVALID | **2/4**: SD-JWT rejected (PASS); JSON-LD accepted as VALID (FAIL, gap V2, no `ldp_vp` holder binding) |
| I7 | Inji Verify · VC upload | Happy path | C·LD, C·SD, R·LD, R·SD | VALID | **PASS 4/4** |
| I8 | Inji Verify · VC upload | Expired credential | C·SD, R·LD, R·SD | EXPIRED | **PASS 3/3** |
| I9 | Inji Verify · VC upload | Bad signature | C·LD, C·SD, R·LD, R·SD | INVALID | **PASS 4/4** |
| I10 | Inji Verify · VC upload | Wrong type | C·LD, C·SD, R·LD, R·SD | INVALID | **PASS 4/4** |
| I11 | Reference Verifier | Happy path | C·LD, C·SD, R·LD, R·SD, R·MD | VALID | **PASS 5/5** |
| I12 | Reference Verifier | Expired credential | C·SD, R·LD, R·SD, R·MD | EXPIRED | **PASS 4/4**; failing check "Validity period: credential is past its expiry" |
| I13 | Reference Verifier | Bad signature | C·LD, C·SD, R·LD, R·SD | INVALID | **PASS 4/4**; "Issuer proof: Invalid signature." (LD), "Issuer signature: signature verification failed" (SD) |
| I14 | Reference Verifier | Wrong type | C·LD, C·SD, R·LD, R·SD | INVALID | **PASS 4/4**; "Credential type includes …" / "vct is …" fail, and the issuer signature fails too |
| I15 | Reference Verifier | Replay (stale nonce) | C·LD, C·SD, R·LD, R·SD, R·MD | INVALID | **PASS 5/5**; "The challenge is not as expected" (LD), "nonce mismatch … possible replay" (SD), "DEVICE_AUTH: Device signature must be valid" (MD) |
| I16 | Reference Verifier | Wrong holder | C·LD, C·SD, R·LD, R·SD, R·MD | INVALID | **PASS 5/5**; "Holder is the credential subject" (LD), "KB-JWT not signed by the key in cnf (holder mismatch)" (SD), DeviceAuth (MD) |
| NA1 | Inji Certify | Any scenario with mDoc (18 combinations) | — | not generated | N/A: Certify runs here in `DataProvider` pre-auth mode, which issues only `ldp_vc` and SD-JWT; mDoc needs `VCIssuance` plugin mode |
| NA2 | Inji Verify (both paths) | Any scenario with mDoc (12, Reference Issuer) | — | not generated | N/A: Inji Verify 0.16 has no mDoc path for OpenID4VP or `/vc-verification` (V8) |
| NA3 | Inji Certify | Expired JSON-LD (3) | — | not generated | N/A: Certify sets `validFrom`/`validUntil` itself (C8) |
| NA4 | Inji Verify · VC upload | Replay and wrong holder (8) | — | not generated | N/A: upload verifies the bare credential; there is no presentation, nonce or holder proof |
| NA5 | Reference Verifier | mDoc bad signature and wrong type (2) | — | not generated | N/A: these tamper modes are not implemented for mDoc |

Totals: 65 runs, **59 pass / 6 fail**. By verifier: Inji Verify · OpenID4VP 17/23, Inji Verify · VC upload 15/15, Reference Verifier 27/27. Every INVALID or EXPIRED verdict from Inji Verify · OpenID4VP came with `vpResultStatus` FAILED and a per-credential status, so none of the passes came from a timeout (see E25).

### 3.4 Edge cases

| ID | Area | Case | How it's produced | Expected | Result |
|---|---|---|---|---|---|
| E1 | OpenID4VCI · PIN | Offer requires a transaction code | Single run R → Reference Wallet → Reference Verifier with **Require a transaction code**, for JSON-LD, SD-JWT and mDoc | Offer carries `tx_code` (numeric, length 6); the token request carries `tx_code` and `user_pin`; token 200; run PASS | PASS (manual), 3/3 |
| E2 | OpenID4VCI · PIN | Missing or wrong PIN | Mobile-wallet run with a PIN (the offer stays unused); `POST /issuer/token` without `tx_code`, then with `000000` | `400 invalid_grant "tx_code mismatch"` both times | PASS (manual) |
| E3 | OpenID4VCI · PIN | Wallet receives a PIN-protected offer but has no PIN | Call the Reference Wallet's `receiveCredential()` on that offer without a PIN | Stops before the token request: "Offer requires a tx_code (PIN) but none was supplied" | PASS (manual) |
| E4 | OpenID4VCI · PIN | PIN with Inji Certify | Single run with Inji Certify and **Require a transaction code** | 4-digit PIN sent in `/pre-authorized-data`; Certify issues after the PIN | Not run |
| E5 | OpenID4VCI | Pre-authorized code is single-use | Replay the token request of a completed run | `400 invalid_grant "unknown or already used pre-authorized_code"` | PASS (manual) |
| E6 | OpenID4VCI | Wrong grant type | `POST /issuer/token` with `grant_type=authorization_code` | `400 unsupported_grant_type` | PASS (manual) |
| E7 | OpenID4VCI | Malformed credential requests | `POST /issuer/credential`: no proof; malformed proof JWT; `format` different from the token's configuration; unknown access token | `400 invalid_proof "proof.jwt required"`; `400 invalid_proof` with a fresh `c_nonce`; `400 unsupported_credential_format`; `401 invalid_token` | PASS (manual), 4/4 |
| E8 | OpenID4VCI | Key proof `typ`, `aud`, `nonce` | See U6 | Wrong `aud` or `nonce` rejected | PASS (`typ` not asserted) |
| E9 | OpenID4VCI | Issuer asks for a fresh `c_nonce` | Issuer answers the credential request with 400 and a `c_nonce` (`invalid_proof`, `use_dpop_nonce`, or none issued yet) | Wallet retries once with a proof over the new nonce | Not run (both issuers return `c_nonce` in the token response) |
| E10 | OpenID4VCI | Issuer metadata has no `token_endpoint` | Every Certify and Reference Issuer run | Wallet reads `<issuer>/.well-known/oauth-authorization-server`, then falls back to `openid-configuration`. Certify needs the playground's nginx mapping for this (C6) | PASS (sweep) |
| E11 | OpenID4VCI | Certify advertises `Ed25519` instead of `EdDSA` (C4) | Certify JSON-LD issuance | Wallet accepts either name and signs the proof with `alg: Ed25519` | PASS (sweep) |
| E12 | OpenID4VP | Selective disclosure of only the requested claims | SD-JWT happy path; the definition asks for `fullName`, `dateOfBirth` | Wallet discloses those 2 of 5 claims. Reference Verifier reports "disclosed: fullName, dateOfBirth" (Certify: "id, fullName, dateOfBirth"; `id` is a plain claim) | PASS (sweep, U4, U7) |
| E13 | OpenID4VP | Credential does not match the presentation definition | Wrong-type scenario | Wallet logs "credential does NOT match the presentation definition" but still submits, so the verifier is the one tested; Reference Verifier fails the type/`vct` check | PASS (sweep) |
| E14 | OpenID4VP | `presentation_submission` must reference the request | Every Reference Verifier run checks `definition_id` and the descriptor id | Mismatch → INVALID | Positive path PASS (sweep); mismatch Not run. Inji Verify does not validate the submission (V6, source review) |
| E15 | OpenID4VP | Same response posted twice | Re-POST a completed run's `direct_post` body to `/verifier/response`; then with an unknown `state` | `400 "response already received for this request"`; `400 "unknown state"` | PASS (manual) |
| E16 | OpenID4VP | Wallet returns an error instead of a `vp_token` | `direct_post` with `error=access_denied` | Reference Verifier → INVALID ("Wallet response"). The playground's Verify DB script keeps such responses storable (V7) | Not run |
| E17 | Verdicts | Expired credential with a valid signature | U2 and the 10 expired runs | EXPIRED, not INVALID. For mDoc the library reports an expired MSO as an IssuerAuth failure; the verifier separates expiry-only errors | PASS (U2, sweep 10/10) |
| E18 | Verdicts | Expired **and** tampered | Any check fails on an expired credential | INVALID wins: the validity period is evaluated only when all other checks pass | Not run |
| E19 | Verdicts | Holder presents an expired credential | Expired scenario over OpenID4VP | The wallet signs the VP "as of" the issuance date so the library lets it present; judging expiry is the verifier's job | PASS (sweep) |
| E20 | Interop deviations | Certify `did:key` proof with a keymanager-kid fragment (C3) | Certify JSON-LD → Reference Verifier | Accepted, with an extra logged check "non-standard fragment accepted: kiPoAJ…" | PASS (sweep) |
| E21 | Interop deviations | Certify `credentialSubject.id` is a DID URL (C7) | Certify JSON-LD → Reference Verifier | Holder check compares the DID part and notes "subject id is a DID URL with fragment" | PASS (sweep) |
| E22 | Interop deviations | Certify binds SD-JWT with `cnf.kid`, the Reference Issuer with `cnf.jwk` | SD-JWT replay and wrong-holder runs at the Reference Verifier, both issuers | Both forms resolved; KB-JWT checked against the bound key | PASS (sweep) |
| E23 | Errors | Certify returns HTTP 200 with an `errors` envelope (C5) | `/pre-authorized-data` answers `{errors:[…]}` | Run error "Inji Certify rejected the offer: <codes>", not a verdict | Not run |
| E24 | Errors | Unsupported protocol options | Offer without a pre-authorized grant; deferred `transaction_id`; `response_mode` other than `direct_post`; request without `response_uri` | Run error with an explicit message | Not run |
| E25 | Errors | A failed run is reported as an error, not as a verdict | Any exception during a run (unreachable service, HTTP error, timeout) | `state` error, result FAIL, `failedStage` set, no `actual` verdict; report cell `❌ error`; UI "The run stopped during the … stage". Exceptions: an Inji Verify request that never reaches `VP_SUBMITTED` within 60 s is graded INVALID ("Presentation received ✗"), and an exception inside the Reference Verifier's evaluation is INVALID | PASS (manual): the E32 and E33 timeouts ended this way. The 2026-10-26 sweep had no errors |
| E26 | Errors | Inji Verify turns JSON-LD context-load failures into INVALID (V3) | www.w3.org returns 429 | The playground cannot tell this apart from a real rejection; the context mirror removes the cause | Mitigated: all 7 nightly CI sweeps that ran gave the identical result (§4.3) |
| E27 | Input validation | Impossible combinations are refused | `POST /api/runs` with: tamper + mobile wallet; replay or wrong holder via VC upload; Certify expired JSON-LD; Certify mDoc; Inji Verify mDoc; bad signature on mDoc; unknown tamper; unknown issuer; a wallet id as verifier | HTTP 400 with the reason, e.g. "Tamper modes need the Reference Wallet (a real wallet will not forge presentations)" | PASS (manual), 10/10 |
| E28 | Input validation | The UI blocks the same combinations | Selector with an impossible choice | Option disabled with the reason; **Run flow** disabled; unreachable parties named | Not run (UI logic in `apps/web/src/lib/flow.ts`) |
| E29 | Sweep | Flaky runs | A run fails | Retried once; the retry replaces the first attempt; a pass on retry is shown as `✅ PASS (passed on retry)` / `✅ (flaky)`, not as a clean pass | PASS (sweep): the 6 failing runs were each retried and failed again (71 executions for 65 cells), so none is flaky |
| E30 | Sweep | Two sweeps at once | Start a second sweep while one runs | `409 "A matrix sweep is already running"`; CLI prints "Could not start sweep: 409 …" and exits 2 | PASS (manual) |
| E31 | Sweep | `--strict` | Default: exit 1 only on a happy-path failure. `--strict`: exit 1 on any failure | Default with the 6 security findings → exit 0; `--strict` → exit 1 | Default PASS (every nightly CI sweep exits 0 with 59/6). `--strict` with 0 failures → exit 0 PASS (manual, reference-only subset). `--strict` with failures: Not run |
| E32 | Manual wallet | Phone never accepts the offer | Mobile-wallet run, never press **Credential received** | Run error after 10 min: "Timed out waiting for the mobile wallet" | PASS (manual): error at 600.0 s, failed stage `issue`, result FAIL with no verdict |
| E33 | Manual wallet | Phone never sends the presentation | Mobile-wallet run, press **Credential received**, never scan the request | Run error after 10 min (60 s for automated wallets): "No presentation received within 600s" | PASS (manual): error at 601.0 s, failed stage `verify`, result FAIL with no verdict |
| E34 | Persistence | Server restarts while a run is in flight | Mobile-wallet run waiting for the phone; stop and restart the server | The run should be shown as error "Interrupted by server restart" (`load()` in `runs.ts`) | **PASS (manual, after fix)**: `startRun` now saves the run immediately. Verified 2026-10-26 on a fresh stack: a mobile-wallet run in state `running`, `docker compose restart playground`, then `GET /api/runs/:id` → `error · FAIL · Interrupted by server restart`. Before the fix the run disappeared (404) |
| E35 | Bring-up | Certify serves its DID document before its Ed25519 key exists | Fresh database (CI) | `setup` retries `certifyDidKey` (every 3 s, up to 180 s) instead of failing | PASS (U8, U9). Before the fix, 3 CI sweep jobs failed with exactly this error (§4.3) |
| E36 | Bring-up | Certify issuer must be resolvable by Inji Verify | `up.sh` switches Certify to `did:key` (V5) | Certify → Inji Verify verifies | PASS (sweep I1, I7) |
| E37 | Determinism | JSON-LD contexts served locally | Context mirror (§2.9) | Same verdicts on every sweep | PASS: all 7 nightly CI sweeps that ran and 2 local sweeps on 2026-10-26 gave 59/6 |
| E38 | Formats | Holder key choice per format | Every sweep run | JSON-LD bound to the Ed25519 `did:key` that also signs the VP; SD-JWT and mDoc bound to the P-256 key | PASS (sweep) |
| E39 | CLI | Sweep options reach the CLI | `npm run interop -- --strict` from the repo root, vs `npm run interop -w apps/server -- --strict` | Options parsed by `interop.ts` | **PASS (manual, after fix)**: `npm run interop -- --scenarios happy --formats ldp_vc` from the root ran exactly 6 runs. Before the fix npm consumed the options and ran the full default sweep |
| E40 | Sweep | Clear history while a sweep runs | `POST /api/matrix`, then `DELETE /api/runs` 2 s later | Finished runs deleted, running ones kept; the sweep completes; the server stays up | **PASS (manual, after fix)**: DELETE → 204, the sweep continued from 13/65 to completion, server healthy, no errors logged. Before the fix the server would crash with an unhandled rejection in `whenDone()` |
| E41 | Grading | Nothing reaches Inji Verify | Inji Verify's request stays `ACTIVE` until the timeout | Run **error** (no verdict), never INVALID — otherwise an attack scenario would PASS without being tested | PASS (code review + typecheck): `awaitInjiVpResult` now throws; a refusal at `response_uri` (HTTP ≥ 400) is still graded INVALID. Not triggered end to end |

---

## 4. Results summary

### 4.1 Unit tests

`npm test`, 2026-10-26, macOS, Node v26.10.0 (CI uses Node 22):

```
✔ ldp_vc: issue and verify; forged claim breaks the proof (19.770333ms)
✔ ldp_vc: expired credential keeps a valid signature but is flagged expired (2.072583ms)
✔ ldp_vp: holder proof is bound to challenge and domain (19.359333ms)
✔ SD-JWT VC: selective disclosure and key binding (34.81ms)
✔ mso_mdoc: device response verifies against the session transcript (40.867833ms)
✔ OpenID4VCI key proof: typ, aud and nonce are enforced (3.552583ms)
✔ presentation definition: SD-JWT requests only the listed claims (0.250792ms)
✔ retry: keeps trying until the dependency is ready, logging each distinct reason once (14.190417ms)
✔ retry: gives up after the timeout with the last error (33.664292ms)
ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1244.680417
```

`npm run typecheck -w apps/server` also passes. CI's `unit` job passed on all 10 workflow runs between 2026-10-18 and 2026-10-26 (7/7 each time: the format tests, before the 2 retry tests were added).

### 4.2 Interop sweep

[INTEROP_REPORT.md](INTEROP_REPORT.md), 2026-10-26: **65 runs, 59 pass / 6 fail.** All 6 failures are Inji Verify · OpenID4VP returning VALID for an attack:

| # | Issuer | Format | Scenario | Inji Verify returned | Gap |
|:-:|---|---|---|---|---|
| 1 | Inji Certify | JSON-LD | Replay (stale nonce) | VALID | V1: OpenID4VP `nonce` never checked |
| 2 | Inji Certify | SD-JWT | Replay (stale nonce) | VALID | V1 |
| 3 | Reference Issuer | JSON-LD | Replay (stale nonce) | VALID | V1 |
| 4 | Reference Issuer | SD-JWT | Replay (stale nonce) | VALID | V1 |
| 5 | Inji Certify | JSON-LD | Wrong holder | VALID | V2: no `ldp_vp` holder binding |
| 6 | Reference Issuer | JSON-LD | Wrong holder | VALID | V2 |

The Reference Verifier rejects all six attacks (I15, I16). SD-JWT wrong holder is correctly rejected by Inji Verify, because it checks the KB-JWT against `cnf`. Each failure was retried once by the sweep and failed again, so they are consistent, not flaky.

### 4.3 Repeatability

| Date (UTC) | Source | `unit` | Sweep result |
|---|---|---|---|
| 2026-10-18 | CI, push | pass | job failed at bring-up: "Certify DID document has no Ed25519VerificationKey2020 key" (E35) |
| 2026-10-19 | CI, push | pass | job failed at bring-up (same error) |
| 2026-10-19 | CI, nightly | pass | 59 / 6 |
| 2026-10-20 | CI, nightly | pass | 59 / 6 |
| 2026-10-21 | CI, nightly | pass | 59 / 6 |
| 2026-10-22 | CI, nightly | pass | 59 / 6 |
| 2026-10-23 | CI, nightly | pass | 59 / 6 |
| 2026-10-24 | CI, nightly | pass | 59 / 6 |
| 2026-10-25 | CI, nightly | pass | job failed at bring-up (same error) |
| 2026-10-26 | CI, nightly | pass | 59 / 6 |
| 2026-10-26 | local, 2 sweeps (17:12 and 17:18 UTC) | 9/9 | 59 / 6 both times, 6 retries, 0 passes on retry |

Every sweep that ran produced the same 59/6 matrix, matching the first published report of 2026-10-18. The three failed CI jobs never reached the sweep; the bring-up race behind them is now retried (E35).

### 4.4 What worked out of the box

From [INTEROP_GAPS.md](INTEROP_GAPS.md) and the sweep:

- **Inji Certify → Inji Verify** works for JSON-LD (Ed25519Signature2020) and SD-JWT (ES256, `x5c`), over both OpenID4VP and VC upload. This needs Certify's issuer to be a `did:key` (V5).
- **Cross-ecosystem:** the Reference Issuer's JSON-LD and SD-JWT credentials verify in Inji Verify, and Inji Certify's credentials verify in the Reference Verifier, apart from the logged deviations C3 and C7.
- **Expiry:** Inji Verify returns EXPIRED for expired JSON-LD and SD-JWT credentials with valid signatures.
- **Forgery:** edited claims and rewritten `type`/`vct` are rejected as INVALID by every verifier.

Changes the stack needed (each one is applied in this repo and written up, with its basis, in INTEROP_GAPS.md): the missing `credentialOfferCache` that breaks Certify's pre-authorized flow in the stock compose config (C1, observed); the root-level authorization-server mapping in Certify's nginx (C6, source review); a `did:key` instead of Certify's default `did:web` issuer so Inji Verify can resolve it (V5); the local context mirror against W3C rate-limiting (V3, C2, observed); nullable columns in Inji Verify's DB script for wallet error responses (V7, source review).

---

## 5. Known limitations of the test coverage

- **No physical-device test of Inji Wallet.** The mobile mode (QR codes, PIN, "Credential received", same-device deep link) is implemented but has not been tested with the Inji Wallet app on a phone. Every automated run uses the Reference Wallet as holder, so Inji Wallet's interop with Inji Certify and Inji Verify is not measured.
- **Inji Web is not in the matrix.** It needs Mimoto plus eSignet login (authorization-code flow) and pre-configured issuers, so it cannot be driven headlessly.
- **mDoc is reference-only.** Inji Certify mDoc needs `VCIssuance` plugin mode (not the pre-authorized `DataProvider` mode used here), and Inji Verify 0.16 has no mDoc path (V8). The mDoc runs show that the Reference Issuer, Wallet and Verifier (built on `@auth0/mdl`) agree with each other; they say nothing about Inji's mDoc support. Bad-signature and wrong-type tampering are not implemented for mDoc.
- **Untested protocol options:** `response_mode=direct_post.jwt`, deferred issuance, and the authorization-code flow in the Reference Wallet are not supported. For mDoc over OpenID4VP, `mdoc_generated_nonce` is sent as a form field because `direct_post` has no JWE `apu`.
- **Inji Certify JSON-LD cannot be issued already expired** (C8), so expiry of Certify JSON-LD credentials is not tested.
- **The PIN (`tx_code`) path is not in the sweep.** It was checked by hand with the Reference Issuer only (E1–E3); PIN with Inji Certify was not run (E4).
- **Wrong type is not an isolated test.** `type` and `vct` are covered by the issuer signature, so this scenario also breaks the signature. A verifier that checks only signatures still rejects it.
- **No issuer trust or revocation checks.** The Reference Verifier accepts any issuer whose signature verifies (`did:key` is self-certifying, and for SD-JWT it uses `x5c[0]` without validating the chain); credential status is not checked. No scenario re-signs a forged credential with an untrusted key.
- **One test identity.** All runs use the same fictitious subject; claim variety, large credentials and non-ASCII data are not covered.
- **Some findings are from source review only.** V6, V7, V8, C6 and C9, and part of V5, were read in the released code or config and not reproduced by a run (see the Basis column in INTEROP_GAPS.md).
- **Unit-test scope.** The unit tests cover the format and proof code and the retry helper. The orchestrator, the reference issuer and verifier HTTP endpoints, the Inji adapters and the web UI have no unit tests; they are exercised end to end by the sweep, and the UI only by CI's build step and manual use.
- **Manual checks are not automated.** The "PASS (manual)" rows were run by hand for this document and are not in the test suite.
- **No load or performance testing.** The sweep runs one flow at a time on one machine; timings are indicative only.
- **Versions.** Results apply to Inji Certify 0.14.0 and Inji Verify 0.16.0.
