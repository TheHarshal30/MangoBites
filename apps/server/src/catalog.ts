import type { Format } from './actors/presentation-definition.js';

/** Implementations that can play each role. "auto" parties are driven by the playground itself. */

export interface Party {
  id: string;
  role: 'issuer' | 'wallet' | 'verifier';
  name: string;
  vendor: 'Inji' | 'Reference (non-Inji)';
  version: string;
  mode: 'auto' | 'manual';
  formats: Format[];
  protocol: string;
  description: string;
  /** Formats for which the issuer can be made to sign an already-expired credential. */
  expiredIssuance?: Format[];
}

export const FORMATS: Record<Format, { label: string; short: string }> = {
  ldp_vc: { label: 'W3C VC 1.1 · JSON-LD (Ed25519Signature2020)', short: 'JSON-LD' },
  'vc+sd-jwt': { label: 'IETF SD-JWT VC (ES256 + KB-JWT)', short: 'SD-JWT' },
  mso_mdoc: { label: 'ISO 18013-5 mDoc/mDL (mock)', short: 'mDoc' },
};

export const PARTIES: Party[] = [
  {
    id: 'inji-certify', role: 'issuer', name: 'Inji Certify', vendor: 'Inji', version: '0.14.0', mode: 'auto',
    formats: ['ldp_vc', 'vc+sd-jwt'], protocol: 'OpenID4VCI draft 13 · pre-authorized code',
    description: 'Inji Certify in DataProvider mode with PreAuthDataProviderPlugin, acting as its own authorization server (no eSignet).',
    // ldp_vc: Certify fills ${validFrom}/${validUntil} itself and ignores supplied values.
    expiredIssuance: ['vc+sd-jwt'],
  },
  {
    id: 'playground-issuer', role: 'issuer', name: 'Reference Issuer', vendor: 'Reference (non-Inji)', version: 'playground', mode: 'auto',
    formats: ['ldp_vc', 'vc+sd-jwt', 'mso_mdoc'], protocol: 'OpenID4VCI draft 13 · pre-authorized code',
    description: 'Independent OpenID4VCI issuer built on digitalbazaar/vc, jose and @auth0/mdl — the non-Inji party in the matrix.',
    expiredIssuance: ['ldp_vc', 'vc+sd-jwt', 'mso_mdoc'],
  },
  {
    id: 'playground-wallet', role: 'wallet', name: 'Reference Wallet', vendor: 'Reference (non-Inji)', version: 'playground', mode: 'auto',
    formats: ['ldp_vc', 'vc+sd-jwt', 'mso_mdoc'], protocol: 'OpenID4VCI + OpenID4VP (direct_post)',
    description: 'Headless holder driven by the playground. Supports tamper modes for negative-path testing.',
  },
  {
    id: 'inji-wallet-mobile', role: 'wallet', name: 'Inji Wallet (mobile)', vendor: 'Inji', version: '≥0.20', mode: 'manual',
    formats: ['ldp_vc', 'vc+sd-jwt', 'mso_mdoc'], protocol: 'QR scan · OpenID4VCI + OpenID4VP',
    description: 'Scan the offer and presentation QR codes with the Inji Wallet app. Needs PUBLIC_BASE_URL / VERIFY_PUBLIC_URL reachable from the phone.',
  },
  {
    id: 'inji-verify', role: 'verifier', name: 'Inji Verify · OpenID4VP', vendor: 'Inji', version: '0.16.0', mode: 'auto',
    formats: ['ldp_vc', 'vc+sd-jwt'], protocol: 'OpenID4VP draft 21 · direct_post',
    description: 'Inji Verify verify-service cross-device flow: /vp-request → wallet → /vp-result.',
  },
  {
    id: 'inji-verify-direct', role: 'verifier', name: 'Inji Verify · VC upload', vendor: 'Inji', version: '0.16.0', mode: 'auto',
    formats: ['ldp_vc', 'vc+sd-jwt'], protocol: 'POST /vc-verification',
    description: 'The QR-scan / upload path of Inji Verify: the raw credential is verified without a presentation.',
  },
  {
    id: 'playground-verifier', role: 'verifier', name: 'Reference Verifier', vendor: 'Reference (non-Inji)', version: 'playground', mode: 'auto',
    formats: ['ldp_vc', 'vc+sd-jwt', 'mso_mdoc'], protocol: 'OpenID4VP draft 21 · direct_post',
    description: 'Strict independent relying party: checks issuer proof, holder binding, nonce/audience, submission and expiry.',
  },
];

export const party = (id: string) => PARTIES.find((p) => p.id === id);
