import { MDL_DOCTYPE, MDL_NAMESPACE } from '../formats/mdoc.js';

export type Format = 'ldp_vc' | 'vc+sd-jwt' | 'mso_mdoc';

/** What the verifier asks for: the credential type (ldp_vc), vct (SD-JWT) or doctype (mdoc). */
export interface Expectation {
  format: Format;
  type?: string;
  vct?: string;
  doctype?: string;
  /** SD-JWT claims to request (selective disclosure); omitted → the wallet discloses everything. */
  claims?: string[];
}

/**
 * DIF Presentation Exchange 2.0 definition for one credential. Filters use `pattern` (like Inji
 * Verify's own templates) so the same definition works against both verifiers.
 */
export function presentationDefinition(exp: Expectation, id = `pd-${exp.format}`) {
  if (exp.format === 'ldp_vc') {
    return {
      id, purpose: 'Inji Interop Playground — present your JSON-LD credential',
      input_descriptors: [{
        id: 'ldp-credential',
        format: { ldp_vc: { proof_type: ['Ed25519Signature2020', 'RsaSignature2018', 'Ed25519Signature2018', 'JsonWebSignature2020'] } },
        constraints: { fields: [{ path: ['$.type'], filter: { type: 'string', pattern: exp.type ?? 'VerifiableCredential' } }] },
      }],
    };
  }
  if (exp.format === 'vc+sd-jwt') {
    return {
      id, purpose: 'Inji Interop Playground — present your SD-JWT VC',
      input_descriptors: [{
        id: 'sd-jwt-credential',
        format: { 'vc+sd-jwt': { 'sd-jwt_alg_values': ['ES256', 'EdDSA', 'RS256', 'PS256'], 'kb-jwt_alg_values': ['ES256', 'EdDSA'] } },
        constraints: {
          limit_disclosure: 'required',
          fields: [
            { path: ['$.vct'], filter: { type: 'string', pattern: exp.vct ?? '.*' } },
            // Selective disclosure demo: ask only for these; the wallet withholds the rest.
            ...(exp.claims ?? []).map((c) => ({ path: [`$.${c}`], optional: true })),
          ],
        },
      }],
    };
  }
  return {
    id, purpose: 'Inji Interop Playground — present your mDL',
    input_descriptors: [{
      id: exp.doctype ?? MDL_DOCTYPE,
      format: { mso_mdoc: { alg: ['ES256', 'EdDSA'] } },
      constraints: {
        limit_disclosure: 'required',
        fields: ['family_name', 'given_name', 'birth_date', 'document_number'].map((f) => ({
          path: [`$['${MDL_NAMESPACE}']['${f}']`], intent_to_retain: false,
        })),
      },
    }],
  };
}

/** Claims a holder is asked to disclose for SD-JWT (top-level claim names from the PD paths). */
export function requestedSdClaims(pd: any): string[] | undefined {
  const fields = pd?.input_descriptors?.[0]?.constraints?.fields ?? [];
  const names: string[] = fields.flatMap((f: any) => f.path).map((p: string) => /^\$\.([A-Za-z_]\w*)$/.exec(p)?.[1]).filter(Boolean);
  const wanted = names.filter((n) => !['vct', 'iss', 'type'].includes(n));
  return wanted.length ? wanted : undefined;
}
