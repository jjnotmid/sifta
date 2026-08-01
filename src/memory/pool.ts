import pg from 'pg';
import { DATABASE_URL } from '../config.js';

const { Pool } = pg;

/**
 * One pool per process.
 *
 * Lambda note (see README): each warm container gets its own pool and the
 * handler sets `max: 1`. A Lambda container serves one request at a time, so
 * anything above 1 just holds idle CockroachDB connections open across the
 * whole fleet. The pool is created at module scope — outside the handler — so
 * it survives between invocations instead of reconnecting on every request.
 */
let pool: pg.Pool | null = null;

export interface PoolOptions {
  connectionString?: string;
  max?: number;
}

export function getPool(options: PoolOptions = {}): pg.Pool {
  if (pool) return pool;
  pool = new Pool({
    connectionString: options.connectionString ?? DATABASE_URL,
    max: options.max ?? 10,
    // CockroachDB closes idle connections server-side; fail fast rather than
    // handing a dead socket to a query.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    application_name: 'sifta',
  });
  // A pool-level error (server restart, network drop) is emitted on the pool,
  // and an unhandled 'error' event would take the process down.
  pool.on('error', (err) => {
    console.error('[db] idle client error:', err.message);
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}

/** Run a function inside a transaction, rolling back on throw. */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      /* the connection is already broken; the original error matters more */
    });
    throw err;
  } finally {
    client.release();
  }
}

export type { Pool, PoolClient, QueryResult } from 'pg';
