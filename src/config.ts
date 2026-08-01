import 'dotenv/config';

/**
 * The one place the embedding width is defined.
 *
 * db/schema.sql is written with VECTOR(1024) — Titan Text Embeddings V2. The
 * migration runner rewrites every VECTOR(n) literal in that file to this value
 * before applying it, so falling back to Transformers.js all-MiniLM-L6-v2 (384)
 * is `EMBEDDING_DIMENSIONS=384` plus a re-migration, and nothing else.
 */
export const EMBEDDING_DIMENSIONS = Number.parseInt(
  process.env.EMBEDDING_DIMENSIONS ?? '1024',
  10,
);

if (!Number.isInteger(EMBEDDING_DIMENSIONS) || EMBEDDING_DIMENSIONS <= 0) {
  throw new Error(
    `EMBEDDING_DIMENSIONS must be a positive integer, got ${JSON.stringify(process.env.EMBEDDING_DIMENSIONS)}`,
  );
}

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://root@localhost:26257/sifta?sslmode=disable';

/** Jurisdictions seeded for the demo. Every vector index is prefixed by one. */
export const JURISDICTIONS = ['NG', 'GH', 'KE'] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

export const DEFAULT_JURISDICTION: Jurisdiction = 'NG';

/** Candidate-set size returned by a single vector search. */
export const CANDIDATE_LIMIT = 20;
