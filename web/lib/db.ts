import { Pool } from 'pg';

/**
 * Database access for the console.
 *
 * This is a read path. The engine in `src/` owns writes; the one exception is
 * recording an analyst's disposition, which INSERTs into the append-only
 * ledger — and even that is an INSERT, never an UPDATE, because the database
 * grant would reject anything else.
 *
 * The pool is module-scoped and reused across requests. In dev, Next's module
 * reloading would otherwise open a new pool on every edit until the cluster
 * refuses connections, so it is stashed on globalThis.
 *
 * **There is no localhost fallback.** An unset DATABASE_URL used to default to
 * `localhost:26257`, which is correct on a laptop and actively misleading
 * anywhere else: a deployed instance would spend its connection timeout
 * dialling itself before failing with a network error that says nothing about
 * the actual problem. Unset now means "not configured", and the console says
 * so on the page.
 */

const globalForPool = globalThis as unknown as { siftaPool?: Pool };

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new DatabaseUnavailableError('DATABASE_URL is not set.');
  }
  if (!globalForPool.siftaPool) {
    globalForPool.siftaPool = new Pool({
      connectionString,
      // Modest ceiling: the console is one analyst, not a fleet.
      max: 4,
      // Fail fast rather than holding a request open for the OS default.
      connectionTimeoutMillis: 5_000,
    });
    // A pool that emits 'error' with no listener takes the process down.
    globalForPool.siftaPool.on('error', () => {});
  }
  return globalForPool.siftaPool;
}

export class DatabaseUnavailableError extends Error {
  override readonly name = 'DatabaseUnavailableError';
}

export async function query<T extends object>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const { rows } = await getPool().query<T>(sql, params as unknown[]);
  return rows;
}

/**
 * Run a query, or report that the database is unreachable.
 *
 * Every read in the console goes through this. A missing or unreachable
 * cluster renders an explanatory panel instead of a 500 — the marketing page
 * and the shell stay up, and the reason is stated on screen rather than left
 * in a server log the reader cannot see.
 */
export async function tryQuery<T extends object>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<{ ok: true; rows: T[] } | { ok: false; reason: string }> {
  try {
    return { ok: true, rows: await query<T>(sql, params) };
  } catch (err) {
    return { ok: false, reason: describe(err) };
  }
}

export function describe(err: unknown): string {
  if (err instanceof DatabaseUnavailableError) {
    return 'DATABASE_URL is not set for this deployment.';
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH/.test(message)) {
    return `Cannot reach the database: ${message}`;
  }
  return message;
}
