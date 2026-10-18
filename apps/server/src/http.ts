import { emit, type Actor } from './events.js';
import { decodeArtefacts } from './util/decode.js';

export class HttpError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
  }
}

interface TracedRequest {
  runId: string;
  step: string;
  from: Actor;
  to: Actor;
  method?: string;
  url: string;
  headers?: Record<string, string>;
  /** Object → JSON; URLSearchParams → form-encoded; string → sent as-is. */
  body?: unknown;
  /** Return non-2xx responses instead of throwing (negative-path tests want the body). */
  allowError?: boolean;
}

/** fetch() that records the full request/response pair on the run's protocol timeline. */
export async function traced<T = any>(req: TracedRequest): Promise<{ status: number; body: T; headers: Headers }> {
  const method = req.method ?? (req.body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = { ...(req.headers ?? {}) };
  let payload: string | undefined;
  let loggedBody: unknown = req.body;
  if (req.body instanceof URLSearchParams) {
    headers['content-type'] ??= 'application/x-www-form-urlencoded';
    payload = req.body.toString();
    loggedBody = Object.fromEntries(req.body.entries());
  } else if (typeof req.body === 'string') {
    payload = req.body;
  } else if (req.body !== undefined) {
    headers['content-type'] ??= 'application/json';
    payload = JSON.stringify(req.body);
  }

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(rewrite(req.url), { method, headers, body: payload, signal: AbortSignal.timeout(30_000) });
  } catch (err: any) {
    const cause = err?.cause?.code ?? err?.cause?.message ?? err?.message;
    emit({
      runId: req.runId, step: req.step, kind: 'error', from: req.from, to: req.to,
      summary: `${method} ${req.url} failed: ${cause}`,
      request: { method, url: req.url, headers: redact(headers), body: loggedBody },
    });
    throw new HttpError(`${method} ${req.url} unreachable (${cause})`, 0, null);
  }
  const text = await res.text();
  let body: any = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }

  emit({
    runId: req.runId, step: req.step, kind: 'http', from: req.from, to: req.to,
    summary: `${method} ${new URL(req.url).pathname} → ${res.status}`,
    request: { method, url: req.url, headers: redact(headers), body: loggedBody },
    response: { status: res.status, body, durationMs: Date.now() - started },
    data: decodeArtefacts({ request: loggedBody, response: body }),
  });

  if (!res.ok && !req.allowError) {
    const detail = typeof body === 'object' && body ? (body.error_description ?? body.error ?? body.message ?? JSON.stringify(body)) : String(body).slice(0, 300);
    throw new HttpError(`${method} ${new URL(req.url).pathname} returned ${res.status}: ${detail}`, res.status, body);
  }
  return { status: res.status, body, headers: res.headers };
}

/**
 * URL_REWRITES="http://localhost:8090=http://certify-nginx:8090,…" lets the containerised
 * playground follow URLs that Inji services advertise for the host (logged unchanged).
 */
const REWRITES = (process.env.URL_REWRITES ?? '').split(',').filter(Boolean).map((pair) => pair.split('=') as [string, string]);

export function rewrite(url: string) {
  for (const [from, to] of REWRITES) if (url.startsWith(from)) return to + url.slice(from.length);
  return url;
}

function redact(h: Record<string, string>) {
  const out = { ...h };
  if (out.authorization) out.authorization = out.authorization.slice(0, 24) + '…';
  return out;
}
