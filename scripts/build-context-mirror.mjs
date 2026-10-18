// Writes the JSON-LD contexts the playground's credentials depend on into
// docker/context-mirror/www/<host>/<path>, taken from the canonical npm packages.
// www.w3.org rate-limits context fetches (Cloudflare 429 challenge), and Inji Certify / Inji Verify
// fetch contexts live on every request, so the local stack serves them from this mirror.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps/server/package.json'));
const out = path.join(root, 'docker/context-mirror/www');

const contexts = new Map();
for (const pkg of ['@digitalbazaar/credentials-context', 'ed25519-signature-2020-context', '@digitalbazaar/security-context', 'did-context', '@digitalbazaar/data-integrity-context', '@digitalbazaar/multikey-context']) {
  for (const [url, doc] of require(pkg).contexts) contexts.set(url, doc);
}
contexts.set('https://www.w3.org/ns/credentials/examples/v2', { '@context': { '@vocab': 'https://www.w3.org/ns/credentials/examples#' } });

fs.rmSync(out, { recursive: true, force: true });
for (const [url, doc] of contexts) {
  const u = new URL(url);
  const file = path.join(out, u.host, u.pathname.replace(/\/$/, '/index.jsonld'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  console.log(`  ${url}`);
}
