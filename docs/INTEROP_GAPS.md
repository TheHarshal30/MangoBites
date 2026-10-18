# Interoperability gaps found with the playground

Tested: **Inji Certify 0.14.0** (`mosipid/inji-certify-with-plugins`) and **Inji Verify 0.16.0** (`mosipid/inji-verify-service`). They were exercised against each other and against the playground's independent reference issuer, wallet and verifier, which are built on digitalbazaar `vc`, `jose` and `@auth0/mdl`.

Each finding is tagged **observed** (reproduced by a playground run) or **source review** (read in the tagged release's code or config, not reproduced end to end). Each one also has a severity, the evidence for it, and how to reproduce it in the playground. The [Draft GitHub issues](#draft-github-issues) section at the end has text ready to file against `mosip/inji-verify` and `mosip/inji-certify`. **None of these issues have been filed yet**; that needs a GitHub account and the maintainers' templates.

| # | Component | Finding | Severity | Basis |
|---|---|---|---|---|
| V1 | Inji Verify | OpenID4VP `nonce` is never checked, so replayed presentations are accepted | **High** | observed |
| V2 | Inji Verify | No holder binding for `ldp_vp`: a VP signed by any key is accepted | **High** | observed |
| V3 | Inji Verify | JSON-LD contexts are fetched remotely on every verification; a fetch failure becomes an **INVALID** verdict | **High** (operational) | observed |
| V4 | Inji Verify | SD-JWT issuer keys are resolved **only** from `x5c` | Medium | observed¹ |
| V5 | Inji Verify | `did:web` resolution forces `https` and ignores `%3A`-encoded ports | Medium | source review + observed² |
| V6 | Inji Verify | `presentation_submission` is not validated against the presentation definition | Medium | source review |
| V7 | Inji Verify | The stock compose `init.sql` makes `vp_token` / `presentation_submission` NOT NULL, so wallet error responses fail | Low | source review |
| V8 | Inji Verify | `/vc-verification` cannot take `mso_mdoc`, although the vc-verifier library supports it | Low | source review |
| C1 | Inji Certify | The pre-authorized code flow is broken in the stock compose config: `credentialOfferCache not available` | **High** | observed |
| C2 | Inji Certify | JSON-LD contexts are fetched remotely during canonicalization; a W3C rate-limit (HTTP 429) makes issuance fail | **High** (operational) | observed |
| C3 | Inji Certify | `ldp_vc` `verificationMethod` fragment is the keymanager kid, which is not standard for `did:key` | Medium | observed |
| C4 | Inji Certify | Advertises proof alg `Ed25519` instead of the JOSE-registered `EdDSA` | Medium | observed |
| C5 | Inji Certify | `/pre-authorized-data` returns **HTTP 200** with an `errors` envelope on failure | Medium | observed |
| C6 | Inji Certify | `credential_issuer` has no path, and the stock nginx doesn't map `/.well-known/oauth-authorization-server` | Medium | source review (stock nginx config) |
| C7 | Inji Certify | `credentialSubject.id` is the proof `kid` (a DID URL with fragment), not the holder DID | Low | observed |
| C8 | Inji Certify | `ldp_vc` validity can't be set via pre-auth claims: `${validFrom}`/`${validUntil}` are always filled by Certify | Low | observed |
| C9 | Inji Certify | Compose mounts the PKCS12 keystore at `/home/mosip/…` but the 0.14 image writes `/home/inji/…` | Low | source review |

¹ Probed directly: the same SD-JWT gets `SUCCESS` with an `x5c` header, and `INVALID` with only a `did:jwk` `kid` or only a `jwk` header. ² Certify's default `did:web:localhost%3A8090` issuer can't be resolved; the playground switches it to `did:key`.

---

## Inji Verify 0.16.0

### V1 · Replayed presentations are accepted (nonce not verified) — High

The verifier creates a `nonce` for each `/vp-request`, but it never compares that nonce with the one bound into the presentation:
- for `ldp_vp`, the `challenge` in the VP proof
- for SD-JWT, the `nonce` claim of the KB-JWT

`aud` and `domain` are not compared with the client either.

**Evidence:** the playground's *Replay (stale nonce)* scenario binds the presentation to an old, random nonce. Inji Verify returns `vpResultStatus: SUCCESS` for both formats, and for both issuers (Inji Certify and the reference issuer). The reference verifier rejects the same submission:
- for `ldp_vp`: *"Holder proof … challenge"*
- for SD-JWT: *"nonce mismatch … possible replay"*

**Reproduce:** Playground → any issuer → Reference Wallet → *Inji Verify · OpenID4VP* → scenario **Replay**. The result is **FAIL: verifier said VALID**.

**Impact:** anyone who captures a presentation once, for example from logs or a proxy, can replay it to any later Inji Verify session.

### V2 · `ldp_vp` holder binding not enforced — High

A VP whose proof is made with a key that has nothing to do with `credentialSubject.id` is accepted. From source, a VP with **no proof at all** is also accepted, because each VC is then verified on its own (`PresentationVerifier`, see `VerifiablePresentationSubmissionServiceImpl`).

**Evidence:** in the *Wrong holder* scenario, the wallet signs the VP with a freshly generated `did:key`. Inji Verify returns SUCCESS. The reference verifier reports *"Holder is the credential subject ✗"*.

SD-JWT is **not** affected. There, the KB-JWT is checked against `cnf`, and Inji Verify correctly returns INVALID.

### V3 · Network-dependent JSON-LD verification turns into INVALID verdicts — High (operational)

`vc-verifier` loads every `@context` over the network on each verification, including `https://www.w3.org/2018/credentials/v1`. www.w3.org is fronted by Cloudflare and rate-limits these fetches: the playground observed `HTTP/2 429` with `cf-mitigated: challenge`. When a fetch fails, the verifier logs `LOADING_REMOTE_CONTEXT_FAILED` and returns **INVALID**, a forgery verdict for a genuine credential, rather than an error.

**Evidence:** an earlier full sweep had genuine credentials flipping to INVALID during the rate-limited window. The log showed:
`PresentationVerifier : Error while verifying presentation proof: There was a problem encountered loading a remote context [code=LOADING_REMOTE_CONTEXT_FAILED]`

**Suggested fix:**
- Bundle the standard contexts (credentials v1/v2, the security suites, DID v1) with the verifier.
- Cache remote contexts.
- Report fetch failures as an error state, not INVALID.

**Playground mitigation:** `docker/context-mirror` serves these contexts locally to both Inji containers. With it, the sweep is deterministic.

### V4 · SD-JWT issuer key only from `x5c` — Medium

`SdJwtVerifier` reads the issuer key only from the `x5c` header (*"No X.509 certificate found in JWT header"*). It ignores the other mechanisms in SD-JWT VC: `kid` as a DID URL (`did:jwk`, `did:web`) and JWT VC Issuer Metadata (`iss` → `/.well-known/jwt-vc-issuer`). Issuers that use those can't be verified. The reference issuer adds an `x5c` chain specifically so Inji Verify can verify it.

### V5 · `did:web` forced to https on the default port — Medium

`DidWebPublicKeyResolver` builds `https://<host>/<path>/did.json` and does not decode `%3A` port separators. Any `did:web` issuer on a non-standard port, or behind plain HTTP in development, can't be verified. That covers Inji Certify's own default local setup (`did:web:localhost%3A8090`). The playground works around this by switching Certify's issuer to a `did:key` (`npm run setup`).

### V6 · `presentation_submission` not validated — Medium

From source (`isVPTokenMatching`): `definition_id`, `descriptor_map[].id`, `format` and `path` are only checked to be non-empty. The submission is not matched against the presentation definition. Inji Verify's own api-test fixture sends `"path": "$.verifiableCredential[2]"` for a one-element array.

### V7 · Stock DB script breaks wallet error responses — Low

`docker-compose/db-init/init.sql` declares `vp_token VARCHAR NOT NULL` and `presentation_submission text NOT NULL`. When a wallet posts `error=access_denied` (no `vp_token`), the insert fails. The canonical DDL in `db_scripts/inji_verify/ddl/verify-vp_submission.sql` has both columns nullable. The playground ships the corrected script (`docker/postgres/02-verify.sql`).

### V8 · `/vc-verification` has no mdoc path — Low

The format is chosen only from the Content-Type: `application/vc+sd-jwt` and `dc+sd-jwt` give SD-JWT, and anything else is treated as `ldp_vc`. There is no way to submit an `mso_mdoc` credential, even though `vc-verifier` implements mdoc verification.

---

## Inji Certify 0.14.0

### C1 · Pre-authorized code flow fails with the stock compose config — High

`docker-compose/docker-compose-injistack/config/certify-default.properties` sets:

```
mosip.certify.cache.names=userinfo,vcissuance,certificatedatacache,credentialConfig,renderTemplate,jwks,preAuthCodeCache,asMetadataCache
```

`credentialOfferCache` (used by `PreAuthorizedCodeService`) is missing from that list. With `spring.cache.type=simple`, `POST /v1/certify/pre-authorized-data` fails with `IllegalStateException: credentialOfferCache not available`, and the client sees a 200 response with `unknown_error` (see C5). `application-local.properties` has the right list. The playground's profile adds the missing caches (`docker/inji-certify/certify-playground.properties`).

### C2 · Issuance depends on live W3C context fetches — High (operational)

During canonicalization, `CredentialUtils` failed with:

```
JsonLDException: There was a problem encountered loading a remote context [https://www.w3.org/2018/credentials/v1]
```

The wallet then receives `400 Error occurred during canonicalization`. This happened repeatedly under sweep load, while www.w3.org was answering 429. The cause and the suggested fix are the same as V3.

### C3 · Non-standard `did:key` verification method fragment — Medium

`proof.verificationMethod` is built as `didUrl + "#" + <keymanager kid>`, for example `did:key:z6MkiAB…#tiCJZ26qdUO86CWaSDXM1384boUuDuzWeFsE_l-hEDw`. For `did:key`, the only valid fragment is the multibase key fingerprint. Strict resolvers reject the proof. digitalbazaar `vc`/`jsonld-signatures` reports *"Verification method … not authorized by controller for proof purpose assertionMethod"*. The reference verifier accepts it only through an explicit, logged deviation.

### C4 · `Ed25519` advertised as a JOSE proof algorithm — Medium

`mosip.certify.credential-config.proof-types-supported` advertises `{'RS256','PS256','ES256','Ed25519'}`. Wallets that pick an algorithm from metadata and send `EdDSA`, the JOSE-registered name for Ed25519 JWS, are rejected, because the request validator checks `alg` against this list. Related: for `ldp_vc`, `credential_signing_alg_values_supported` is `["EdDSA"]`, not the proof suite (`Ed25519Signature2020`) that OpenID4VCI draft 13 expects for that format.

### C5 · Errors returned with HTTP 200 — Medium

`POST /pre-authorized-data` answers errors such as `unknown_claims` and `unknown_error` with **200** and a body of `{"response": null, "errors": [{errorCode}]}`. Generic clients can't detect the failure from the status code.

### C6 · Authorization-server discovery at the issuer root — Medium

`credential_issuer` and `authorization_servers` are the bare domain (`http://localhost:8090`), while every endpoint lives under `/v1/certify`. A spec-following wallet fetches `<issuer>/.well-known/oauth-authorization-server`. The stock `certify-nginx.conf` maps only `/.well-known/openid-credential-issuer` and `/.well-known/did.json` at the root, so that discovery fails. The playground's nginx adds the mapping.

### C7 · `credentialSubject.id` is a DID URL — Low

The holder id put into `credentialSubject.id` (and into SD-JWT `cnf.kid`) is the proof JWT's `kid` verbatim, including the fragment (`did:key:z6Mk…#z6Mk…`). It should be the holder DID, which identifies the subject rather than one of its keys.

### C8 · `ldp_vc` validity not controllable in pre-auth mode — Low

`${validFrom}`/`${validUntil}` are always filled by Certify, which ignores values supplied as claims, so testers can't issue an already-expired JSON-LD credential. For SD-JWT, the validity window can be passed as declared claims (`iat`/`exp`), but each one has to be declared in `sdJwtClaims`, because undeclared pre-auth claims are rejected with `unknown_claims`.

### C9 · Keystore volume path — Low

The upstream compose mounts `./data/CERTIFY_PKCS12:/home/mosip/CERTIFY_PKCS12`, but the 0.14 image runs from `/home/inji` and writes `/home/inji/CERTIFY_PKCS12/local.p12`. If Postgres is persisted but the container is recreated, the DB key rows point at keys that no longer exist. Separately, `mosip.certify.pre-auth-code.*-expiry-seconds` in the compose file doesn't match the `mosip.certify.pre-auth.*` names the code reads.

---

## What worked out of the box

- **Inji Certify → Inji Verify:** passed for JSON-LD (Ed25519Signature2020) and SD-JWT (ES256, x5c), over both OpenID4VP and the VC-upload API. This needed the issuer to use `did:key` (V5).
- **Cross-ecosystem:** the reference issuer's JSON-LD (inline `@vocab` context) and SD-JWT credentials verify in Inji Verify. Inji Certify's credentials verify in the reference verifier, apart from the logged deviations C3 and C7.
- **Expiry:** Inji Verify returns EXPIRED for expired JSON-LD and SD-JWT credentials with valid signatures.
- **Forgery:** forged claims and rewritten `type`/`vct` are rejected as INVALID.

---

## Draft GitHub issues

### mosip/inji-verify — "OpenID4VP: presentation nonce/audience not verified (replay accepted)"

> **Version:** inji-verify-service 0.16.0
> **Steps:** create a `/vp-request`; submit a `direct_post` whose `vp_token` is an `ldp_vp` with `proof.challenge` ≠ the request nonce (or an SD-JWT whose KB-JWT `nonce` ≠ the request nonce).
> **Expected:** `vpResultStatus: FAILED`.
> **Actual:** `SUCCESS`.
> **Notes:** `domain`/`aud` are not compared with the client_id either. OpenID4VP §7 (draft 21) requires the verifier to check that the presentation is bound to the nonce it issued. Reproducer: Inji Interop Playground, scenario "Replay".

### mosip/inji-verify — "ldp_vp holder proof not bound to credential subject; unsigned VPs accepted"

> A VP signed by a key unrelated to `credentialSubject.id` (or with no `proof`) gets `SUCCESS`. Expected INVALID. Reproducer: playground scenario "Wrong holder", JSON-LD.

### mosip/inji-verify — "Remote @context fetch failures reported as INVALID; bundle W3C contexts"

> Under W3C rate-limiting (`HTTP 429`, Cloudflare challenge), genuine credentials verify as `INVALID`. Request: ship the standard contexts offline, and return an error status rather than INVALID when a context can't be loaded.

### mosip/inji-verify — "SD-JWT: support kid / JWT VC Issuer Metadata key resolution (x5c only today)"

### mosip/inji-verify — "did:web resolver ignores %3A port and forces https"

### mosip/inji-certify — "docker-compose: pre-authorized-data fails with 'credentialOfferCache not available'"

> `certify-default.properties` in `docker-compose-injistack` omits `credentialOfferCache` (and `issuerMetadataCache`) from `mosip.certify.cache.names`. Use the list from `application-local.properties`.

### mosip/inji-certify — "did:key verificationMethod uses keymanager kid as fragment"

> With `didUrl` = `did:key:z6Mk…`, proofs reference `did:key:z6Mk…#<kid>`. did:key requires the fragment to be the key fingerprint. Strict verifiers (digitalbazaar) reject the proof.

### mosip/inji-certify — "proof_signing_alg_values_supported lists 'Ed25519' instead of 'EdDSA'"

### mosip/inji-certify — "pre-authorized-data returns HTTP 200 on errors"
