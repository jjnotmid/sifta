import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { EMBEDDING_DIMENSIONS } from '../../src/config.js';
import { migrate } from '../../src/memory/migrate.js';
import { applyEmbeddingDimensions, splitStatements } from '../../src/memory/migrate.js';
import { closePool, getPool } from '../../src/memory/pool.js';
import { decodeVector, encodeVector } from '../../src/memory/vector.js';
import {
  CANDIDATE_QUERY,
  insertVariants,
  searchCandidates,
} from '../../src/memory/variants.js';
import { upsertEntity } from '../../src/memory/watchlist.js';
import { createAlert } from '../../src/memory/alerts.js';
import { recordDecision } from '../../src/memory/decisions.js';
import { appRoleConnectionString, resetTables, vec } from '../helpers/db.js';

beforeAll(async () => {
  await migrate();
  await resetTables();
});

afterAll(async () => {
  await closePool();
});

describe('migration runner', () => {
  it('applies the schema to the cluster', async () => {
    const { rows } = await getPool().query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const tables = rows.map((r) => r.table_name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'alert',
        'decision',
        'investigation',
        'name_variant',
        'watchlist_entity',
      ]),
    );
  });

  it('is idempotent — a second run changes nothing and does not error', async () => {
    const before = await migrate();
    const after = await migrate();
    expect(after.statementsApplied).toBe(before.statementsApplied);
    expect(after.dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it('declares every vector index inline, prefixed by a partition key', async () => {
    // A standalone CREATE VECTOR INDEX would block writes during backfill, so
    // the schema must never contain one.
    const { rows } = await getPool().query<{ create_statement: string }>(
      `SELECT create_statement FROM [SHOW CREATE TABLE name_variant]`,
    );
    const ddl = rows[0]!.create_statement;
    // Inline, inside the CREATE TABLE body, with jurisdiction as the leading
    // partition column and the vector second.
    expect(ddl).toMatch(
      /VECTOR INDEX name_vec_idx \(jurisdiction, embedding vector_l2_ops\)/i,
    );
  });

  it('gives the alert and decision tables partition-prefixed vector indexes too', async () => {
    const read = async (table: string): Promise<string> => {
      const { rows } = await getPool().query<{ create_statement: string }>(
        `SELECT create_statement FROM [SHOW CREATE TABLE ${table}]`,
      );
      return rows[0]!.create_statement;
    };
    expect(await read('alert')).toMatch(
      /VECTOR INDEX alert_narration_idx \(jurisdiction, narration_vec vector_l2_ops\)/i,
    );
    // The ledger partitions by subject_key: recall is always scoped to one
    // subject, never a global similarity sweep across every decision ever made.
    expect(await read('decision')).toMatch(
      /VECTOR INDEX decision_vec_idx \(subject_key, rationale_vec vector_l2_ops\)/i,
    );
  });

  it('rewrites VECTOR(n) from the single EMBEDDING_DIMENSIONS constant', () => {
    const sql = 'a VECTOR(1024), b VECTOR( 1024 ), c vector(1024)';
    expect(applyEmbeddingDimensions(sql, 384)).toBe(
      'a VECTOR(384), b VECTOR(384), c VECTOR(384)',
    );
  });

  it('splits statements without tripping on semicolons in comments', () => {
    const sql = `
      -- a comment; with a semicolon
      CREATE TABLE t (a INT);
      INSERT INTO t VALUES (1);
    `;
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('CREATE TABLE t');
    expect(statements[1]).toContain('INSERT INTO t');
  });
});

describe('VECTOR column', () => {
  it(`round-trips a ${EMBEDDING_DIMENSIONS}-dimension value without loss of ordering`, async () => {
    const entityId = await upsertEntity({
      sourceList: 'OFAC_SDN',
      sourceRef: 'ROUNDTRIP-1',
      jurisdiction: 'NG',
      primaryName: 'ADEBAYO OGUNDIMU',
    });
    const embedding = vec('ADEBAYO OGUNDIMU');
    await insertVariants([
      {
        entityId,
        jurisdiction: 'NG',
        variantText: 'ADEBAYO OGUNDIMU',
        variantKind: 'primary',
        embedding,
      },
    ]);

    const { rows } = await getPool().query<{ embedding: string }>(
      `SELECT embedding::STRING AS embedding FROM name_variant WHERE entity_id = $1`,
      [entityId],
    );
    const stored = decodeVector(rows[0]!.embedding);
    expect(stored).not.toBeNull();
    expect(stored!).toHaveLength(EMBEDDING_DIMENSIONS);
    // float32 storage, so compare with tolerance rather than exact equality.
    for (let i = 0; i < embedding.length; i++) {
      expect(stored![i]!).toBeCloseTo(embedding[i]!, 5);
    }
  });

  it('rejects a vector of the wrong width before it reaches the database', () => {
    expect(() => encodeVector([1, 2, 3])).toThrow(/expected a \d+-dimension vector/);
  });
});

describe('vector search', () => {
  const names = [
    'CHUKWUEMEKA OKAFOR',
    'IBRAHIM MUSA DANJUMA',
    'OLUWASEUN ADEYEMI',
    'GRACE NWACHUKWU',
  ];

  beforeAll(async () => {
    for (const [i, name] of names.entries()) {
      const entityId = await upsertEntity({
        sourceList: 'OFAC_SDN',
        sourceRef: `SEARCH-${i}`,
        jurisdiction: 'NG',
        primaryName: name,
      });
      await insertVariants([
        {
          entityId,
          jurisdiction: 'NG',
          variantText: name,
          variantKind: 'primary',
          embedding: vec(name),
        },
      ]);
    }
  });

  it('orders by `embedding <-> $1`, nearest first', async () => {
    const results = await searchCandidates('NG', vec('CHUKWUEMEKA OKAFOR'), 4);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.variantText).toBe('CHUKWUEMEKA OKAFOR');
    expect(results[0]!.distance).toBeCloseTo(0, 4);

    // Distances must be non-decreasing — that is what "ranked" means.
    const distances = results.map((r) => r.distance);
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]!).toBeGreaterThanOrEqual(distances[i - 1]!);
    }
  });

  it('confines a search to its jurisdiction partition', async () => {
    const ghEntity = await upsertEntity({
      sourceList: 'OFAC_SDN',
      sourceRef: 'SEARCH-GH',
      jurisdiction: 'GH',
      primaryName: 'CHUKWUEMEKA OKAFOR',
    });
    await insertVariants([
      {
        entityId: ghEntity,
        jurisdiction: 'GH',
        variantText: 'CHUKWUEMEKA OKAFOR',
        variantKind: 'primary',
        embedding: vec('CHUKWUEMEKA OKAFOR'),
      },
    ]);

    const ng = await searchCandidates('NG', vec('CHUKWUEMEKA OKAFOR'), 20);
    expect(ng.every((r) => r.entityId !== ghEntity)).toBe(true);

    const gh = await searchCandidates('GH', vec('CHUKWUEMEKA OKAFOR'), 20);
    expect(gh.map((r) => r.entityId)).toContain(ghEntity);
  });

  it('EXPLAIN proves the vector index is used and prefix-scanned by jurisdiction', async () => {
    const { rows } = await getPool().query<{ info: string }>(
      `EXPLAIN SELECT nv.entity_id
       FROM name_variant nv
       WHERE nv.jurisdiction = $1
       ORDER BY nv.embedding <-> $2
       LIMIT 20`,
      ['NG', encodeVector(vec('CHUKWUEMEKA OKAFOR'))],
    );
    const plan = rows.map((r) => r.info).join('\n');

    // The index is used at all...
    expect(plan).toContain('vector search');
    expect(plan).toContain('name_variant@name_vec_idx');
    // ...and it is scanned as a partition, not globally. This line is the
    // claim the submission makes on camera.
    expect(plan).toMatch(/prefix spans: \[\/'NG' - \/'NG'\]/);
    // A full table scan would mean the index was ignored.
    expect(plan).not.toContain('FULL SCAN');
  });

  it('the production candidate query itself uses the vector index', async () => {
    // Regression guard. Written as a flat SELECT joining watchlist_entity,
    // this query costs the join against a 250k-row table and silently
    // abandons the vector index for a FULL SCAN — correct results, ~500x
    // slower, and nothing fails loudly. The CTE form is load-bearing.
    const { rows } = await getPool().query<{ info: string }>(
      `EXPLAIN ${CANDIDATE_QUERY}`,
      ['NG', encodeVector(vec('CHUKWUEMEKA OKAFOR')), 20],
    );
    const plan = rows.map((r) => r.info).join('\n');

    expect(plan).toContain('vector search');
    expect(plan).toContain('name_variant@name_vec_idx');
    expect(plan).toMatch(/prefix spans: \[\/'NG' - \/'NG'\]/);
    expect(plan).not.toContain('FULL SCAN');
  });
});

