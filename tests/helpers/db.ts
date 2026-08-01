import { getPool } from '../../src/memory/pool.js';
import { MockEmbeddingProvider } from '../../src/providers/mock.js';

export const embedder = new MockEmbeddingProvider();

/** Deterministic embedding for a name. Same input, same vector, every run. */
export function vec(text: string): number[] {
  return embedder.embedOne(text);
}

/**
 * Clear all application data, respecting foreign keys.
 *
 * `decision` is append-only for the application role but not for root, which
 * is what the tests connect as for setup. The append-only guarantee is
 * asserted separately, against a `sifta_app` connection.
 */
export async function resetTables(): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM decision');
  await pool.query('DELETE FROM investigation');
  await pool.query('DELETE FROM alert');
  await pool.query('DELETE FROM name_variant');
  await pool.query('DELETE FROM watchlist_entity');
}

/** Connection string for the least-privilege application role. */
export function appRoleConnectionString(): string {
  const base = process.env.DATABASE_URL ?? 'postgresql://root@localhost:26257/sifta?sslmode=disable';
  return base.replace('//root@', '//sifta_app@');
}
