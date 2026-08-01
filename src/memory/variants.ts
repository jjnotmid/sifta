import type { PoolClient } from 'pg';
import { CANDIDATE_LIMIT } from '../config.js';
import { getPool } from './pool.js';
import type { Candidate, NameVariantInput, VariantKind } from './types.js';
import { encodeVector } from './vector.js';

type Queryable = Pick<PoolClient, 'query'>;

function db(client?: Queryable): Queryable {
  return client ?? getPool();
}

/**
 * CockroachDB's docs warn that large batched vector inserts degrade
 * performance badly — the index maintenance per statement grows superlinearly.
 * Ten is the documented ceiling; this constant is the only place it is set and
 * `insertVariants` refuses to exceed it.
 */
export const MAX_VECTOR_INSERT_CHUNK = 10;

export async function insertVariants(
  variants: readonly NameVariantInput[],
  client?: Queryable,
  chunkSize: number = MAX_VECTOR_INSERT_CHUNK,
): Promise<number> {
  if (chunkSize < 1 || chunkSize > MAX_VECTOR_INSERT_CHUNK) {
    throw new Error(
      `chunkSize must be between 1 and ${MAX_VECTOR_INSERT_CHUNK} (vector inserts must not be batched); got ${chunkSize}`,
    );
  }
  const conn = db(client);
  let written = 0;

  for (let i = 0; i < variants.length; i += chunkSize) {
    const chunk = variants.slice(i, i + chunkSize);
    const values: unknown[] = [];
    const tuples: string[] = [];

    chunk.forEach((v, idx) => {
      const base = idx * 5;
      tuples.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
      values.push(
        v.entityId,
        v.jurisdiction,
        v.variantText,
        v.variantKind,
        v.embedding ? encodeVector(v.embedding) : null,
      );
    });

    const { rowCount } = await conn.query(
      `INSERT INTO name_variant (entity_id, jurisdiction, variant_text, variant_kind, embedding)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (entity_id, variant_text, variant_kind) DO NOTHING`,
      values,
    );
    written += rowCount ?? 0;
  }
  return written;
}

interface CandidateRow {
  variant_id: string;
  entity_id: string;
  variant_text: string;
  variant_kind: string;
  primary_name: string;
  dob: Date | null;
  nationality: string | null;
  source_list: string;
  source_ref: string;
  distance: string;
}

/**
 * Candidate generation.
 *
 * The WHERE on jurisdiction is not a filter applied after the search — it is
 * the vector index's partition prefix, so a Nigerian screen scans only the
 * Nigerian partition. `npm run explain` prints the plan proving it.
 */
export const CANDIDATE_QUERY = `
  SELECT nv.id           AS variant_id,
         nv.entity_id    AS entity_id,
         nv.variant_text AS variant_text,
         nv.variant_kind AS variant_kind,
         we.primary_name AS primary_name,
         we.dob          AS dob,
         we.nationality  AS nationality,
         we.source_list  AS source_list,
         we.source_ref   AS source_ref,
         (nv.embedding <-> $2)::STRING AS distance
  FROM name_variant nv
  JOIN watchlist_entity we ON we.id = nv.entity_id
  WHERE nv.jurisdiction = $1
  ORDER BY nv.embedding <-> $2
  LIMIT $3
`;

export async function searchCandidates(
  jurisdiction: string,
  embedding: readonly number[],
  limit: number = CANDIDATE_LIMIT,
  client?: Queryable,
): Promise<Candidate[]> {
  const { rows } = await db(client).query<CandidateRow>(CANDIDATE_QUERY, [
    jurisdiction,
    encodeVector(embedding),
    limit,
  ]);
  return rows.map((row) => ({
    entityId: row.entity_id,
    variantId: row.variant_id,
    variantText: row.variant_text,
    variantKind: row.variant_kind as VariantKind,
    primaryName: row.primary_name,
    dob: row.dob ? row.dob.toISOString().slice(0, 10) : null,
    nationality: row.nationality,
    sourceList: row.source_list,
    sourceRef: row.source_ref,
    distance: Number(row.distance),
  }));
}

export async function countVariants(
  entityId?: string,
  client?: Queryable,
): Promise<number> {
  const { rows } = entityId
    ? await db(client).query<{ n: string }>(
        `SELECT count(*)::STRING AS n FROM name_variant WHERE entity_id = $1`,
        [entityId],
      )
    : await db(client).query<{ n: string }>(
        `SELECT count(*)::STRING AS n FROM name_variant`,
      );
  return Number(rows[0]?.n ?? 0);
}
