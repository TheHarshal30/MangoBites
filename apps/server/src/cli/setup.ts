/**
 * One-time bootstrap of the local Inji stack (idempotent):
 *  1. Derive a did:key for Inji Certify's own Ed25519 signing key. did:web would need public HTTPS,
 *     and Inji Verify only resolves did:web over https on the default port.
 *  2. Make Certify use it as the issuer id (CERTIFY_ISSUER_DID in .env → container restart).
 *  3. Register the playground's ldp_vc and SD-JWT credential configurations in Certify.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { certifyDidKey, certifyHealth, upsertCertifyConfigs } from '../adapters/inji-certify.js';
import { verifyHealth } from '../adapters/inji-verify.js';
import { bus, type ProtocolEvent } from '../events.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const envFile = path.join(root, '.env');
const inContainer = process.argv.includes('--no-restart');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(name: string, probe: () => Promise<{ up: boolean; detail: string }>, timeoutMs = 300_000) {
  const until = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < until) {
    const h = await probe();
    if (h.up) return h;
    if (h.detail !== last) console.log(`  … waiting for ${name}: ${h.detail}`);
    last = h.detail;
    await sleep(3000);
  }
  throw new Error(`${name} did not become ready: ${last}`);
}

bus.on('event', (e: ProtocolEvent) => console.log(`  ${e.response && e.response.status >= 400 ? '✗' : '✓'} ${e.step} ${e.response ? `→ ${e.response.status}` : ''}`));

console.log('▸ Waiting for Inji Certify and Inji Verify…');
await waitFor('Inji Certify', certifyHealth);
await waitFor('Inji Verify', verifyHealth);

const did = await certifyDidKey();
const env = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
const current = /^CERTIFY_ISSUER_DID=(.*)$/m.exec(env)?.[1];
if (current !== did) {
  const next = current ? env.replace(/^CERTIFY_ISSUER_DID=.*$/m, `CERTIFY_ISSUER_DID=${did}`) : `${env}${env && !env.endsWith('\n') ? '\n' : ''}CERTIFY_ISSUER_DID=${did}\n`;
  fs.writeFileSync(envFile, next);
  console.log(`▸ Certify issuer DID → ${did} (written to .env)`);
  if (!inContainer) {
    console.log('▸ Restarting Certify with the new issuer DID…');
    execSync('docker compose up -d certify', { cwd: root, stdio: 'inherit' });
    await sleep(5000);
    await waitFor('Inji Certify', certifyHealth);
  }
} else {
  console.log(`▸ Certify issuer DID already ${did}`);
}

console.log('▸ Registering credential configurations in Inji Certify…');
await upsertCertifyConfigs('setup', did);
const h = await certifyHealth();
console.log(`▸ Inji Certify: ${h.detail}`);
console.log(`  configurations: ${h.configs?.join(', ')}`);
