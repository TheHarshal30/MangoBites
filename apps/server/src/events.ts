import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export type Actor = 'playground' | 'issuer' | 'wallet' | 'verifier';

/** One entry on a run's protocol timeline: an HTTP exchange, a local action, or a status note. */
export interface ProtocolEvent {
  id: string;
  runId: string;
  ts: string;
  /** Protocol phase, e.g. "OpenID4VCI · Token request". */
  step: string;
  kind: 'http' | 'action' | 'note' | 'error' | 'await';
  from: Actor;
  to: Actor;
  summary: string;
  request?: { method: string; url: string; headers?: Record<string, string>; body?: unknown };
  response?: { status: number; body?: unknown; durationMs?: number };
  /** Structured, already-decoded artefacts (decoded JWTs, disclosures, credential JSON…). */
  data?: Record<string, unknown>;
}

export const bus = new EventEmitter();
bus.setMaxListeners(100);

/**
 * Exchanges that arrive at the playground's own endpoints (mock issuer/verifier) are attributed
 * to whichever run registered the correlating token (pre-authorized code, state, nonce...).
 */
const correlation = new Map<string, string>();

export function correlate(key: string, runId: string) {
  correlation.set(key, runId);
}

export function runIdFor(key: string | undefined): string | undefined {
  return key ? correlation.get(key) : undefined;
}

export function emit(e: Omit<ProtocolEvent, 'id' | 'ts'>): ProtocolEvent {
  const event: ProtocolEvent = { id: randomUUID(), ts: new Date().toISOString(), ...e };
  bus.emit('event', event);
  return event;
}
