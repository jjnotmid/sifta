import type { PoolClient } from 'pg';
import { getPool } from './pool.js';
import type { Decision, DecisionInput, Disposition } from './types.js';
import { encodeVector } from './vector.js';

type Queryable = Pick<PoolClient, 'query'>;

function db(client?: Queryable): Queryable {
  return client ?? getPool();
}

interface DecisionRow {
  id: string;
  alert_id: string;
  subject_key: string;
  entity_id: string | null;
  disposition: string;
  rationale: string;
  decided_by: string;
  agent_assisted: boolean;
  agent_reasoning: unknown;
  decided_at: Date;
}

function toDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    alertId: row.alert_id,
    subjectKey: row.subject_key,
    entityId: row.entity_id,
    disposition: row.disposition as Disposition,
    rationale: row.rationale,
    decidedBy: row.decided_by,
    agentAssisted: row.agent_assisted,
    agentReasoning: row.agent_reasoning,
    decidedAt: row.decided_at,
  };
}

const SELECT_COLUMNS = `
  id, alert_id, subject_key, entity_id, disposition, rationale,
  decided_by, agent_assisted, agent_reasoning, decided_at
`;

/**
 * Append a decision to the ledger.
 *
 * There is deliberately no update or delete counterpart in this module. The
 * database also refuses them for the application role (see db/schema.sql), so
 * the guarantee does not depend on nobody adding one later.
 */
export async function recordDecision(
  input: DecisionInput,
  client?: Queryable,
): Promise<Decision> {
  const { rows } = await db(client).query<DecisionRow>(
    `INSERT INTO decision
       (alert_id, subject_key, entity_id, disposition, rationale, rationale_vec,
        decided_by, agent_assisted, agent_reasoning)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING ${SELECT_COLUMNS}`,
    [
      input.alertId,
      input.subjectKey,
      input.entityId ?? null,
      input.disposition,
      input.rationale,
      input.rationaleVec ? encodeVector(input.rationaleVec) : null,
      input.decidedBy,
      input.agentAssisted ?? true,
      input.agentReasoning === undefined ? null : JSON.stringify(input.agentReasoning),
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('recordDecision returned no row');
  return toDecision(row);
}

/**
 * The differentiator. Given a normalised subject key, what did we decide before
 * and why?
 *
 * Newest first: an analyst's most recent judgement supersedes an older one for
 * the purposes of auto-disposition, but every prior row stays visible because
 * the ledger is the audit trail.
 */
export async function recallPriorDecisions(
  subjectKey: string,
  limit = 10,
  client?: Queryable,
): Promise<Decision[]> {
  const { rows } = await db(client).query<DecisionRow>(
    `SELECT ${SELECT_COLUMNS} FROM decision
     WHERE subject_key = $1 ORDER BY decided_at DESC LIMIT $2`,
    [subjectKey, limit],
  );
  return rows.map(toDecision);
}

export async function getDecision(
  id: string,
  client?: Queryable,
): Promise<Decision | null> {
  const { rows } = await db(client).query<DecisionRow>(
    `SELECT ${SELECT_COLUMNS} FROM decision WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toDecision(row) : null;
}

/** Full ledger, newest first. Backs the decision-ledger screen and the export. */
export async function listDecisions(
  options: { subjectKey?: string; disposition?: Disposition; limit?: number } = {},
  client?: Queryable,
): Promise<Decision[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.subjectKey) {
    params.push(options.subjectKey);
    clauses.push(`subject_key = $${params.length}`);
  }
  if (options.disposition) {
    params.push(options.disposition);
    clauses.push(`disposition = $${params.length}`);
  }
  params.push(options.limit ?? 200);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await db(client).query<DecisionRow>(
    `SELECT ${SELECT_COLUMNS} FROM decision ${where}
     ORDER BY decided_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(toDecision);
}

export async function countDecisions(client?: Queryable): Promise<number> {
  const { rows } = await db(client).query<{ n: string }>(
    `SELECT count(*)::STRING AS n FROM decision`,
  );
  return Number(rows[0]?.n ?? 0);
}
