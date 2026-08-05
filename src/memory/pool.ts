import { readFileSync } from 'node:fs';
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

/**
 * CockroachDB Cloud connection strings carry `sslmode=verify-full`, which
 * requires a CA the client actually trusts. Most Cloud clusters present a
 * publicly-signed certificate and Node's built-in bundle is enough — but the
 * Connect dialog also offers a `root.crt` download, and for clusters that need
 * it, `sslmode` alone in the URL will not load it. `pg` parses the mode but
 * never reads a certificate file.
 *
 * So: point DATABASE_CA_CERT at the downloaded file and it is used. Leave it
 * unset and nothing changes.
 */
function sslConfig(): pg.ClientConfig['ssl'] {
  const caPath = process.env.DATABASE_CA_CERT;
  if (!caPath) return undefined;
  try {
    return { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true };
  } catch (err) {
    throw new Error(
      `DATABASE_CA_CERT is set to '${caPath}' but the file could not be read: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function getPool(options: PoolOptions = {}): pg.Pool {
  if (pool) return pool;
  const ssl = sslConfig();
  pool = new Pool({
    connectionString: options.connectionString ?? DATABASE_URL,
    ...(ssl ? { ssl } : {}),
    max: options.max ?? 10,
    // CockroachDB closes idle connections server-side; fail fast rather than
    // handing a dead socket to a query.
    idleTimeoutMillis: 30_000,
    // Generous, because a cluster can be a continent away and the ingest runs
    // for hours. Transient drops are retried in src/memory/retry.ts rather
    // than being papered over with an infinite timeout.
    connectionTimeoutMillis: 30_000,
    // Without TCP keepalive, a NAT or firewall on a long-haul path silently
    // drops an idle connection and the next query fails with ETIMEDOUT.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
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
