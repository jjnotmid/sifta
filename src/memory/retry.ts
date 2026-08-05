/**
 * Retry transient database failures.
 *
 * Loading the watchlist means tens of thousands of round trips, and against a
 * CockroachDB Cloud cluster on another continent that is minutes of sustained
 * network. A single dropped socket anywhere in that window killed the whole
 * run — the ingest is idempotent, so nothing was corrupted, but the operator
 * had to notice and restart it, and the next drop did the same again.
 *
 * A long job over a long link should expect to be interrupted. Retrying the
 * failed chunk is the difference between an ingest that completes unattended
 * and one that needs babysitting.
 *
 * Only *transient* failures are retried. A constraint violation or a syntax
 * error is not going to succeed on the third attempt, and retrying it would
 * turn a clear error into a slow one.
 */

/** Network and availability failures, plus CockroachDB's retry SQLSTATEs. */
const TRANSIENT = [
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'Connection terminated',
  'connection terminated',
  'server closed the connection',
  'Client has encountered a connection error',
  'timeout exceeded when trying to connect',
  // 40001 serialization failure — CockroachDB asks clients to retry these.
  '40001',
  // 08006 / 08003 connection failure and does-not-exist.
  '08006',
  '08003',
  // 57P01 admin shutdown, e.g. a rolling cluster upgrade.
  '57P01',
];

export function isTransient(err: unknown): boolean {
  if (!err) return false;
  const code = (err as { code?: string }).code;
  if (typeof code === 'string' && TRANSIENT.includes(code)) return true;
  const message = err instanceof Error ? err.message : String(err);
  return TRANSIENT.some((needle) => message.includes(needle));
}

export interface RetryOptions {
  attempts?: number;
  /** Base delay; doubles each attempt. */
  baseDelayMs?: number;
  /** Called before each retry, for progress output. */
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 5;
  const base = options.baseDelayMs ?? 1_000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransient(err) || attempt === attempts) throw err;

      // Exponential backoff with jitter. Without jitter, every concurrent
      // worker retries on the same schedule and re-creates the burst that
      // caused the failure.
      const delay = Math.round(base * 2 ** (attempt - 1) * (0.5 + Math.random()));
      options.onRetry?.(attempt, err, delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
