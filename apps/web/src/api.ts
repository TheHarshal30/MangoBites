import { useEffect, useRef, useState } from 'react';

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
  credential?: { format: Format; summary: Record<string, unknown> };
  interaction?: { offerUri?: string; txCode?: string; authorizationRequestUri?: string; prompt?: string };
  outcomeChecks?: Check[];
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
  clearRuns: () => fetch('/api/runs', { method: 'DELETE' }),
  wallet: () => fetch('/api/wallet').then((r) => json<any[]>(r)),
};

type Listener = (msg: { type: 'event'; event: ProtocolEvent } | { type: 'run'; run: RunSummary }) => void;
const listeners = new Set<Listener>();
let socket: WebSocket | undefined;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  socket.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    for (const l of listeners) l(msg);
  };
  socket.onclose = () => setTimeout(connect, 1500);
}

export function useLive(listener: Listener) {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => {
    if (!socket) connect();
    const l: Listener = (m) => ref.current(m);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
}

/** All run summaries, kept current over the WebSocket. */
export function useRuns() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  useEffect(() => { api.runs().then(setRuns).catch(() => {}); }, []);
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
  return [runs, setRuns] as const;
}

export const scenarioLabel = (r: Pick<RunSummary, 'tamper' | 'expired'>, cat?: Catalog | null) =>
  r.tamper !== 'none' ? (cat?.tamperModes[r.tamper]?.label ?? r.tamper) : r.expired ? 'Expired credential' : 'Happy path';

/** Drops first attempts that a sweep re-ran (the retry supersedes them). */
export function withoutSuperseded<T extends { id: string; retryOf?: string }>(runs: T[]): T[] {
  const superseded = new Set(runs.map((r) => r.retryOf).filter(Boolean));
  return runs.filter((r) => !superseded.has(r.id));
}

export const formatDuration = (ms?: number) => (ms == null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
