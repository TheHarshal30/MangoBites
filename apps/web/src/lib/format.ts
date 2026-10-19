import { useEffect, useState } from 'react';

export const formatDuration = (ms?: number) =>
  ms == null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'long' });

/** "just now", "5 minutes ago", "yesterday", then a short date after a week. */
export function relativeTime(iso: string, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const s = Math.round((t - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return 'just now';
  if (abs < 90) return rtf.format(Math.sign(s), 'minute');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 7 * 86_400) return rtf.format(Math.round(s / 86_400), 'day');
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export const absoluteTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Re-renders the caller periodically so relative timestamps stay fresh. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export const shortId = (id: string) => id.slice(0, 8);

/**
 * Human title for a credential type: `urn:inji-playground:CertifyIdentityCredential` →
 * "Certify Identity Credential", `org.iso.18013.5.1.mDL` → "Mobile Driving Licence".
 */
export function humanizeType(raw?: string) {
  if (!raw) return 'Credential';
  if (/\.mDL$/i.test(raw) || raw === 'mDL') return 'Mobile Driving Licence';
  const last = raw.split(/[:/#]/).filter(Boolean).pop() ?? raw;
  return last
    .replace(/_(ldp_vc|sd_jwt|mso_mdoc)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

/** `dateOfBirth` → "Date of birth", `given_name` → "Given name". */
export function humanizeKey(key: string) {
  const s = key.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatClaimValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x !== 'object')) return v.join(', ');
  return JSON.stringify(v);
}

export const pluralize = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
