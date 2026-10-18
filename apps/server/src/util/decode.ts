/**
 * Best-effort decoding of protocol artefacts embedded in payloads so the inspector can show
 * what a JWT / SD-JWT actually says, not just the opaque compact string.
 */

const JWT_RE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*$/;

export function b64urlJson(part: string): any {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

export function decodeJwt(jwt: string): { header: any; payload: any } | null {
  if (!JWT_RE.test(jwt)) return null;
  try {
    const [h, p] = jwt.split('.');
    return { header: b64urlJson(h), payload: b64urlJson(p) };
  } catch {
    return null;
  }
}

export function decodeSdJwt(value: string) {
  if (!value.includes('~')) return null;
  const parts = value.split('~');
  const issuerJwt = decodeJwt(parts[0]);
  if (!issuerJwt) return null;
  const last = parts[parts.length - 1];
  const kb = last ? decodeJwt(last) : null;
  const disclosureParts = parts.slice(1, kb ? -1 : undefined).filter(Boolean);
  const disclosures = disclosureParts.map((d) => {
    try { return b64urlJson(d); } catch { return d; }
  });
  return { issuerJwt, disclosures, keyBindingJwt: kb };
}

export function decodeArtefacts(root: unknown): Record<string, unknown> | undefined {
  const found: Record<string, unknown> = {};
  const visit = (v: unknown, path: string, depth: number) => {
    if (depth > 6 || v == null) return;
    if (typeof v === 'string') {
      const sd = decodeSdJwt(v);
      if (sd) { found[path] = { type: 'SD-JWT', ...sd }; return; }
      const jwt = decodeJwt(v);
      if (jwt) { found[path] = { type: 'JWT', ...jwt }; return; }
      if (v.startsWith('{') || v.startsWith('[')) {
        try { visit(JSON.parse(v), path, depth + 1); } catch { /* not JSON */ }
      }
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${path}[${i}]`, depth + 1));
    else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, path ? `${path}.${k}` : k, depth + 1);
  };
  visit(root, '', 0);
  return Object.keys(found).length ? found : undefined;
}
