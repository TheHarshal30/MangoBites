# API reference — Inji Interoperability Playground

This document covers every HTTP and WebSocket interface the playground **exposes**, and every Inji Certify / Inji Verify endpoint it **calls**. Everything here comes from the code in `apps/server/src`. Examples marked *(live)* are trimmed responses from a running stack. Examples marked *(illustrative)* were built from the TypeScript types and code paths; IDs, keys and timestamps in them are made up.

| Surface | Mounted at | Section |
|---|---|---|
| Playground REST API (UI, CI, scripting) | `/api` | [2](#2-playground-rest-api) |
| Live event stream | `/ws` | [3](#3-websocket-ws) |
| Reference Issuer (OpenID4VCI draft 13) | `/issuer` | [4.1](#41-reference-issuer-issuer--openid4vci-draft-13) |
| Reference Verifier (OpenID4VP draft 21) | `/verifier` | [4.2](#42-reference-verifier-verifier--openid4vp-draft-21) |
| Inji Certify 0.14.0 / Inji Verify 0.16.0 (called, not exposed) | `:8090`, `:8082` | [5](#5-inji-apis-used) |
| Worked examples | — | [6](#6-example-use-cases) |

---

## 1. Overview

### Base URLs and ports

| What | Default | Set with | Notes |
|---|---|---|---|
| Playground: REST `/api`, WebSocket `/ws`, UI | `http://localhost:4000` | `PORT` | `apps/server/src/config.ts`. Listens on **all interfaces** (`server.listen(PORT)` with no host; compose publishes `4000:4000`). |
| Reference Issuer | `{PUBLIC_BASE_URL}/issuer` | `PUBLIC_BASE_URL` (default `http://localhost:{PORT}`) | This URL goes into offers as `credential_issuer` and is the `aud` the issuer requires in proof JWTs. |
| Reference Verifier | `{PUBLIC_BASE_URL}/verifier` | `PUBLIC_BASE_URL` | `{PUBLIC_BASE_URL}/verifier/response` is both `client_id` and `response_uri`. |
| Inji Certify (behind nginx) | `http://localhost:8090` | `INJI_CERTIFY_URL` | API under `/v1/certify`; nginx also maps the root `.well-known` documents (`docker/inji-certify/nginx.conf`). |
| Inji Verify service | `http://localhost:8082` | `INJI_VERIFY_URL` | API under `/v1/verify`. |
| UI dev server (Vite) | `http://localhost:5173` | — | Proxies `/api` and `/ws` to `:4000` (`apps/web/vite.config.ts`). |

Other settings that affect the API:

| Variable | Effect |
|---|---|
| `DATA_DIR` | Where runs (`runs/<id>.json`) and the Reference Wallet (`wallet.json`) are stored. Default `apps/server/data`. |
| `URL_REWRITES` | `from=to,…` prefix rewrites for outgoing calls, used when the playground itself runs in Docker (`docker-compose.yml`). Logged URLs are not rewritten. |
| `VERIFY_PUBLIC_URL` | Read by `docker-compose.yml` (not the server): becomes Inji Verify's `INJI_VP_SUBMISSION_BASE_URL`, the base of the `response_uri` it hands to wallets. |
| `PLAYGROUND_URL` | Target for `npm run interop` (default `http://localhost:4000`). |

### Content types and error format

- Request bodies to `/api` are JSON (`Content-Type: application/json`, max 2 MB). Responses are JSON, except `GET /api/report.md` (`text/markdown`) and `DELETE /api/runs` (204, empty).
- Errors the API raises itself come back as **`{"error": "<message>"}`** with a 4xx status (400, 404, 409). The 409 from `POST /api/matrix` adds the running sweep's fields.
- Errors that happen before or outside the handlers are **not** JSON. Express's default handler returns an HTML page. This covers malformed JSON (400), `POST /api/runs` without a JSON body (`req.body` is `undefined` in Express 5, so validation throws and the response is 500), and unknown `/api/*` paths (404).
- The Reference Issuer and Verifier use OAuth-style errors: `{"error": "<code>", "error_description": "…"}`.

### Authentication

#### Playground API (`/api`, `/ws`): none

The playground is a local test tool. **No endpoint asks for credentials**, and CORS is fully open (`app.use(cors())` → `Access-Control-Allow-Origin: *` on every route, including `/issuer` and `/verifier`). The WebSocket has no auth and no origin check, and every client receives every message. What follows from that:

- Anyone who can reach port 4000 can start runs and sweeps, delete all history (`DELETE /api/runs`), and read every payload. That includes full credentials from `GET /api/wallet` and access tokens in token-response bodies under `GET /api/runs/{id}` (only `authorization` *request* headers are truncated, to 24 characters).
- Because CORS is `*`, any web page open in a browser on the same machine can do the same.
- The server binds all interfaces, so other machines on your network can reach it too.
- Setting `PUBLIC_BASE_URL` to an ngrok or LAN URL for phone testing exposes **the whole API**, not just `/issuer` and `/verifier`, for as long as the tunnel is up.
- **Do not expose it publicly.** Run it on a trusted machine or network and close tunnels when you are done. The credential data is fictional (`Asha Rao`, `PG-4471-2026`), but the API is still unprotected.

#### Reference Issuer: OpenID4VCI pre-authorized code

The issuer at `/issuer` enforces the OpenID4VCI pre-authorized code flow (`apps/server/src/actors/issuer.ts`, `apps/server/src/util/proof.ts`):

| Mechanism | What the issuer does |
|---|---|
| Pre-authorized code | 18 random bytes (base64url), embedded in the offer. **Single use**: deleted from memory when it is exchanged. Unknown or reused code → `400 invalid_grant`. No client authentication (`pre-authorized_grant_anonymous_access_supported: true`). |
| `tx_code` (PIN) | Only when the run asks for it (`txCode: true`). Offer advertises `{input_mode: "numeric", length: 6}`. The token request must carry the same 6-digit `tx_code`, otherwise `400 invalid_grant` ("tx_code mismatch"). |
| Access token | Random 24 bytes, `token_type: "Bearer"`, sent as `Authorization: Bearer …` to `/credential` and `/nonce`. `expires_in: 600` is advertised but **not enforced**, and the token can be reused. |
| `c_nonce` | Issued with the token. Rotated after every credential response and after every rejected proof (returned in the error body). `c_nonce_expires_in: 300` is advertised but not enforced. |
| Proof JWT (`proof_type: "jwt"`) | Header `typ` must be `openid4vci-proof+jwt`. The holder key comes from header `jwk`, or from `kid` as a `did:jwk` or Ed25519 `did:key` (`z6Mk…`). The signature must verify, `aud` must equal the issuer URL (a string, or an array containing it), and `nonce` must equal the current `c_nonce`. `iat` is not checked. Any failure → `400 invalid_proof` with a fresh `c_nonce`. |

#### Reference Verifier: OpenID4VP binding

The verifier at `/verifier` does not authenticate the wallet's HTTP call. It binds the response to its request: `state` selects the request (single use, a second response gets a 400), and the presentation must be bound to the request's `nonce` and `client_id`. The binding is checked through the `ldp_vp` proof's `challenge`/`domain`, the SD-JWT KB-JWT's `nonce`/`aud`, or the mdoc SessionTranscript. The request is unsigned (`client_id_scheme=redirect_uri`).

#### Calls to Inji services

The playground sends **no credentials** to Inji Certify or Inji Verify. In this local compose stack, their management endpoints (`/credential-configurations`, `/pre-authorized-data`, `/vp-request`, …) accept unauthenticated calls. How to secure them in a production deployment is out of scope here; see upstream ([mosip/inji-certify](https://github.com/mosip/inji-certify), [mosip/inji-verify](https://github.com/mosip/inji-verify)).

---

## 2. Playground REST API

| Method | Path | Purpose |
|---|---|---|
| GET | [`/api/catalog`](#get-apicatalog) | Parties (with live health), formats, tamper modes, scenarios, endpoint URLs |
| POST | [`/api/runs`](#post-apiruns) | Start one issue → present → verify run |
| GET | [`/api/runs`](#get-apiruns) | List all runs (summaries, newest first) |
| GET | [`/api/runs/{id}`](#get-apirunsid) | One run with its full protocol timeline and verification outcome |
| POST | [`/api/runs/{id}/signal`](#post-apirunsidsignal) | Tell a mobile-wallet run that the credential was received |
| DELETE | [`/api/runs`](#delete-apiruns) | Delete all run history |
| POST | [`/api/matrix`](#post-apimatrix) | Start a matrix sweep (issuer × verifier × format × scenario) |
| GET | [`/api/matrix`](#get-apimatrix) | Progress of the running sweep, or `null` |
| GET | [`/api/report.md`](#get-apireportmd) | Markdown compatibility report, optionally for one sweep |
| GET | [`/api/wallet`](#get-apiwallet) | Credentials held by the Reference Wallet |
| GET | [`/contexts/examples-v2.jsonld`](#get-contextsexamples-v2jsonld) | Static JSON-LD context (outside `/api`) |

Any other path that is not `/api`, `/issuer`, `/verifier` or `/ws` serves the built UI (`apps/web/dist/index.html`), if it has been built.

### 2.1 Identifiers and objects

**Party ids** (`apps/server/src/catalog.ts`):

| id | Role | Mode | Formats | Can issue already-expired |
|---|---|---|---|---|
| `inji-certify` | issuer | auto | `ldp_vc`, `vc+sd-jwt` | `vc+sd-jwt` only (gap C8) |
| `playground-issuer` | issuer | auto | `ldp_vc`, `vc+sd-jwt`, `mso_mdoc` | all |
| `playground-wallet` | wallet | auto | all | — |
| `inji-wallet-mobile` | wallet | **manual** (QR) | all | — |
| `inji-verify` | verifier | auto | `ldp_vc`, `vc+sd-jwt` | — |
| `inji-verify-direct` | verifier | auto | `ldp_vc`, `vc+sd-jwt` | — |
| `playground-verifier` | verifier | auto | all | — |

**Formats:** `ldp_vc` (W3C VC 1.1 JSON-LD, Ed25519Signature2020), `vc+sd-jwt` (IETF SD-JWT VC, ES256 + KB-JWT), `mso_mdoc` (ISO 18013-5 mDL, mock).

**Tamper modes** (`apps/server/src/actors/wallet.ts`) and **scenarios** (`apps/server/src/report.ts`):

| Scenario id | `tamper` | `expired` | Formats | Expected verdict |
|---|---|---|---|---|
| `happy` | `none` | `false` | all | `VALID` |
| `expired` | `none` | `true` | depends on issuer (table above) | `EXPIRED` |
| `bad-signature` | `bad-signature` | `false` | `ldp_vc`, `vc+sd-jwt` | `INVALID` |
| `wrong-type` | `wrong-type` | `false` | `ldp_vc`, `vc+sd-jwt` | `INVALID` |
| `replay` | `replay` | `false` | all | `INVALID` |
| `wrong-holder` | `wrong-holder` | `false` | all | `INVALID` |

The expected verdict is derived as follows: any `tamper` other than `none` → `INVALID`, otherwise `expired: true` → `EXPIRED`, otherwise `VALID`. A run's `result` is `PASS` only if the verifier's verdict (`actual`) equals `expected` (`apps/server/src/runs.ts`).

**Run** (returned by `POST /api/runs` and `GET /api/runs/{id}`):

| Field | Type | Meaning |
|---|---|---|
| `id` | string (UUID) | Run id |
| `issuer`, `wallet`, `verifier` | party id | The chosen parties |
| `format` | `ldp_vc` \| `vc+sd-jwt` \| `mso_mdoc` | Credential format |
| `tamper` | tamper mode | Defaults to `none` |
| `expired`, `txCode` | boolean | Defaults to `false` |
| `batchId` | string? | Set on runs started by a sweep |
| `retryOf` | string? | Id of the failed run this one re-executes (sweep retry) |
| `createdAt`, `finishedAt` | ISO 8601 | `finishedAt` is set when the run ends |
| `durationMs` | number? | Wall-clock duration |
| `state` | `running` \| `completed` \| `error` | `error`: an exception stopped the run (service unreachable, protocol error, timeout, server restart). `result` is then `FAIL`. |
| `stages` | `{issue, present, verify}` → `{status, detail?}` | `status`: `pending` `running` `done` `failed` `waiting` `skipped`. `issue.detail` is the proof type, `verify.detail` the verdict, a failed stage's `detail` the error. `present` is `skipped` for `inji-verify-direct`. |
| `versions` | `{[partyId]: version}` | Versions of the three parties at run time |
| `proofType` | string? | `Ed25519Signature2020`, `JWS ES256` or `COSE ES256` |
| `expected` | `VALID` \| `INVALID` \| `EXPIRED` | Verdict the scenario calls for |
| `actual` | verdict? | Verdict the verifier returned |
| `result` | `PASS` \| `FAIL`? | Set when the run ends |
| `error` | string? | Failure reason, e.g. `Verifier said VALID, scenario expects INVALID` |
| `failedStage` | `issue` \| `present` \| `verify`? | Where it failed |
| `credential` | `{format, summary}`? | Decoded summary of the issued credential (absent for mobile-wallet runs) |
| `interaction` | `{offerUri?, txCode?, authorizationRequestUri?, prompt?}`? | Only for `inji-wallet-mobile`: what to show the phone |
| `outcome` | `{status, checks[], claims?, raw?}`? | Verifier result. `checks[]` = `{name, ok, detail?}`. `raw` is Inji Verify's response body. |
| `events` | `ProtocolEvent[]` | Full protocol timeline ([section 3](#protocolevent)) |

**RunSummary** (returned by `GET /api/runs` and sent over `/ws`) is a Run **without** `events` and `outcome`, plus `outcomeChecks` (= `outcome.checks`) and `eventCount`.

### GET /api/catalog

Everything a client needs to build a valid `POST /api/runs`. Each call probes Inji Certify and Inji Verify live (4 s timeout per probe), so the response reflects their current state.

**Response 200**

| Field | Type |
|---|---|
| `parties[]` | Party (`id`, `role`, `name`, `vendor`, `version`, `mode`, `formats[]`, `protocol`, `description`, `expiredIssuance?[]`) plus `health: {up, detail}`. For `inji-certify`, `health` also has `issuerDid` and `configs[]` (credential configuration ids Certify advertises). `inji-verify` and `inji-verify-direct` share one probe. |
| `formats` | `{[format]: {label, short}}` |
| `tamperModes` | `{[tamper]: {label, description, formats[]}}` |
| `scenarios[]` | `{id, label, tamper, expired}` |
| `endpoints` | `{playground, certify, verify}` base URLs |

```bash
curl -s localhost:4000/api/catalog
```

*(live, trimmed: 2 of 7 parties, 1 of 3 formats, 1 of 5 tamper modes, 1 of 6 scenarios)*

```json
{
  "parties": [
    {
      "id": "inji-certify", "role": "issuer", "name": "Inji Certify", "vendor": "Inji", "version": "0.14.0", "mode": "auto",
      "formats": ["ldp_vc", "vc+sd-jwt"], "protocol": "OpenID4VCI draft 13 · pre-authorized code",
      "description": "Inji Certify in DataProvider mode with PreAuthDataProviderPlugin, acting as its own authorization server (no eSignet).",
      "expiredIssuance": ["vc+sd-jwt"],
      "health": {
        "up": true,
        "issuerDid": "did:key:z6MkgRMRSMgU7UdZxAsqVZJgJYvhiWrAfRxYBsx1ws3V1LoG",
        "configs": ["CertifyIdentity_sd_jwt", "CertifyIdentity_ldp_vc"],
        "detail": "ready · issuer did:key:z6MkgRMRSMgU7UdZxAsqVZJgJYvhiWrAfRxYBsx1ws3V1LoG"
      }
    },
    {
      "id": "inji-wallet-mobile", "role": "wallet", "name": "Inji Wallet (mobile)", "vendor": "Inji", "version": "≥0.20", "mode": "manual",
      "formats": ["ldp_vc", "vc+sd-jwt", "mso_mdoc"], "protocol": "QR scan · OpenID4VCI + OpenID4VP",
      "description": "Scan the offer and presentation QR codes with the Inji Wallet app. Needs PUBLIC_BASE_URL / VERIFY_PUBLIC_URL reachable from the phone.",
      "health": { "up": true, "detail": "set PUBLIC_BASE_URL to a LAN/ngrok URL so a phone can reach the playground" }
    }
  ],
  "formats": { "vc+sd-jwt": { "label": "IETF SD-JWT VC (ES256 + KB-JWT)", "short": "SD-JWT" } },
  "tamperModes": { "replay": { "label": "Replay (stale nonce)", "description": "Bind the presentation to an old nonce instead of the verifier’s", "formats": ["ldp_vc", "vc+sd-jwt", "mso_mdoc"] } },
  "scenarios": [ { "id": "replay", "label": "Replay (stale nonce)", "tamper": "replay", "expired": false } ],
  "endpoints": { "playground": "http://localhost:4000", "certify": "http://localhost:8090", "verify": "http://localhost:8082" }
}
```

When a service is down, `health` reads e.g. `{"up": false, "detail": "unreachable at http://localhost:8090 (ECONNREFUSED) — run \"docker compose up -d\""}`. When Certify is up but not bootstrapped: `"running, but not bootstrapped (missing CertifyIdentity_ldp_vc) — run \"npm run setup\""`.

### POST /api/runs

Starts one run and returns immediately. The run executes in the background; follow it over `/ws` or by polling `GET /api/runs/{id}`.

**Request body** (`RunInput`)

| Field | Type | Required | Allowed values |
|---|---|---|---|
| `issuer` | string | yes | `inji-certify`, `playground-issuer` |
| `wallet` | string | yes | `playground-wallet`, `inji-wallet-mobile` |
| `verifier` | string | yes | `inji-verify`, `inji-verify-direct`, `playground-verifier` |
| `format` | string | yes | `ldp_vc`, `vc+sd-jwt`, `mso_mdoc` (all three parties must support it) |
| `tamper` | string | no (`none`) | `none`, `bad-signature`, `wrong-type`, `replay`, `wrong-holder` |
| `expired` | boolean | no (`false`) | Issuer signs a credential whose validity already ended (−400 d … −35 d) |
| `txCode` | boolean | no (`false`) | Offer requires a PIN: 6 digits from the Reference Issuer, 4 digits from Inji Certify |
| `batchId`, `retryOf` | string | no | Tags used by the sweep. Accepted from clients and stored without validation. |

**Responses**

| Status | Body |
|---|---|
| 201 | The new **Run** in its state at that moment: `state: "running"`, usually `stages.issue.status: "running"` and the first event(s) |
| 400 | `{"error": "…"}`: the first rule below that fails |
| 500 (HTML) | No JSON body or wrong `Content-Type` (see [error format](#content-types-and-error-format)) |

**Validation errors** (`validateInput`, `apps/server/src/runs.ts`, checked in this order):

| Condition | `error` |
|---|---|
| `issuer` unknown or not an issuer | `Unknown issuer <issuer>` |
| `wallet` unknown or not a wallet | `Unknown wallet <wallet>` |
| `verifier` unknown or not a verifier | `Unknown verifier <verifier>` |
| `format` unknown | `Unknown format <format>` |
| A party lacks the format (checked issuer, wallet, verifier) | `<Party name> does not support <JSON-LD\|SD-JWT\|mDoc>` |
| `tamper` unknown | `Unknown tamper mode <tamper>` |
| Tamper with `inji-wallet-mobile` | `Tamper modes need the Reference Wallet (a real wallet will not forge presentations)` |
| Tamper not defined for the format | `Tamper "<tamper>" is not available for <short>` |
| `expired` but the issuer can't for this format | `<Issuer name> cannot issue already-expired <short> credentials` |
| `replay`/`wrong-holder` with `inji-verify-direct` | `Replay / wrong-holder only apply to presentations (VC upload has no holder proof)` |

One combination passes validation but always ends in `state: "error"`: `inji-wallet-mobile` with `inji-verify-direct` (`VC upload verification needs the credential; use the Reference Wallet or Inji Verify · OpenID4VP`).

```bash
curl -s -X POST localhost:4000/api/runs -H 'content-type: application/json' \
  -d '{"issuer":"playground-issuer","wallet":"playground-wallet","verifier":"playground-verifier","format":"ldp_vc"}'
```

*(illustrative)* 201:

```json
{
  "id": "0b6c3e0e-5f1a-4c55-9d0e-3f7e2b9a1c44",
  "issuer": "playground-issuer", "wallet": "playground-wallet", "verifier": "playground-verifier",
  "format": "ldp_vc", "tamper": "none", "expired": false, "txCode": false,
  "createdAt": "2026-10-26T17:20:03.390Z",
  "state": "running",
  "stages": { "issue": { "status": "running" }, "present": { "status": "pending" }, "verify": { "status": "pending" } },
  "versions": { "playground-issuer": "playground", "playground-wallet": "playground", "playground-verifier": "playground" },
  "expected": "VALID",
  "events": [
    { "id": "6a0e…", "runId": "0b6c3e0e-…", "ts": "2026-10-26T17:20:03.391Z", "step": "Run", "kind": "note",
      "from": "playground", "to": "playground",
      "summary": "Reference Issuer → Reference Wallet → Reference Verifier · JSON-LD · expecting VALID" },
    { "id": "c41d…", "runId": "0b6c3e0e-…", "ts": "2026-10-26T17:20:03.392Z", "step": "OpenID4VCI · Create offer (Reference Issuer)",
      "kind": "action", "from": "playground", "to": "issuer", "summary": "Pre-authorized credential offer created",
      "data": { "offer": { "credential_issuer": "http://localhost:4000/issuer", "credential_configuration_ids": ["PlaygroundIdentity_ldp_vc"],
                           "grants": { "urn:ietf:params:oauth:grant-type:pre-authorized_code": { "pre-authorized_code": "Qm3x…" } } },
                "offerUri": "openid-credential-offer://?credential_offer_uri=http%3A%2F%2Flocalhost%3A4000%2Fissuer%2Foffers%2F…" } }
  ]
}
```

Rejected combination:

```bash
curl -s -X POST localhost:4000/api/runs -H 'content-type: application/json' \
  -d '{"issuer":"inji-certify","wallet":"playground-wallet","verifier":"inji-verify","format":"mso_mdoc"}'
# 400 {"error":"Inji Certify does not support mDoc"}
```

### GET /api/runs

All runs known to the server, newest first (`createdAt` descending), as **RunSummary** objects. This includes runs still in progress and runs loaded from `DATA_DIR/runs` at startup. Runs that were in progress when the server stopped come back as `state: "error"`, `error: "Interrupted by server restart"`. There is no paging or filtering. Always 200.

```bash
curl -s localhost:4000/api/runs
```

*(illustrative; this result matches row "Reference Issuer · SD-JWT · Inji Verify · OpenID4VP · Replay" in `docs/INTEROP_REPORT.md`, gap V1)*

```json
[
  {
    "id": "c1f0a7d2-2b8e-4f61-a0f4-5d1e9b7c3a10",
    "issuer": "playground-issuer", "wallet": "playground-wallet", "verifier": "inji-verify",
    "format": "vc+sd-jwt", "tamper": "replay", "expired": false, "txCode": false,
    "createdAt": "2026-10-26T17:24:11.002Z", "finishedAt": "2026-10-26T17:24:13.517Z", "durationMs": 2515,
    "state": "completed",
    "stages": { "issue": { "status": "done", "detail": "JWS ES256" }, "present": { "status": "done" }, "verify": { "status": "failed", "detail": "VALID" } },
    "versions": { "playground-issuer": "playground", "playground-wallet": "playground", "inji-verify": "0.16.0" },
    "expected": "INVALID", "actual": "VALID", "result": "FAIL", "failedStage": "verify",
    "error": "Verifier said VALID, scenario expects INVALID",
    "proofType": "JWS ES256",
    "credential": { "format": "vc+sd-jwt", "summary": {
      "vct": "urn:inji-playground:PlaygroundIdentityCredential", "issuer": "http://localhost:4000/issuer",
      "expires": "2027-10-26T17:24:11.000Z", "alg": "ES256",
      "claims": { "fullName": "Asha Rao", "dateOfBirth": "1994-03-12", "nationality": "IN", "documentNumber": "PG-4471-2026", "email": "asha.rao@example.org" } } },
    "outcomeChecks": [
      { "name": "vpResultStatus", "ok": true, "detail": "SUCCESS" },
      { "name": "VC #1 verificationStatus", "ok": true, "detail": "SUCCESS" }
    ],
    "eventCount": 18
  }
]
```

### GET /api/runs/{id}

The full **Run**, including `events[]` (every HTTP exchange and action, with decoded artefacts) and `outcome`. Works while the run is in progress; `events` then holds what has happened so far.

| Status | Body |
|---|---|
| 200 | Run |
| 404 | `{"error": "not found"}` |

```bash
curl -s localhost:4000/api/runs/0b6c3e0e-5f1a-4c55-9d0e-3f7e2b9a1c44
```

*(illustrative, trimmed to `outcome`; Reference Verifier, JSON-LD, happy path)*

```json
{
  "id": "0b6c3e0e-5f1a-4c55-9d0e-3f7e2b9a1c44",
  "state": "completed", "expected": "VALID", "actual": "VALID", "result": "PASS",
  "outcome": {
    "status": "VALID",
    "checks": [
      { "name": "presentation_submission references this definition", "ok": true, "detail": "definition_id=playground-ldp_vc-5e2a91c7" },
      { "name": "descriptor_map matches input descriptor", "ok": true, "detail": "descriptor id=ldp-credential, expected ldp-credential" },
      { "name": "descriptor format is ldp_vp/ldp_vc", "ok": true, "detail": "format=ldp_vp" },
      { "name": "Issuer proof (credential signature)", "ok": true, "detail": "Ed25519Signature2020" },
      { "name": "Holder proof (VP signature, challenge=nonce, domain=client_id)", "ok": true, "detail": "holder did:key:z6MkpT…" },
      { "name": "Holder is the credential subject", "ok": true, "detail": "subject=did:key:z6MkpT…, holder=did:key:z6MkpT…" },
      { "name": "Credential type includes PlaygroundIdentityCredential", "ok": true, "detail": "VerifiableCredential, PlaygroundIdentityCredential" },
      { "name": "Validity period", "ok": true, "detail": "within validity" }
    ],
    "claims": { "id": "did:key:z6MkpT…", "fullName": "Asha Rao", "dateOfBirth": "1994-03-12", "nationality": "IN", "documentNumber": "PG-4471-2026", "email": "asha.rao@example.org" }
  },
  "events": [ "… 15 ProtocolEvents, see section 3 …" ]
}
```

### POST /api/runs/{id}/signal

Only for runs with `wallet: "inji-wallet-mobile"`. After `POST /api/runs`, such a run pauses at `stages.issue.status: "waiting"` and exposes `interaction.offerUri` (plus `interaction.txCode` if a PIN was requested). Once the phone has accepted the credential, call this endpoint to move on to presentation. The run then publishes `interaction.authorizationRequestUri` and waits up to 10 minutes for the phone's presentation, which the verifier picks up without another signal. The issue wait also times out after 10 minutes (`Timed out waiting for the mobile wallet`).

- No request body.
- **Always `202 {"ok": true}`**, even for an unknown id or a run that is not waiting: the signal is fire-and-forget.

```bash
curl -s -X POST localhost:4000/api/runs/0b6c3e0e-5f1a-4c55-9d0e-3f7e2b9a1c44/signal
# {"ok":true}
```

### DELETE /api/runs

Deletes every **finished** run from memory and from `DATA_DIR/runs`. Runs still executing are kept, so it is safe during a sweep: the sweep carries on and its remaining runs are recorded as usual (before 2026-10-26 this could crash the server, because the sweep looked up a run that had just been deleted). It does not touch the Reference Wallet (`/api/wallet`). Returns **204** with no body.

```bash
curl -s -X DELETE -o /dev/null -w '%{http_code}\n' localhost:4000/api/runs   # 204
```

### POST /api/matrix

Starts a sweep: every valid combination of issuer × auto verifier × format × scenario, with `playground-wallet` as the holder. Runs execute **one at a time**. A run that fails is **retried once** (the retry carries `retryOf`); in reports, a pass on retry counts as *flaky*. Only one sweep can run at a time.

**Request body** (optional; omit a field, or the whole body, to include everything)

| Field | Type | Values |
|---|---|---|
| `scenarios` | string[] | `happy`, `expired`, `bad-signature`, `wrong-type`, `replay`, `wrong-holder` |
| `issuers` | string[] | `inji-certify`, `playground-issuer` |
| `verifiers` | string[] | `inji-verify`, `inji-verify-direct`, `playground-verifier` |
| `formats` | string[] | `ldp_vc`, `vc+sd-jwt`, `mso_mdoc` |

Combinations that fail `validateInput` (e.g. Inji Certify + `mso_mdoc`, `replay` + `inji-verify-direct`) are skipped without error. Unknown ids match nothing, which can produce `total: 0`. The full matrix is **65 runs**.

**Responses**

| Status | Body |
|---|---|
| 202 | `{"batchId": "batch-<YYYY-MM-DDTHH:MM:SS>-<4 hex>", "total": <runs>, "done": 0}` |
| 409 | `{"error": "A matrix sweep is already running", "batchId": "…", "total": …, "done": …}` |

```bash
curl -s -X POST localhost:4000/api/matrix -H 'content-type: application/json' \
  -d '{"scenarios":["happy","replay"],"verifiers":["inji-verify","playground-verifier"]}'
```

*(illustrative)* `{"batchId":"batch-2026-10-26T17:30:12-9f3a","total":18,"done":0}`

There is no WebSocket message for sweep progress. Poll `GET /api/matrix`, or watch `run` messages whose `batchId` matches.

### GET /api/matrix

Progress of the running sweep. `done` counts finished combinations, including any retry. Returns **`null`** when no sweep is running, including once a sweep has finished. Always 200.

```bash
curl -s localhost:4000/api/matrix
```

*(live, idle)* `null` · *(illustrative, running)* `{"batchId":"batch-2026-10-26T17:30:12-9f3a","total":18,"done":7}`

### GET /api/report.md

Markdown report over all **finished** runs (`state` ≠ `running`). With `?batch=<batchId>`, only that sweep's runs are included. `Content-Type: text/markdown; charset=utf-8`. Always 200; with no matching runs the tables are empty.

The report contains a happy-path compatibility matrix, a scenario matrix, and an "All runs" table. A retry replaces its first attempt; a retry that passed shows `✅ (flaky)` in the compatibility matrix and `✅ PASS (passed on retry)` in "All runs". `npm run interop` writes this output to `docs/INTEROP_REPORT.md`.

```bash
curl -sG localhost:4000/api/report.md --data-urlencode 'batch=batch-2026-10-26T17:30:12-9f3a' -o report.md
```

*(output of this endpoint, trimmed from `docs/INTEROP_REPORT.md`)*

```markdown
# Inji Interoperability Report

Generated 2026-10-18T00:47:43.346Z · 65 runs · **59 pass / 6 fail**
…
## Compatibility matrix (happy path)

| Issuer → Verifier | Format | Inji Verify · OpenID4VP | Inji Verify · VC upload | Reference Verifier |
|---|---|:-:|:-:|:-:|
| Inji Certify | JSON-LD | ✅ | ✅ | ✅ |
…
## Scenario matrix
| Issuer | Format | Verifier | Happy path | Expired credential | Bad signature | Wrong type | Replay (stale nonce) | Wrong holder |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Inji Certify | JSON-LD | Inji Verify · OpenID4VP | ✅ | — | ✅ | ✅ | ❌ VALID | ❌ VALID |
…
## All runs
| Issuer | Wallet | Verifier | Format | Proof | Scenario | Expected | Actual | Result | Detail |
…
```

### GET /api/wallet

Credentials the Reference Wallet has received, newest first, capped at 50 and persisted in `DATA_DIR/wallet.json`. Each entry holds the **raw credential**: a JSON-LD object for `ldp_vc`, a compact SD-JWT string for `vc+sd-jwt`, base64url CBOR for `mso_mdoc`. Always 200 (`[]` when empty).

| Field | Meaning |
|---|---|
| `id` | Wallet-local UUID |
| `format`, `configId` | Format and the issuer's credential configuration id |
| `issuer` | `credential_issuer` from the offer |
| `credential` | Raw credential |
| `receivedAt` | ISO 8601 |
| `summary` | Decoded view. `ldp_vc`: `type, issuer, expires, subject, proof`. `vc+sd-jwt`: `vct, issuer, expires, alg, claims`. `mso_mdoc`: `docType, claims, validityInfo`. |

```bash
curl -s localhost:4000/api/wallet
```

*(illustrative)*

```json
[
  {
    "id": "6f1c2a4e-8d0b-4c1e-9a77-0f5b3e2d1c90",
    "format": "vc+sd-jwt",
    "configId": "PlaygroundIdentity_sd_jwt",
    "issuer": "http://localhost:4000/issuer",
    "credential": "eyJhbGciOiJFUzI1NiIsInR5cCI6InZjK3NkLWp3dCIs…~WyJ…~WyJ…~",
    "receivedAt": "2026-10-26T17:24:11.840Z",
    "summary": {
      "vct": "urn:inji-playground:PlaygroundIdentityCredential", "issuer": "http://localhost:4000/issuer",
      "expires": "2027-10-26T17:24:11.000Z", "alg": "ES256",
      "claims": { "fullName": "Asha Rao", "dateOfBirth": "1994-03-12", "nationality": "IN", "documentNumber": "PG-4471-2026", "email": "asha.rao@example.org" }
    }
  }
]
```

### GET /contexts/examples-v2.jsonld

Returns a static copy of the W3C `https://www.w3.org/ns/credentials/examples/v2` context (`application/json`), which only defines `@vocab`. In the current code, nothing in the repo references this URL: the playground's own document loader and the Docker context mirror each carry the same content (`apps/server/src/formats/ldp.ts`, `scripts/build-context-mirror.mjs`).

```bash
curl -s localhost:4000/contexts/examples-v2.jsonld
# {"@context":{"@vocab":"https://www.w3.org/ns/credentials/examples#"}}   (live)
```

---

## 3. WebSocket `/ws`

`ws://localhost:4000/ws` (same port as the API; in development also through the Vite proxy on `:5173`). The server **broadcasts every message to every client**:

- There is no subscription or filtering. Filter on `event.runId` or `run.id` yourself.
- Messages the client sends are ignored.
- Nothing is replayed on connect. Load current state with `GET /api/runs` or `GET /api/runs/{id}`, and do so again after a reconnect. The web UI does exactly this (`useOnReconnect`, `apps/web/src/api.ts`).

| Message | When | Payload |
|---|---|---|
| `{"type": "event", "event": ProtocolEvent}` | Each protocol step of any run: outgoing HTTP call, call received from an external wallet, local action, note, error, wait | One timeline entry; the same object ends up in `GET /api/runs/{id}` → `events[]` |
| `{"type": "run", "run": RunSummary}` | Run created, every stage change, run finished | The run's current summary. A message with `state` ≠ `running` is the last one for that run. |

<a id="protocolevent"></a>**ProtocolEvent** (`apps/server/src/events.ts`)

| Field | Type | Meaning |
|---|---|---|
| `id` | UUID | Event id |
| `runId` | string | Run the event belongs to. Calls from external wallets are attributed through the pre-authorized code (directly or via the offer id), access token, or `state` they carry. |
| `ts` | ISO 8601 | When it was recorded |
| `step` | string | Protocol phase, e.g. `OpenID4VCI · Token request (pre-authorized_code)`, `OpenID4VP · Authorization response (direct_post)`, `Report` |
| `kind` | `http` \| `action` \| `note` \| `error` \| `await` | `http`: a request/response pair. `action`: a local step (offer created, credential stored, tamper, verification). `note`: run start, final report, verifier rejected a submission. `error`: failed call or run error. `await`: waiting for a phone wallet or for Inji Verify to receive a presentation. |
| `from`, `to` | `playground` \| `issuer` \| `wallet` \| `verifier` | Arrow direction in the sequence diagram |
| `summary` | string | One line, e.g. `POST /issuer/token → 200` |
| `request` | `{method, url, headers?, body?}`? | For `http`. Form bodies are shown as objects; JSON-valued form fields (`vp_token`, `presentation_submission`) are parsed. `authorization` headers are cut to 24 characters. |
| `response` | `{status, body?, durationMs?}`? | For `http`. Non-JSON bodies come through as strings. |
| `data` | object? | Decoded artefacts. On `http` events, keys are JSON paths into `{request, response}` (e.g. `request.proof.jwt`, `response.credential`), with values `{type: "JWT", header, payload}` or `{type: "SD-JWT", issuerJwt, disclosures, keyBindingJwt}`. On `action`/`note` events: named objects such as `offer`, `presentation_definition`, `outcome`. |

*(illustrative)*

```json
{"type":"event","event":{"id":"9d1e…","runId":"0b6c3e0e-…","ts":"2026-10-26T17:20:03.431Z",
 "step":"OpenID4VCI · Token request (pre-authorized_code)","kind":"http","from":"wallet","to":"issuer",
 "summary":"POST /issuer/token → 200",
 "request":{"method":"POST","url":"http://localhost:4000/issuer/token",
   "headers":{"x-playground-run":"0b6c3e0e-…","content-type":"application/x-www-form-urlencoded"},
   "body":{"grant_type":"urn:ietf:params:oauth:grant-type:pre-authorized_code","pre-authorized_code":"Qm3x…"}},
 "response":{"status":200,"durationMs":3,"body":{"access_token":"…","token_type":"Bearer","expires_in":600,
   "c_nonce":"T0k…","c_nonce_expires_in":300,
   "authorization_details":[{"type":"openid_credential","credential_configuration_id":"PlaygroundIdentity_ldp_vc"}]}}}}

{"type":"run","run":{"id":"0b6c3e0e-…","state":"running","stages":{"issue":{"status":"done","detail":"Ed25519Signature2020"},
 "present":{"status":"running"},"verify":{"status":"pending"}},"expected":"VALID","eventCount":9}}
```

(The `run` message is trimmed; the real one carries every RunSummary field.)

**Minimal client** (browser, or Node 22+, which has a global `WebSocket`):

```js
const ws = new WebSocket('ws://localhost:4000/ws');
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.type === 'event') console.log(`[${msg.event.runId.slice(0, 8)}] ${msg.event.kind} ${msg.event.step} — ${msg.event.summary}`);
  if (msg.type === 'run' && msg.run.state !== 'running') console.log(`run ${msg.run.id}: ${msg.run.result} (verifier said ${msg.run.actual ?? '—'}, expected ${msg.run.expected})`);
};
```

A run started from the API and followed to its verdict is in [use case (a)](#a-start-one-run-and-stream-it).

---

## 4. Reference parties

These two independent implementations are the non-Inji parties in the matrix. Offers and presentation requests are **created only by runs**; there is no endpoint to create one directly. To use them from your own wallet, start a run with `wallet: "inji-wallet-mobile"` and use the run's `interaction.offerUri` and `interaction.authorizationRequestUri`. That works with any wallet that can scan the QR codes, as long as it can reach `PUBLIC_BASE_URL`. State (offers, codes, tokens, requests) lives in memory and is lost on restart.

Calls from a wallet other than the Reference Wallet are recorded on the run's timeline, labelled "(external wallet)". The Reference Wallet sets an internal header, `x-playground-run: <runId>`, so its calls (already traced on the client side) are not logged twice. External clients should not send that header.

### 4.1 Reference Issuer (`/issuer`) — OpenID4VCI draft 13

`apps/server/src/actors/issuer.ts`. Pre-authorized code flow only; request and offer shapes follow draft 13 (`credential_configuration_ids`, `tx_code`, `proof.jwt`). It also offers a `nonce_endpoint` and accepts `credential_configuration_id` / `proofs.jwt[]`, for wallets that follow later drafts. The issuer URL below is `http://localhost:4000/issuer` (= `{PUBLIC_BASE_URL}/issuer`).

| Method | Path | Purpose | Responses |
|---|---|---|---|
| GET | `/issuer/.well-known/openid-credential-issuer` | Credential issuer metadata | 200 |
| GET | `/issuer/.well-known/oauth-authorization-server` | Authorization server metadata (the issuer is its own AS) | 200 |
| GET | `/issuer/.well-known/openid-configuration` | Same document as above (OIDC-style fallback) | 200 |
| GET | `/issuer/.well-known/jwt-vc-issuer` | JWT VC Issuer Metadata: the ES256 key that signs SD-JWT VCs | 200 |
| GET | `/issuer/offers/{offerId}` | Credential offer by reference (`credential_offer_uri` target) | 200 offer · 404 `{"error":"not_found"}` |
| POST | `/issuer/token` | Pre-authorized code → access token + `c_nonce` | 200 · 400 |
| POST | `/issuer/nonce` | Fresh `c_nonce` | 200 |
| POST | `/issuer/credential` | Issue the credential (Bearer + proof JWT) | 200 · 400 · 401 · 500 |

**Credential configurations**

| Configuration id | `format` | Holder binding | Signing |
|---|---|---|---|
| `PlaygroundIdentity_ldp_vc` | `ldp_vc` | `credentialSubject.id` = holder DID (`did:key` / `did:jwk`) | Ed25519Signature2020, issuer `did:key` |
| `PlaygroundIdentity_sd_jwt` | `vc+sd-jwt` (`vct` `urn:inji-playground:PlaygroundIdentityCredential`) | `cnf.jwk` | ES256; header `x5c` = [document-signer cert, root] (gap V4) |
| `PlaygroundMDL_mso_mdoc` | `mso_mdoc` (`org.iso.18013.5.1.mDL`) | mdoc device key | ES256 (COSE), issuer certificate from the same PKI |

Every credential carries the same fictional subject (`fullName`, `dateOfBirth`, `nationality`, `documentNumber`, `email`; mDL: `family_name`, `given_name`, `birth_date`, `issuing_country`, `document_number`, `driving_privileges`). It is valid from now for 365 days, or, for `expired` runs, from 400 days ago until 35 days ago.

**Metadata** *(live, trimmed to one configuration)*

```bash
curl -s localhost:4000/issuer/.well-known/openid-credential-issuer
```

```json
{
  "credential_issuer": "http://localhost:4000/issuer",
  "authorization_servers": ["http://localhost:4000/issuer"],
  "credential_endpoint": "http://localhost:4000/issuer/credential",
  "nonce_endpoint": "http://localhost:4000/issuer/nonce",
  "display": [{ "name": "Inji Interop Playground Issuer", "locale": "en" }],
  "credential_configurations_supported": {
    "PlaygroundIdentity_sd_jwt": {
      "format": "vc+sd-jwt", "scope": "playground_identity_sd_jwt", "vct": "urn:inji-playground:PlaygroundIdentityCredential",
      "cryptographic_binding_methods_supported": ["jwk"], "credential_signing_alg_values_supported": ["ES256"],
      "proof_types_supported": { "jwt": { "proof_signing_alg_values_supported": ["ES256"] } },
      "claims": { "fullName": { "display": [{ "name": "fullName", "locale": "en" }] } }
    }
  }
}
```

```bash
curl -s localhost:4000/issuer/.well-known/oauth-authorization-server   # (live)
# {"issuer":"http://localhost:4000/issuer","token_endpoint":"http://localhost:4000/issuer/token",
#  "grant_types_supported":["urn:ietf:params:oauth:grant-type:pre-authorized_code"],
#  "pre-authorized_grant_anonymous_access_supported":true,"response_types_supported":["token"]}
```

**Credential offer** (`GET /issuer/offers/{offerId}`). The run's `offerUri` is `openid-credential-offer://?credential_offer_uri=<url-encoded http://localhost:4000/issuer/offers/{offerId}>`.

```json
{
  "credential_issuer": "http://localhost:4000/issuer",
  "credential_configuration_ids": ["PlaygroundIdentity_sd_jwt"],
  "grants": { "urn:ietf:params:oauth:grant-type:pre-authorized_code": {
    "pre-authorized_code": "Qm3x…",
    "tx_code": { "input_mode": "numeric", "length": 6, "description": "PIN shown in the playground" } } }
}
```

`tx_code` is only present when the run set `txCode: true`.

**POST /issuer/token**: `application/x-www-form-urlencoded` (JSON also accepted).

| Field | Required | Check |
|---|---|---|
| `grant_type` | yes | Must be `urn:ietf:params:oauth:grant-type:pre-authorized_code`, else `400 unsupported_grant_type` |
| `pre-authorized_code` | yes | Known and unused, else `400 invalid_grant` "unknown or already used pre-authorized_code" |
| `tx_code` | if offered | Must match, else `400 invalid_grant` "tx_code mismatch". (`user_pin` is ignored.) |

200: `{"access_token", "token_type": "Bearer", "expires_in": 600, "c_nonce", "c_nonce_expires_in": 300, "authorization_details": [{"type": "openid_credential", "credential_configuration_id"}]}`

**POST /issuer/nonce**: optional `Authorization: Bearer <access_token>`. Always returns `200 {"c_nonce": "…"}`. With a valid token, that nonce replaces the token's current `c_nonce`; without one, it is bound to nothing.

**POST /issuer/credential**: `Authorization: Bearer <access_token>`, JSON body. What the Reference Wallet sends:

```json
{
  "format": "ldp_vc",
  "credential_definition": { "@context": ["https://www.w3.org/2018/credentials/v1", "https://w3id.org/security/suites/ed25519-2020/v1"],
                             "type": ["VerifiableCredential", "PlaygroundIdentityCredential"] },
  "proof": { "proof_type": "jwt", "jwt": "<header {alg, typ:'openid4vci-proof+jwt', kid|jwk}>.<payload {aud, iat, nonce}>.<sig>" }
}
```

| Check (in order) | Failure |
|---|---|
| Bearer token known | `401 {"error":"invalid_token"}` |
| Requested format (`format`, or the format of `credential_configuration_id`, or the token's own) equals the token's configuration | `400 unsupported_credential_format` |
| `proof.jwt` or `proofs.jwt[0]` present | `400 invalid_proof` "proof.jwt required" |
| Proof JWT: `typ`, key (`jwk` or `kid` as did:jwk / Ed25519 did:key), signature, `aud`, `nonce` ([section 1](#reference-issuer-openid4vci-pre-authorized-code)) | `400 {"error":"invalid_proof","error_description":"…","c_nonce":"<fresh>","c_nonce_expires_in":300}` |
| Issuance | `500 {"error":"server_error","error_description":"…"}` |

200: `{"credential": <JSON-LD object | SD-JWT string | base64url mdoc>, "format": "…", "c_nonce": "<fresh>", "c_nonce_expires_in": 300}`. `credential_definition`, `vct` and `doctype` in the request are not compared; only the format is.

### 4.2 Reference Verifier (`/verifier`) — OpenID4VP draft 21

`apps/server/src/actors/verifier.ts`. `response_type=vp_token`, `response_mode=direct_post`, `client_id_scheme=redirect_uri`, and a DIF Presentation Exchange 2.0 `presentation_definition` (`apps/server/src/actors/presentation-definition.ts`).

**Authorization request.** Runs hand the wallet a by-value request whose presentation definition is passed by reference (the run's `interaction.authorizationRequestUri`, also in the `OpenID4VP · Authorization request` event):

```
openid4vp://authorize?response_type=vp_token
  &client_id=http://localhost:4000/verifier/response
  &client_id_scheme=redirect_uri
  &response_mode=direct_post
  &response_uri=http://localhost:4000/verifier/response
  &nonce=<16 random bytes, base64url>
  &state=<12 random bytes, base64url>
  &client_metadata={"client_name":"Inji Interop Playground Verifier","vp_formats":{…}}
  &presentation_definition_uri=http://localhost:4000/verifier/requests/{requestId}/presentation-definition
```

(Shown unencoded and on several lines for readability.)

| Method | Path | Purpose | Responses |
|---|---|---|---|
| GET | `/verifier/requests/{requestId}/presentation-definition` | The request's presentation definition (JSON) | 200 · 404 `{"error":"not_found"}` |
| GET | `/verifier/requests/{requestId}/object` | Request object by reference: unsigned JWT (`alg: none`, `typ: oauth-authz-req+jwt`), `Content-Type: application/oauth-authz-req+jwt`. Runs do not currently use the by-reference form (`createPlaygroundVpRequest` is never called with `byReference`). | 200 · 404 |
| POST | `/verifier/response` | `direct_post` response endpoint | 200 `{}` · 400 |
| GET | `/verifier/requests/{requestId}/result` | Verification outcome for a request | 200 · 404 |

**Presentation definition** per format: `ldp_vc` asks for `$.type` matching the issued credential type (input descriptor `ldp-credential`). `vc+sd-jwt` asks for `$.vct` plus optional `$.fullName` and `$.dateOfBirth`, with `limit_disclosure: required` (input descriptor `sd-jwt-credential`); the Reference Wallet discloses only those two claims. `mso_mdoc` asks for `family_name`, `given_name`, `birth_date` and `document_number` in `org.iso.18013.5.1` (input descriptor = doctype).

**POST /verifier/response**: `application/x-www-form-urlencoded` (max 2 MB; JSON also parsed).

| Field | Meaning |
|---|---|
| `state` | Must match an open request, else `400 invalid_request` "unknown state". A second response for the same request gets `400 invalid_request` "response already received for this request". |
| `vp_token` | `ldp_vp` JSON (string), SD-JWT+KB-JWT compact string, or base64url mdoc DeviceResponse |
| `presentation_submission` | JSON string |
| `mdoc_generated_nonce` | mdoc only. Sent as a form field because `direct_post` has no JWE `apu`. |
| `error`, `error_description` | Wallet-side error; recorded as an INVALID outcome |

The endpoint answers `200 {}` whenever the request is known, **including when verification fails**. Read the verdict from `/result` (or from the run).

**GET /verifier/requests/{requestId}/result** → `{"status": "PENDING"}` or `{"status": "COMPLETED", "outcome": {"status": "VALID|INVALID|EXPIRED", "checks": [...], "claims": {...}}}`. Runs don't call it; they wait on the result in-process. It exists for external callers.

**What it validates** (each check appears in `outcome.checks`):

| Format | Checks |
|---|---|
| All | Wallet did not return `error`; `vp_token` present; `presentation_submission.definition_id` equals this definition's id; `descriptor_map[0].id` equals the input descriptor id |
| `ldp_vc` | `vp_token` is an `ldp_vp` with `verifiableCredential`; descriptor format `ldp_vp`/`ldp_vc`; **issuer proof** (credential signature); **holder proof**: VP signature with `challenge` = nonce and `domain` = client_id (replay → fails); **holder is the credential subject**: `credentialSubject.id` without fragment = `vp.holder` (wrong holder → fails); credential `type` includes the requested type. A non-standard `did:key` fragment (gap C3) is accepted and logged as its own check. |
| `vc+sd-jwt` | `vp_token` is a string; descriptor format `vc+sd-jwt`/`dc+sd-jwt`; **issuer signature**, with the key from header `jwk`, `x5c`, `kid`/`iss` as did:jwk or did:web, or `https` `iss` → `/.well-known/jwt-vc-issuer`; every disclosure matches an `_sd` digest; **KB-JWT required**: `typ: kb+jwt`, signed by `cnf.jwk` (or `cnf.kid` DID), `sd_hash`, `nonce`, `aud`; `vct` equals the requested `vct`; selective-disclosure note (lists the disclosed claims). |
| `mso_mdoc` | `vp_token` is a string; descriptor format `mso_mdoc`; IssuerAuth (MSO signature + certificate); DeviceAuth over the OpenID4VP SessionTranscript (`mdoc_generated_nonce`, `client_id`, `response_uri`, `nonce`); value-digest integrity |
| Then | If every check passed, a **validity period** check: `EXPIRED` if past expiry, else `VALID`. Any failed check → `INVALID`. So `EXPIRED` always means "authentic but expired". |

---

## 5. Inji APIs used

The playground **calls** these endpoints; it does not re-expose them. Base URLs: `INJI_CERTIFY_URL` (default `http://localhost:8090`) and `INJI_VERIFY_URL` (default `http://localhost:8082`). Upstream API references: [mosip/inji-certify](https://github.com/mosip/inji-certify), [mosip/inji-verify](https://github.com/mosip/inji-verify). Field meanings beyond what is listed here: see upstream.

| Service | Method | Path | Used for | Where in code |
|---|---|---|---|---|
| Certify | GET | `/.well-known/openid-credential-issuer` (root, via nginx) | Health and bootstrap check (`credential_configurations_supported` keys); issuer metadata during issuance | `adapters/inji-certify.ts` `certifyHealth()`; `actors/wallet.ts` `receiveCredential()` |
| Certify | GET | `/v1/certify/.well-known/did.json` | Health (`id`); derive `did:key:<publicKeyMultibase>` from the `Ed25519VerificationKey2020` method (`z6Mk…`) | `certifyHealth()`, `certifyDidKey()` |
| Certify | GET | `/v1/certify/credential-configurations/{id}` | Does the config exist? (200 with `credentialFormat` → update) | `upsertCertifyConfigs()` |
| Certify | PUT | `/v1/certify/credential-configurations/{id}` | Update `CertifyIdentity_ldp_vc` / `CertifyIdentity_sd_jwt` | `upsertCertifyConfigs()` |
| Certify | POST | `/v1/certify/credential-configurations` | Create them | `upsertCertifyConfigs()` |
| Certify | POST | `/v1/certify/pre-authorized-data` | Create a pre-authorized credential offer for one run | `createCertifyOffer()` |
| Certify | GET | `credential_offer_uri` (as returned) | Resolve the offer | `receiveCredential()` |
| Certify | GET | `/.well-known/oauth-authorization-server` (root, via nginx) | Find `token_endpoint` (not in the issuer metadata) | `receiveCredential()` |
| Certify | POST | `token_endpoint` (live: `/v1/certify/oauth/token`) | Pre-authorized code (+ `tx_code`) → access token | `receiveCredential()` |
| Certify | POST | `credential_endpoint` (live: `/v1/certify/issuance/credential`) | Credential request with proof JWT | `receiveCredential()` |
| Verify | GET | `/v1/verify/actuator/health` | Health (`status == "UP"`) | `adapters/inji-verify.ts` `verifyHealth()` |
| Verify | POST | `/v1/verify/vp-request` | Create an OpenID4VP request | `createInjiVpRequest()` |
| Verify | GET | `presentationDefinitionUri` (if returned, prefixed with `/v1/verify`) | Wallet fetches the definition | `authorizationUri()`; `wallet.ts` `resolveAuthorizationRequest()` |
| Verify | POST | `responseUri` (from `/vp-request`; base `INJI_VP_SUBMISSION_BASE_URL`) | Wallet's `direct_post` (`vp_token`, `presentation_submission`, `state`) | `wallet.ts` `presentCredential()` |
| Verify | GET | `/v1/verify/vp-request/{requestId}/status` | Poll until `VP_SUBMITTED` | `awaitInjiVpResult()` |
| Verify | GET | `/v1/verify/vp-result/{transactionId}` | Fetch the verification result | `awaitInjiVpResult()` |
| Verify | POST | `/v1/verify/vc-verification` | Verify a raw credential (the QR-scan/upload path) | `injiDirectVerify()` |

The two `credential-configurations` calls and the `did.json` derivation run only during bootstrap (`npm run setup`, `./scripts/up.sh` → `apps/server/src/cli/setup.ts`). Everything else runs per run.

### Inji Certify 0.14.0: what we send and read

**`POST /v1/certify/pre-authorized-data`**

```json
{
  "credential_configuration_id": "CertifyIdentity_sd_jwt",
  "claims": { "fullName": "Asha Rao", "dateOfBirth": "1994-03-12", "nationality": "IN", "documentNumber": "PG-4471-2026",
              "email": "asha.rao@example.org", "iat": 1792000000, "exp": 1823536000 },
  "expires_in": 1800,
  "tx_code": "4821"
}
```

- `iat`/`exp` are sent for `vc+sd-jwt` only. Expired runs use now − 400 d and now − 35 d.
- For `ldp_vc`, Certify fills the validity window itself (C8), so only the five subject claims are sent.
- `tx_code` (4 digits) is sent only when the run set `txCode: true`.
- **Read back:** `errors[]`. If non-empty, the run fails with `Inji Certify rejected the offer: <errorCode, …>`.
- **Read back:** `credential_offer_uri`, taken from the top level or from `response.credential_offer_uri`.

**Credential configurations** (`upsertCertifyConfigs`). Body fields: `credentialConfigKeyId`, `vcTemplate` (base64 of a JSON template with `${…}` placeholders), `credentialFormat`, `didUrl` (Certify's own `did:key`), `keyManagerAppId`, `keyManagerRefId`, `signatureAlgo`, `metaDataDisplay`, `displayOrder`, `scope`. For `ldp_vc` also `contextURLs`, `credentialTypes`, `signatureCryptoSuite`, `credentialSubjectDefinition`; for SD-JWT also `sdJwtVct`, `sdClaim`, `sdJwtClaims`.

| `credentialConfigKeyId` | Format | Key (`keyManagerAppId` / `RefId`) | Signature | Type / vct |
|---|---|---|---|---|
| `CertifyIdentity_ldp_vc` | `ldp_vc` | `CERTIFY_VC_SIGN_ED25519` / `ED25519_SIGN` | `EdDSA`, `Ed25519Signature2020` | `CertifyIdentityCredential` (+ examples/v2 `@vocab` context) |
| `CertifyIdentity_sd_jwt` | `vc+sd-jwt` | `CERTIFY_VC_SIGN_EC_R1` / `EC_SECP256R1_SIGN` | `ES256`, all five claims selectively disclosable | `urn:inji-playground:CertifyIdentityCredential` |

**Issuance as a wallet.** The Reference Wallet runs standard OpenID4VCI against Certify. Certify's issuer metadata has no `token_endpoint`, so the wallet reads AS metadata at the issuer root (C6). The token request is form-encoded and carries `tx_code` and `user_pin` when a PIN is set. The proof JWT uses `alg: Ed25519` for `ldp_vc`, because that is the name Certify advertises (C4), and `ES256` for SD-JWT. `c_nonce` is taken from the token response if present (Certify's live metadata advertises no `nonce_endpoint`). If the first credential request gets a 400 carrying a `c_nonce`, the wallet retries once with it.

### Inji Verify 0.16.0: what we send and read

**`POST /v1/verify/vp-request`**: `{"clientId": "inji-interop-playground", "nonce": "<16 random bytes, base64url>", "presentationDefinition": <PD>}`. The non-DID `clientId` makes Inji Verify return `authorizationDetails` by value.

- **Read back:** `transactionId`, `requestId`, and from `authorizationDetails`: `clientId`, `responseMode`, `responseType`, `nonce`, `responseUri`, `presentationDefinitionUri` (or `presentationDefinition`), `clientMetadata.vp_formats`.
- The playground builds the wallet's `openid4vp://authorize?…` URI from `authorizationDetails` itself, the same way `@mosip/react-inji-verify-sdk` does, with `state=<requestId>`.

**`GET /v1/verify/vp-request/{requestId}/status`**: reads `status`.

- The adapter re-polls immediately (no sleep) while the status is `ACTIVE`, up to 60 s, or 10 min for a phone wallet. The compose file sets `INJI_VP_REQUEST_LONG_POLLING_TIMEOUT=20000` for Inji Verify.
- `VP_SUBMITTED` → fetch the result.
- Any other final status, or a timeout → the run ends in **error** (`Inji Verify never received a presentation (request status <status> after <n>s)`), not a verdict. Grading "nothing arrived" as INVALID would turn a wallet or network failure into a PASS for every attack scenario.
- If Inji Verify refuses the wallet's `direct_post` itself (HTTP ≥ 400 at `response_uri`), that refusal is the verdict: `INVALID`, with the check `Verifier accepted the submission: response_uri returned HTTP <status>`, and the playground does not wait for a status.

**`GET /v1/verify/vp-result/{transactionId}`**: reads `vpResultStatus` and `vcResults[].verificationStatus`; on HTTP ≥ 400, reads `errorMessage`/`errorCode`. The verdict mapping:
- `VALID` if `vpResultStatus` is `SUCCESS` and every VC is `SUCCESS`
- `EXPIRED` if every VC is `SUCCESS` or `EXPIRED` and at least one is `EXPIRED`
- `INVALID` otherwise

**`POST /v1/verify/vc-verification`**: the raw credential as the body, `Content-Type: application/vc+ld+json` (JSON-LD) or `application/vc+sd-jwt` (compact SD-JWT). Reads `verificationStatus`: `SUCCESS` → `VALID`, `EXPIRED` → `EXPIRED`, anything else → `INVALID`. For `bad-signature`/`wrong-type` runs the playground tampers with the credential before posting it.

### Quirks we work around

Gap IDs refer to [`docs/INTEROP_GAPS.md`](INTEROP_GAPS.md).

| Gap | Behaviour | What the playground does | Where |
|---|---|---|---|
| **C5** | `/pre-authorized-data` reports failures (`unknown_claims`, `unknown_error`) as **HTTP 200** with `{"response": null, "errors": [{errorCode}]}` | Checks `errors[]` on every 2xx; also accepts `credential_offer_uri` inside `response` | `createCertifyOffer()` |
| **C1** | Stock compose config omits `credentialOfferCache`, so `/pre-authorized-data` fails (surfacing as C5) | Ships a Certify profile with the missing caches | `docker/inji-certify/certify-playground.properties` |
| **C6** | `credential_issuer` is the bare host; stock nginx doesn't map `/.well-known/oauth-authorization-server` at the root | nginx maps it; the wallet discovers `token_endpoint` there (OIDC `openid-configuration` as a fallback) | `docker/inji-certify/nginx.conf`, `receiveCredential()` |
| **C4** | Certify advertises proof alg `Ed25519`, not `EdDSA` | Wallet accepts either name and signs with the one advertised | `receiveCredential()` → `makeProof` |
| **C8** | `ldp_vc` validity can't be set by claims; undeclared SD-JWT claims → `unknown_claims` | Sends `iat`/`exp` only for SD-JWT and declares them in `sdJwtClaims`; Certify's `expiredIssuance` is `vc+sd-jwt` only, so `expired` + Certify + `ldp_vc` is rejected at `POST /api/runs` | `inji-certify.ts`, `catalog.ts` |
| **C3, C7** | Non-standard `did:key` fragment in `verificationMethod`; `credentialSubject.id` / `cnf.kid` is a DID URL | Reference Verifier accepts both and records them in `checks` | `actors/verifier.ts`, `formats/sdjwt.ts` |
| **C2, V3** | Both services fetch W3C JSON-LD contexts on every call; HTTP 429 → issuance error / INVALID verdict | Local context mirror for `www.w3.org` and `w3id.org`, trusted only inside the Inji containers; sweeps also retry a failed run once | `docker/context-mirror`, `runMatrix()` |
| **V5** | `did:web` resolution forces https on the default port | Bootstrap switches Certify's issuer to a `did:key` derived from its `did.json` | `certifyDidKey()`, `cli/setup.ts` |
| **V4** | SD-JWT issuer keys are read only from `x5c` | Reference Issuer signs SD-JWT with an `x5c` chain | `actors/issuer.ts` |
| **V7** | Stock `init.sql` makes `vp_token` NOT NULL, so wallet error responses fail | Ships the corrected DDL | `docker/postgres/02-verify.sql` |
| **V8** | `/vc-verification` has no `mso_mdoc` path | `inji-verify-direct` doesn't list `mso_mdoc`; the adapter returns INVALID without calling Verify if asked | `catalog.ts`, `injiDirectVerify()` |
| **V1, V2** | Nonce never checked; no `ldp_vp` holder binding | Not worked around; these are reported. The `replay` / `wrong-holder` scenarios FAIL against `inji-verify`. | `docs/INTEROP_REPORT.md` |
| — | Inji Verify advertises a `response_uri` for the host | `VERIFY_PUBLIC_URL` → `INJI_VP_SUBMISSION_BASE_URL` for phone testing; `URL_REWRITES` when the playground runs in Docker | `docker-compose.yml`, `http.ts` |

---

## 6. Example use cases

### (a) Start one run and stream it

Open the socket first. Buffer messages until the POST returns the run id, because the server broadcasts the first events before the HTTP response arrives. Save as `stream-run.mjs` and run with `node stream-run.mjs` (Node 22+); the same code works in a browser console.

```js
const BASE = 'http://localhost:4000';
const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let runId;
const early = [];
const handle = (msg) => {
  if (msg.type === 'event' && msg.event.runId === runId) {
    const { kind, step, summary } = msg.event;
    console.log(`${kind.padEnd(6)} ${step} — ${summary}`);
  }
  if (msg.type === 'run' && msg.run.id === runId && msg.run.state !== 'running') {
    console.log(`\n${msg.run.result}: verifier said ${msg.run.actual ?? '—'}, expected ${msg.run.expected}`);
    for (const c of msg.run.outcomeChecks ?? []) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
    ws.close();
  }
};
ws.onmessage = (m) => { const msg = JSON.parse(m.data); runId ? handle(msg) : early.push(msg); };

const res = await fetch(`${BASE}/api/runs`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ issuer: 'inji-certify', wallet: 'playground-wallet', verifier: 'inji-verify', format: 'vc+sd-jwt', tamper: 'replay' }),
});
const run = await res.json();
if (!res.ok) throw new Error(run.error);
runId = run.id;
early.splice(0).forEach(handle);
```

Given the latest sweep, this prints the OpenID4VCI and OpenID4VP exchanges and then `FAIL: verifier said VALID, expected INVALID` (gap V1). Afterwards, `curl -s localhost:4000/api/runs/<id>` returns the full timeline with decoded JWTs.

### (b) Run a sweep and download the Markdown report

```bash
# Start a subset (omit the body for all 65 runs). jq is used to pull out batchId.
BATCH=$(curl -s -X POST localhost:4000/api/matrix -H 'content-type: application/json' \
  -d '{"scenarios":["happy","replay","wrong-holder"],"formats":["ldp_vc","vc+sd-jwt"]}' | jq -r .batchId)
echo "sweep $BATCH"

# Wait until no sweep is running (GET /api/matrix returns null)
until [ "$(curl -s localhost:4000/api/matrix)" = "null" ]; do
  curl -s localhost:4000/api/matrix | jq -r '"\(.done)/\(.total)"'; sleep 3
done

# Report for this sweep only
curl -sG localhost:4000/api/report.md --data-urlencode "batch=$BATCH" -o interop-report.md

# Optional: the failed rows as JSON (skipping first attempts that were retried)
curl -s localhost:4000/api/runs | jq --arg b "$BATCH" '
  [ .[] | select(.batchId == $b) ] as $runs
  | ($runs | map(.retryOf) | map(select(.))) as $superseded
  | $runs | map(select((.id as $id | $superseded | index($id) | not) and .result != "PASS"))
  | map({issuer, verifier, format, tamper, actual, error})'
```

If a sweep is already running, the POST returns `409` and `batchId` will be the running sweep's id. Check for `.error` before you use it.

### (c) Headless from CI: `npm run interop`

`apps/server/src/cli/interop.ts` is a thin client over the API above. It runs `POST /api/matrix`, polls `GET /api/matrix` every 1.5 s, reads `GET /api/runs` and `GET /api/report.md?batch=…`, and writes the report.

```bash
./scripts/up.sh                       # Inji Certify + Inji Verify + Postgres + playground, bootstrapped
npm ci
npm run interop                       # full matrix → docs/INTEROP_REPORT.md
npm run interop -- --scenarios happy --formats ldp_vc
npm run interop -- --issuers inji-certify --verifiers inji-verify,inji-verify-direct --out /tmp/report.md
npm run interop -- --strict           # also fail on negative-path (security) findings
npm run interop -- --url http://ci-host:4000   # or PLAYGROUND_URL=…
```

| Option | Meaning |
|---|---|
| `--scenarios`, `--issuers`, `--verifiers`, `--formats` | Comma-separated ids; passed as the `POST /api/matrix` body |
| `--out <path>` | Report path, relative to the repo root (default `docs/INTEROP_REPORT.md`) |
| `--url <base>` | Playground base URL (default `$PLAYGROUND_URL` or `http://localhost:4000`) |
| `--strict` | Exit 1 on **any** failed run, not only happy-path ones |

| Exit code | Meaning |
|---|---|
| 0 | Every happy-path run passed (and, with `--strict`, every run passed) |
| 1 | A happy-path combination failed (interop regression), or any run failed under `--strict` |
| 2 | The sweep could not start (e.g. `409`, a sweep is already running) |

Retried runs are superseded before the exit code is computed, so a pass on retry counts as a pass. `.github/workflows/interop.yml` runs this nightly (02:30 UTC), on pushes to `main` and on demand: `./scripts/up.sh`, then `npm run interop`, then the report is appended to the job summary and uploaded as the `interop-report` artifact. Docker logs are dumped on failure. It runs without `--strict`, so the job fails only on happy-path regressions while the known security findings (V1, V2) stay visible in the report.
