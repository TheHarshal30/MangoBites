import { INJI_CERTIFY_URL } from '../config.js';
import { traced } from '../http.js';
import { rewrite } from '../http.js';
import type { Format } from '../actors/presentation-definition.js';

/**
 * Inji Certify 0.14 in DataProvider mode with PreAuthDataProviderPlugin: the playground pushes
 * the subject's claims via POST /pre-authorized-data and gets back a standard credential offer.
 */

const API = `${INJI_CERTIFY_URL}/v1/certify`;

export const CERTIFY_VCT = 'urn:inji-playground:CertifyIdentityCredential';
export const CERTIFY_LDP_TYPE = 'CertifyIdentityCredential';
/** W3C-hosted context whose only term is "@vocab" — defines every custom claim, no hosting needed. */
export const EXAMPLES_V2_CONTEXT = 'https://www.w3.org/ns/credentials/examples/v2';

export const CERTIFY_CONFIG_IDS: Partial<Record<Format, string>> = {
  ldp_vc: 'CertifyIdentity_ldp_vc',
  'vc+sd-jwt': 'CertifyIdentity_sd_jwt',
};

const SUBJECT_FIELDS = ['fullName', 'dateOfBirth', 'nationality', 'documentNumber', 'email'] as const;
const display = (name: string, bg: string) => [{
  name, locale: 'en', text_color: '#FFFFFF', background_color: bg,
  logo: { url: 'https://mosip.github.io/inji-config/logos/mosipid-logo.png', alt_text: 'MOSIP logo' },
  background_image: { uri: 'https://mosip.github.io/inji-config/vcbackground/default-background.png' },
}];
const subjectDefinition = Object.fromEntries(SUBJECT_FIELDS.map((f) => [f, { display: [{ name: f, locale: 'en' }] }]));
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o, null, 2).replace(/"\$\{(iat|exp)\}"/g, '${$1}')).toString('base64');

function ldpConfig(didUrl: string) {
  const template = {
    '@context': ['https://www.w3.org/2018/credentials/v1', 'https://w3id.org/security/suites/ed25519-2020/v1', EXAMPLES_V2_CONTEXT],
    issuer: '${_issuer}',
    type: ['VerifiableCredential', CERTIFY_LDP_TYPE],
    issuanceDate: '${validFrom}',
    expirationDate: '${validUntil}',
    credentialSubject: { id: '${_holderId}', ...Object.fromEntries(SUBJECT_FIELDS.map((f) => [f, `\${${f}}`])) },
  };
  return {
    credentialConfigKeyId: CERTIFY_CONFIG_IDS.ldp_vc,
    vcTemplate: b64(template),
    contextURLs: template['@context'],
    credentialTypes: template.type,
    credentialFormat: 'ldp_vc',
    didUrl,
    keyManagerAppId: 'CERTIFY_VC_SIGN_ED25519',
    keyManagerRefId: 'ED25519_SIGN',
    signatureAlgo: 'EdDSA',
    signatureCryptoSuite: 'Ed25519Signature2020',
    metaDataDisplay: display('Certify Identity (JSON-LD)', '#12107c'),
    displayOrder: [...SUBJECT_FIELDS],
    scope: 'playground_certify_identity_ldp',
    credentialSubjectDefinition: { ...subjectDefinition, validFrom: { display: [{ name: 'Valid from', locale: 'en' }] }, validUntil: { display: [{ name: 'Valid until', locale: 'en' }] } },
  };
}

function sdJwtConfig(didUrl: string) {
  const template = {
    vct: CERTIFY_VCT,
    iss: '${_issuer}',
    iat: '${iat}',
    exp: '${exp}',
    cnf: { kid: '${_holderId}' },
    ...Object.fromEntries(SUBJECT_FIELDS.map((f) => [f, `\${${f}}`])),
  };
  return {
    credentialConfigKeyId: CERTIFY_CONFIG_IDS['vc+sd-jwt'],
    vcTemplate: b64(template),
    credentialFormat: 'vc+sd-jwt',
    sdJwtVct: CERTIFY_VCT,
    didUrl,
    keyManagerAppId: 'CERTIFY_VC_SIGN_EC_R1',
    keyManagerRefId: 'EC_SECP256R1_SIGN',
    signatureAlgo: 'ES256',
    sdClaim: SUBJECT_FIELDS.map((f) => `$.${f}`).join(','),
    metaDataDisplay: display('Certify Identity (SD-JWT)', '#7c1012'),
    displayOrder: [...SUBJECT_FIELDS],
    scope: 'playground_certify_identity_sd_jwt',
    // Certify rejects pre-auth claims that are not declared here, so the validity window
    // (fed into the template as iat/exp) must be declared as claims too.
    sdJwtClaims: { ...subjectDefinition, iat: { display: [{ name: 'Issued at', locale: 'en' }] }, exp: { display: [{ name: 'Expires', locale: 'en' }] } },
  };
}

