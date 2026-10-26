/**
 * Retries `fn` until it resolves or `timeoutMs` passes, logging each new failure reason once.
 * Used where a dependency reports "up" before it is fully ready (see cli/setup.ts).
 */
export async function retry<T>(
  name: string,
  fn: () => Promise<T>,
  { timeoutMs = 180_000, intervalMs = 3000, log = console.log }: { timeoutMs?: number; intervalMs?: number; log?: (msg: string) => void } = {},
): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last = '';
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const message = (e as Error).message;
      if (Date.now() + intervalMs > until) throw e;
      if (message !== last) log(`  … waiting for ${name}: ${message}`);
      last = message;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
