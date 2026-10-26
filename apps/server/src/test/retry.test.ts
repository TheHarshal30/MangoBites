import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retry } from '../util/retry.js';

// Mirrors the bring-up race in cli/setup.ts: Certify serves its DID document a moment before the
// Ed25519 key is in it, so the first reads fail and a later one succeeds.
test('retry: keeps trying until the dependency is ready, logging each distinct reason once', async () => {
  let calls = 0;
  const logs: string[] = [];
  const value = await retry('key', async () => {
    calls++;
    if (calls < 3) throw new Error('Certify DID document has no Ed25519VerificationKey2020 key');
    return 'did:key:z6Mk…';
  }, { intervalMs: 5, log: (m) => logs.push(m) });
  assert.equal(value, 'did:key:z6Mk…');
  assert.equal(calls, 3);
  assert.equal(logs.length, 1);
});

test('retry: gives up after the timeout with the last error', async () => {
  await assert.rejects(
    retry('key', async () => { throw new Error('still missing'); }, { timeoutMs: 30, intervalMs: 5, log: () => {} }),
    /still missing/,
  );
});