export async function certifyHealth(): Promise<{ up: boolean; detail: string; issuerDid?: string; configs?: string[] }> {
  try {
    const meta: any = await (await fetch(rewrite(`${INJI_CERTIFY_URL}/.well-known/openid-credential-issuer`), { signal: AbortSignal.timeout(4000) })).json();
    const did: any = await (await fetch(rewrite(`${API}/.well-known/did.json`), { signal: AbortSignal.timeout(4000) })).json();
    const configs = Object.keys(meta.credential_configurations_supported ?? {});
    const missing = Object.values(CERTIFY_CONFIG_IDS).filter((id) => !configs.includes(id!));
    return {
      up: true, issuerDid: did.id, configs,
      detail: missing.length ? `running, but not bootstrapped (missing ${missing.join(', ')}) — run "npm run setup"` : `ready · issuer ${did.id}`,
    };
  } catch (e: any) {
    return { up: false, detail: `unreachable at ${INJI_CERTIFY_URL} (${e.cause?.code ?? e.message}) — run "docker compose up -d"` };
  }
}

/** did:key for Certify's own Ed25519 signing key, derived from its did:web document. */
export async function certifyDidKey(): Promise<string> {
  const doc: any = await (await fetch(rewrite(`${API}/.well-known/did.json`))).json();
  const vm = (doc.verificationMethod ?? []).find((m: any) => m.type === 'Ed25519VerificationKey2020' && m.publicKeyMultibase?.startsWith('z6Mk'));
  if (!vm) throw new Error('Certify DID document has no Ed25519VerificationKey2020 key');
  return `did:key:${vm.publicKeyMultibase}`;
}

/** Creates (or replaces) the playground's credential configurations in Certify (keyed by credentialConfigKeyId). */
export async function upsertCertifyConfigs(runId: string, didUrl: string) {
  for (const cfg of [ldpConfig(didUrl), sdJwtConfig(didUrl)]) {
    const url = `${API}/credential-configurations/${cfg.credentialConfigKeyId}`;
    const existing = await traced({ runId, step: `Setup · Look up ${cfg.credentialConfigKeyId}`, from: 'playground', to: 'issuer', url, allowError: true });
    if (existing.status === 200 && existing.body?.credentialFormat) {
      await traced({ runId, step: `Setup · Update ${cfg.credentialConfigKeyId}`, from: 'playground', to: 'issuer', method: 'PUT', url, body: cfg });
    } else {
      await traced({ runId, step: `Setup · Create ${cfg.credentialConfigKeyId}`, from: 'playground', to: 'issuer', url: `${API}/credential-configurations`, body: cfg });
    }
  }
}

export async function createCertifyOffer(runId: string, format: Format, opts: { txCode?: boolean; expired?: boolean }) {
  const configId = CERTIFY_CONFIG_IDS[format];
  if (!configId) throw new Error(`Inji Certify (DataProvider mode) does not issue ${format} in this setup`);
  const now = Date.now();
  const from = opts.expired ? new Date(now - 400 * 86_400_000) : new Date(now);
  const until = opts.expired ? new Date(now - 35 * 86_400_000) : new Date(now + 365 * 86_400_000);
  const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, 'Z');
  const txCode = opts.txCode ? String(Math.floor(1000 + Math.random() * 9000)) : undefined;
  const subject = { fullName: 'Asha Rao', dateOfBirth: '1994-03-12', nationality: 'IN', documentNumber: 'PG-4471-2026', email: 'asha.rao@example.org' };
  const claims: Record<string, unknown> = format === 'ldp_vc'
    ? { ...subject, validFrom: iso(from), validUntil: iso(until) }
    : { ...subject, iat: Math.floor(from.getTime() / 1000), exp: Math.floor(until.getTime() / 1000) };
  const res = await traced({
    runId, step: 'OpenID4VCI · Create offer (Inji Certify /pre-authorized-data)', from: 'playground', to: 'issuer',
    url: `${API}/pre-authorized-data`,
    body: { credential_configuration_id: configId, claims, expires_in: 1800, ...(txCode ? { tx_code: txCode } : {}) },
  });
  // MOSIP services report errors as HTTP 200 with an {errors:[…]} envelope.
  if (res.body?.errors?.length) throw new Error(`Inji Certify rejected the offer: ${res.body.errors.map((e: any) => e.errorCode).join(', ')}`);
  const offerUri = res.body?.credential_offer_uri ?? res.body?.response?.credential_offer_uri;
  if (!offerUri) throw new Error(`Inji Certify returned no credential_offer_uri: ${JSON.stringify(res.body).slice(0, 200)}`);
  return { offerUri: offerUri as string, txCode, configId };
}
