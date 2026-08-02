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
 */

const globalForPool = globalThis as unknown as { siftaPool?: Pool };

export function getPool(): Pool {
  if (!globalForPool.siftaPool) {
    globalForPool.siftaPool = new Pool({
      connectionString:
        process.env.DATABASE_URL ?? 'postgresql://root@localhost:26257/sifta?sslmode=disable',
      // Modest ceiling: the console is one analyst, not a fleet.
      max: 4,
    });
  }
  return globalForPool.siftaPool;
}

export async function query<T extends object>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const { rows } = await getPool().query<T>(sql, params as unknown[]);
  return rows;
}
