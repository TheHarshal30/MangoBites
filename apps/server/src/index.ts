import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, type WebSocket } from 'ws';
import { PORT, PUBLIC_BASE_URL, WEB_DIST_DIR, INJI_CERTIFY_URL, INJI_VERIFY_URL } from './config.js';
import { bus, type ProtocolEvent } from './events.js';
import { issuerRouter } from './actors/issuer.js';
import { verifierRouter } from './actors/verifier.js';
import { walletCredentials, TAMPER_MODES } from './actors/wallet.js';
import { PARTIES, FORMATS } from './catalog.js';
import { startRun, listRuns, getRun, validateInput, signalManual, runUpdates, deleteRuns, type RunInput } from './runs.js';
import { matrixInputs, runMatrix, markdownReport, SCENARIOS } from './report.js';
import { certifyHealth } from './adapters/inji-certify.js';
import { verifyHealth } from './adapters/inji-verify.js';
import { keys } from './crypto/keys.js';

const app = express();
app.use(cors());
app.use('/issuer', issuerRouter);
app.use('/verifier', verifierRouter);

const api = express.Router();
api.use(express.json({ limit: '2mb' }));

api.get('/catalog', async (_req, res) => {
  const [certify, verify] = await Promise.all([certifyHealth(), verifyHealth()]);
  const health: Record<string, { up: boolean; detail: string }> = {
    'inji-certify': certify,
    'inji-verify': verify,
    'inji-verify-direct': verify,
    'playground-issuer': { up: true, detail: `${PUBLIC_BASE_URL}/issuer` },
    'playground-verifier': { up: true, detail: `${PUBLIC_BASE_URL}/verifier` },
    'playground-wallet': { up: true, detail: 'headless, driven by the playground' },
    'inji-wallet-mobile': { up: true, detail: PUBLIC_BASE_URL.includes('localhost') ? 'set PUBLIC_BASE_URL to a LAN/ngrok URL so a phone can reach the playground' : `phone must reach ${PUBLIC_BASE_URL}` },
  };
  res.json({
    parties: PARTIES.map((p) => ({ ...p, health: health[p.id] })),
    formats: FORMATS,
    tamperModes: TAMPER_MODES,
    scenarios: SCENARIOS,
    endpoints: { playground: PUBLIC_BASE_URL, certify: INJI_CERTIFY_URL, verify: INJI_VERIFY_URL },
  });
});

api.post('/runs', (req, res) => {
  const input = req.body as RunInput;
  const problem = validateInput(input);
  if (problem) return void res.status(400).json({ error: problem });
  res.status(201).json(startRun(input));
});

api.get('/runs', (_req, res) => res.json(listRuns()));
api.delete('/runs', (_req, res) => { deleteRuns(); res.status(204).end(); });

api.get('/runs/:id', (req, res) => {
  const r = getRun(req.params.id);
  if (!r) return void res.status(404).json({ error: 'not found' });
  res.json(r);
});

api.post('/runs/:id/signal', (req, res) => {
  signalManual(req.params.id, 'issued');
  res.status(202).json({ ok: true });
});

let activeMatrix: { batchId: string; total: number; done: number } | undefined;

api.post('/matrix', (req, res) => {
  if (activeMatrix) return void res.status(409).json({ error: 'A matrix sweep is already running', ...activeMatrix });
  const inputs = matrixInputs(req.body ?? {});
  const batchId = `batch-${new Date().toISOString().slice(0, 19)}-${randomUUID().slice(0, 4)}`;
  activeMatrix = { batchId, total: inputs.length, done: 0 };
  runMatrix(inputs, batchId, (done) => { if (activeMatrix) activeMatrix.done = done; })
    .finally(() => { activeMatrix = undefined; });
  res.status(202).json(activeMatrix);
});

api.get('/matrix', (_req, res) => res.json(activeMatrix ?? null));

api.get('/report.md', (req, res) => {
  const batch = req.query.batch as string | undefined;
  const all = listRuns().filter((r) => r.state !== 'running' && (!batch || r.batchId === batch));
  res.type('text/markdown').send(markdownReport(all as any));
});

api.get('/wallet', (_req, res) => res.json(walletCredentials()));

app.use('/api', api);

/** Shared vocab context (copy of https://www.w3.org/ns/credentials/examples/v2) for offline use. */
app.get('/contexts/examples-v2.jsonld', (_req, res) => res.json({ '@context': { '@vocab': 'https://www.w3.org/ns/credentials/examples#' } }));

if (fs.existsSync(WEB_DIST_DIR)) {
  app.use(express.static(WEB_DIST_DIR));
  app.get(/^\/(?!api|issuer|verifier|ws).*/, (_req, res) => res.sendFile(path.join(WEB_DIST_DIR, 'index.html')));
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set<WebSocket>();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});
const broadcast = (msg: unknown) => {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === c.OPEN) c.send(data);
};
bus.on('event', (e: ProtocolEvent) => broadcast({ type: 'event', event: e }));
runUpdates.on('run', (r) => broadcast({ type: 'run', run: r }));

await keys();
server.listen(PORT, () => {
  console.log(`Inji Interop Playground on http://localhost:${PORT}  (public base ${PUBLIC_BASE_URL})`);
  console.log(`  Inji Certify: ${INJI_CERTIFY_URL}   Inji Verify: ${INJI_VERIFY_URL}`);
});