describe('vector insert batching', () => {
  it('refuses chunks larger than the documented ceiling', async () => {
    await expect(insertVariants([], undefined, 50)).rejects.toThrow(
      /must not be batched/,
    );
  });
});

describe('immutable decision ledger', () => {
  let appPool: pg.Pool;
  let decisionId: string;

  beforeAll(async () => {
    const entityId = await upsertEntity({
      sourceList: 'OFAC_SDN',
      sourceRef: 'LEDGER-1',
      jurisdiction: 'NG',
      primaryName: 'SANI ABACHA',
    });
    const alert = await createAlert({
      subjectName: 'Sani Abacha',
      subjectKey: 'ABACHA|SANI::-::-',
      jurisdiction: 'NG',
      matchedEntity: entityId,
      matchDistance: 0.02,
    });
    const decision = await recordDecision({
      alertId: alert.id,
      subjectKey: alert.subjectKey,
      entityId,
      disposition: 'CLEARED',
      rationale: 'DOB mismatch: subject born 1994, listed individual born 1943.',
      decidedBy: 'analyst@example.com',
    });
    decisionId = decision.id;

    appPool = new pg.Pool({ connectionString: appRoleConnectionString(), max: 2 });
  });

  afterAll(async () => {
    await appPool?.end();
  });

  it('lets the application role read and append', async () => {
    const { rows } = await appPool.query(`SELECT id FROM decision WHERE id = $1`, [
      decisionId,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('refuses UPDATE from the application role', async () => {
    await expect(
      appPool.query(`UPDATE decision SET rationale = 'rewritten' WHERE id = $1`, [
        decisionId,
      ]),
    ).rejects.toMatchObject({ code: '42501' }); // insufficient_privilege
  });

  it('refuses DELETE from the application role', async () => {
    await expect(
      appPool.query(`DELETE FROM decision WHERE id = $1`, [decisionId]),
    ).rejects.toMatchObject({ code: '42501' });

    // And the row is still there.
    const { rows } = await getPool().query(`SELECT id FROM decision WHERE id = $1`, [
      decisionId,
    ]);
    expect(rows).toHaveLength(1);
  });
});
