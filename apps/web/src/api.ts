import { useCallback, useEffect, useRef, useState } from 'react';

export type Format = 'ldp_vc' | 'vc+sd-jwt' | 'mso_mdoc';
export type Tamper = 'none' | 'bad-signature' | 'wrong-type' | 'replay' | 'wrong-holder';
export type Verdict = 'VALID' | 'INVALID' | 'EXPIRED';

export interface Party {
  id: string;
  role: 'issuer' | 'wallet' | 'verifier';
  name: string;
  vendor: string;
  version: string;
  mode: 'auto' | 'manual';
  formats: Format[];
  protocol: string;
  description: string;
  expiredIssuance?: Format[];
  health?: { up: boolean; detail: string };
}

export interface Catalog {
  parties: Party[];
  formats: Record<Format, { label: string; short: string }>;
  tamperModes: Record<Tamper, { label: string; description: string; formats: Format[] }>;
  scenarios: Array<{ id: string; label: string; tamper: Tamper; expired: boolean }>;
  endpoints: Record<string, string>;
}

export interface ProtocolEvent {
  id: string;
  runId: string;
  ts: string;
  step: string;
  kind: 'http' | 'action' | 'note' | 'error' | 'await';
  from: string;
  to: string;
  summary: string;
  request?: { method: string; url: string; headers?: Record<string, string>; body?: unknown };
  response?: { status: number; body?: unknown; durationMs?: number };
  data?: Record<string, unknown>;
}

export interface Check { name: string; ok: boolean; detail?: string }

export interface RunSummary {
  id: string;
  batchId?: string;
  retryOf?: string;
  issuer: string;
  wallet: string;
  verifier: string;
  format: Format;
  tamper: Tamper;
  expired: boolean;
  txCode: boolean;
  createdAt: string;
  finishedAt?: string;
  durationMs?: number;
  state: 'running' | 'completed' | 'error';
  stages: Record<'issue' | 'present' | 'verify', { status: string; detail?: string }>;
  versions: Record<string, string>;
  proofType?: string;
  expected: Verdict;
  actual?: Verdict;
  result?: 'PASS' | 'FAIL';
  error?: string;
  failedStage?: string;
  credential?: { format: Format; summary: CredentialSummary };
  interaction?: { offerUri?: string; txCode?: string; authorizationRequestUri?: string; prompt?: string };
  outcomeChecks?: Check[];
  eventCount?: number;
}

export interface WalletCredential {
  id: string;
  format: Format;
  configId?: string;
  issuer: string;
  receivedAt: string;
  credential: unknown;
  summary?: CredentialSummary;
}

/** Display summary the server derives from a credential (shape varies a little by format). */
export interface CredentialSummary {
  type?: string | string[];
  vct?: string;
  docType?: string;
  issuer?: string;
  expires?: string;
  alg?: string;
  subject?: Record<string, unknown>;
  claims?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface Run extends RunSummary {
  events: ProtocolEvent[];
  outcome?: { status: Verdict; checks: Check[]; claims?: Record<string, unknown>; raw?: unknown };
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  catalog: () => fetch('/api/catalog').then((r) => json<Catalog>(r)),
  runs: () => fetch('/api/runs').then((r) => json<RunSummary[]>(r)),
  run: (id: string) => fetch(`/api/runs/${id}`).then((r) => json<Run>(r)),
  startRun: (input: Partial<RunSummary>) =>
    fetch('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }).then((r) => json<Run>(r)),
  signal: (id: string) => fetch(`/api/runs/${id}/signal`, { method: 'POST' }),
  startMatrix: (body: Record<string, unknown>) =>
    fetch('/api/matrix', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<{ batchId: string; total: number; done: number }>(r)),
  matrix: () => fetch('/api/matrix').then((r) => json<{ batchId: string; total: number; done: number } | null>(r)),
  clearRuns: () => fetch('/api/runs', { method: 'DELETE' }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); }),
  wallet: () => fetch('/api/wallet').then((r) => json<WalletCredential[]>(r)),
};

type LiveMessage = { type: 'event'; event: ProtocolEvent } | { type: 'run'; run: RunSummary };
type Listener = (msg: LiveMessage) => void;
export type ConnectionState = 'connecting' | 'open' | 'closed';

const listeners = new Set<Listener>();
const statusListeners = new Set<(s: ConnectionState) => void>();
let socket: WebSocket | undefined;
let connection: ConnectionState = 'connecting';
let retry = 0;

function setConnection(s: ConnectionState) {
  connection = s;
  for (const l of statusListeners) l(s);
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  setConnection('connecting');
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  socket.onopen = () => { retry = 0; setConnection('open'); };
  socket.onmessage = (m) => {
    let msg: LiveMessage;
    try { msg = JSON.parse(m.data); } catch { return; }
    for (const l of listeners) l(msg);
  };
  socket.onclose = () => {
    setConnection('closed');
    // Back off up to 10 s so a stopped server isn't hammered.
    setTimeout(connect, Math.min(10_000, 1000 * 2 ** retry++));
  };
}

const ensureSocket = () => { if (!socket) connect(); };

export function useLive(listener: Listener) {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => {
    ensureSocket();
    const l: Listener = (m) => ref.current(m);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
}

/** WebSocket state, for the "live updates paused" banner. */
export function useConnection() {
  const [state, setState] = useState<ConnectionState>(connection);
  useEffect(() => {
    ensureSocket();
    setState(connection);
    statusListeners.add(setState);
    return () => { statusListeners.delete(setState); };
  }, []);
  return state;
}

/** Calls `fn` whenever the socket comes back after a drop, to catch up on missed updates. */
export function useOnReconnect(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let wasClosed = false;
    const l = (s: ConnectionState) => {
      if (s === 'closed') wasClosed = true;
      if (s === 'open' && wasClosed) { wasClosed = false; ref.current(); }
    };
    statusListeners.add(l);
    return () => { statusListeners.delete(l); };
  }, []);
}

/** All run summaries, kept current over the WebSocket. */
export function useRuns() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(() => { api.runs().then((r) => { setRuns(r); setLoaded(true); }).catch(() => setLoaded(true)); }, []);
  useEffect(() => { load(); }, []);
  useOnReconnect(load);
  useLive((m) => {
    if (m.type !== 'run') return;
    setRuns((prev) => {
      const i = prev.findIndex((r) => r.id === m.run.id);
      if (i === -1) return [m.run, ...prev];
      const next = prev.slice();
      next[i] = m.run;
      return next;
    });
  });
  return { runs, setRuns, loaded, reload: load };
}

export const scenarioLabel = (r: Pick<RunSummary, 'tamper' | 'expired'>, cat?: Catalog | null) =>
  r.tamper !== 'none' ? (cat?.tamperModes[r.tamper]?.label ?? r.tamper) : r.expired ? 'Expired credential' : 'Happy path';

/** Drops first attempts that a sweep re-ran (the retry supersedes them). */
export function withoutSuperseded<T extends { id: string; retryOf?: string }>(runs: T[]): T[] {
  const superseded = new Set(runs.map((r) => r.retryOf).filter(Boolean));
  return runs.filter((r) => !superseded.has(r.id));
}

export { formatDuration } from './lib/format';
