import type { PoolClient } from 'pg';
import { getPool } from './pool.js';
import type { SourceList, WatchlistEntity, WatchlistEntityInput } from './types.js';

type Queryable = Pick<PoolClient, 'query'>;

function db(client?: Queryable): Queryable {
  return client ?? getPool();
}

interface EntityRow {
  id: string;
  source_list: string;
  source_ref: string;
  jurisdiction: string;
  primary_name: string;
  dob: Date | null;
  nationality: string | null;
  raw_payload: unknown;
}

function toEntity(row: EntityRow): WatchlistEntity {
  return {
    id: row.id,
    sourceList: row.source_list as SourceList,
    sourceRef: row.source_ref,
    jurisdiction: row.jurisdiction,
    primaryName: row.primary_name,
    dob: row.dob ? toIsoDate(row.dob) : null,
    nationality: row.nationality,
    rawPayload: row.raw_payload,
  };
}

/** `pg` returns DATE as a Date in local time; format without a TZ shift. */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Insert or refresh a watchlist entity, keyed on (source_list, source_ref).
 *
 * Re-ingesting the same OFAC file must not duplicate rows — sanctions lists are
 * republished daily and the ingest job is expected to run repeatedly.
 */
export async function upsertEntity(
  input: WatchlistEntityInput,
  client?: Queryable,
): Promise<string> {
  const { rows } = await db(client).query<{ id: string }>(
    `INSERT INTO watchlist_entity
       (source_list, source_ref, jurisdiction, primary_name, dob, nationality, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (source_list, source_ref) DO UPDATE SET
       jurisdiction = excluded.jurisdiction,
       primary_name = excluded.primary_name,
       dob          = excluded.dob,
       nationality  = excluded.nationality,
       raw_payload  = excluded.raw_payload
     RETURNING id`,
    [
      input.sourceList,
      input.sourceRef,
      input.jurisdiction,
      input.primaryName,
      input.dob ?? null,
      input.nationality ?? null,
      input.rawPayload === undefined ? null : JSON.stringify(input.rawPayload),
    ],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`upsertEntity returned no id for ${input.sourceRef}`);
  return id;
}

/**
 * Bulk form of `upsertEntity`, returning ids in input order.
 *
 * Safe to batch because `watchlist_entity` holds no vector column — the
 * no-batching rule applies specifically to vector inserts (see
 * `MAX_VECTOR_INSERT_CHUNK`). Ingesting 19k SDN records one statement at a
 * time is otherwise needlessly slow.
 */
export async function upsertEntities(
  inputs: readonly WatchlistEntityInput[],
  client?: Queryable,
): Promise<string[]> {
  if (inputs.length === 0) return [];
  const values: unknown[] = [];
  const tuples = inputs.map((input, idx) => {
    const b = idx * 7;
    values.push(
      input.sourceList,
      input.sourceRef,
      input.jurisdiction,
      input.primaryName,
      input.dob ?? null,
      input.nationality ?? null,
      input.rawPayload === undefined ? null : JSON.stringify(input.rawPayload),
    );
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
  });

  const { rows } = await db(client).query<{ id: string; source_ref: string }>(
    `INSERT INTO watchlist_entity
       (source_list, source_ref, jurisdiction, primary_name, dob, nationality, raw_payload)
     VALUES ${tuples.join(', ')}
     ON CONFLICT (source_list, source_ref) DO UPDATE SET
       jurisdiction = excluded.jurisdiction,
       primary_name = excluded.primary_name,
       dob          = excluded.dob,
       nationality  = excluded.nationality,
       raw_payload  = excluded.raw_payload
     RETURNING id, source_ref`,
    values,
  );

  const byRef = new Map(rows.map((r) => [r.source_ref, r.id]));
  return inputs.map((input) => {
    const id = byRef.get(input.sourceRef);
    if (!id) throw new Error(`upsertEntities: no id returned for ${input.sourceRef}`);
    return id;
  });
}

export async function getEntity(
  id: string,
  client?: Queryable,
): Promise<WatchlistEntity | null> {
  const { rows } = await db(client).query<EntityRow>(
    `SELECT id, source_list, source_ref, jurisdiction, primary_name, dob, nationality, raw_payload
     FROM watchlist_entity WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toEntity(row) : null;
}

export async function findEntityByRef(
  sourceList: SourceList,
  sourceRef: string,
  client?: Queryable,
): Promise<WatchlistEntity | null> {
  const { rows } = await db(client).query<EntityRow>(
    `SELECT id, source_list, source_ref, jurisdiction, primary_name, dob, nationality, raw_payload
     FROM watchlist_entity WHERE source_list = $1 AND source_ref = $2`,
    [sourceList, sourceRef],
  );
  const row = rows[0];
  return row ? toEntity(row) : null;
}

export async function countEntities(
  sourceList?: SourceList,
  client?: Queryable,
): Promise<number> {
  const { rows } = sourceList
    ? await db(client).query<{ n: string }>(
        `SELECT count(*)::STRING AS n FROM watchlist_entity WHERE source_list = $1`,
        [sourceList],
      )
    : await db(client).query<{ n: string }>(
        `SELECT count(*)::STRING AS n FROM watchlist_entity`,
      );
  return Number(rows[0]?.n ?? 0);
}

/** Stream entities in primary-key order. Used by variant generation. */
export async function* iterateEntities(
  batchSize = 500,
): AsyncGenerator<WatchlistEntity> {
  let after: string | null = null;
  for (;;) {
    const result = after
      ? await getPool().query<EntityRow>(
          `SELECT id, source_list, source_ref, jurisdiction, primary_name, dob, nationality, raw_payload
           FROM watchlist_entity WHERE id > $1 ORDER BY id LIMIT $2`,
          [after, batchSize],
        )
      : await getPool().query<EntityRow>(
          `SELECT id, source_list, source_ref, jurisdiction, primary_name, dob, nationality, raw_payload
           FROM watchlist_entity ORDER BY id LIMIT $1`,
          [batchSize],
        );
    const rows: EntityRow[] = result.rows;
    if (rows.length === 0) return;
    for (const row of rows) yield toEntity(row);
    after = rows[rows.length - 1]!.id;
  }
}
