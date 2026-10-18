/**
 * CI-style interoperability sweep against a running playground (default http://localhost:4000).
 *
 *   npm run interop                       # full matrix → docs/INTEROP_REPORT.md
 *   npm run interop -- --scenarios happy   # just the happy path
 *   npm run interop -- --strict            # also fail on negative-path (security) findings
 *
 * Exit code 1 when any happy-path combination fails (a regression in basic interop), or with
 * --strict when any run fails at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const base = (opt('url') ?? process.env.PLAYGROUND_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const out = path.resolve(root, opt('out') ?? 'docs/INTEROP_REPORT.md');
const list = (v?: string) => v?.split(',').map((s) => s.trim()).filter(Boolean);

const body = { scenarios: list(opt('scenarios')), issuers: list(opt('issuers')), verifiers: list(opt('verifiers')), formats: list(opt('formats')) };
const res = await fetch(`${base}/api/matrix`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
if (!res.ok) { console.error(`Could not start sweep: ${res.status} ${await res.text()}`); process.exit(2); }
const { batchId, total } = await res.json() as { batchId: string; total: number };
console.log(`▸ Sweep ${batchId}: ${total} runs against ${base}`);

let last = -1;
for (;;) {
  const p = await (await fetch(`${base}/api/matrix`)).json() as { done: number } | null;
  const done = p?.done ?? total;
  if (done !== last) { process.stdout.write(`\r  ${done}/${total}`); last = done; }
  if (!p) break;
  await new Promise((r) => setTimeout(r, 1500));
}
console.log('');

const batchRuns = (await (await fetch(`${base}/api/runs`)).json() as any[]).filter((r) => r.batchId === batchId);
const retried = new Set(batchRuns.map((r) => r.retryOf).filter(Boolean));
const runs = batchRuns.filter((r) => !retried.has(r.id)); // a retry supersedes its first attempt
const report = await (await fetch(`${base}/api/report.md?batch=${encodeURIComponent(batchId)}`)).text();
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, report);

const failed = runs.filter((r) => r.result !== 'PASS');
const happyFailed = failed.filter((r) => r.tamper === 'none' && !r.expired);
console.log(`▸ ${runs.length - failed.length} pass / ${failed.length} fail — report written to ${path.relative(process.cwd(), out)}`);
for (const r of failed) console.log(`  ✗ ${r.issuer} → ${r.verifier} · ${r.format} · ${r.tamper !== 'none' ? r.tamper : r.expired ? 'expired' : 'happy'}: ${r.error ?? ''}`.slice(0, 220));
if (happyFailed.length || (args.includes('--strict') && failed.length)) process.exit(1);
