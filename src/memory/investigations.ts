import type { PoolClient } from 'pg';
import { getPool } from './pool.js';
import type { Investigation, InvestigationState, ToolTraceStep } from './types.js';

type Queryable = Pick<PoolClient, 'query'>;

function db(client?: Queryable): Queryable {
  return client ?? getPool();
}

interface InvestigationRow {
  id: string;
  alert_id: string;
  state: string;
  // CockroachDB INT is 64-bit, so `pg` returns it as a string to avoid
  // silently truncating values beyond Number.MAX_SAFE_INTEGER.
  step_count: string | number;
  tool_trace: ToolTraceStep[] | null;
  updated_at: Date;
}

function toInvestigation(row: InvestigationRow): Investigation {
  return {
    id: row.id,
    alertId: row.alert_id,
    state: row.state as InvestigationState,
    stepCount: Number(row.step_count),
    toolTrace: row.tool_trace ?? [],
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `id, alert_id, state, step_count, tool_trace, updated_at`;

export async function startInvestigation(
  alertId: string,
  client?: Queryable,
): Promise<Investigation> {
  const { rows } = await db(client).query<InvestigationRow>(
    `INSERT INTO investigation (alert_id, state, step_count, tool_trace)
     VALUES ($1, 'PENDING', 0, '[]'::JSONB)
     RETURNING ${SELECT_COLUMNS}`,
    [alertId],
  );
  const row = rows[0];
  if (!row) throw new Error('startInvestigation returned no row');
  return toInvestigation(row);
}

export async function getInvestigation(
  id: string,
  client?: Queryable,
): Promise<Investigation | null> {
  const { rows } = await db(client).query<InvestigationRow>(
    `SELECT ${SELECT_COLUMNS} FROM investigation WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toInvestigation(row) : null;
}

export async function getInvestigationByAlert(
  alertId: string,
  client?: Queryable,
): Promise<Investigation | null> {
  const { rows } = await db(client).query<InvestigationRow>(
    `SELECT ${SELECT_COLUMNS} FROM investigation
     WHERE alert_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [alertId],
  );
  const row = rows[0];
  return row ? toInvestigation(row) : null;
}

export async function setInvestigationState(
  id: string,
  state: InvestigationState,
  client?: Queryable,
): Promise<void> {
  await db(client).query(
    `UPDATE investigation SET state = $2, updated_at = now() WHERE id = $1`,
    [id, state],
  );
}

/**
 * Append one tool call to the trace.
 *
 * The append happens inside the UPDATE via jsonb array concatenation rather
 * than read-modify-write in application code, so a crash between the tool
 * returning and the next step cannot lose or duplicate a step. The trace is
 * what an analyst shows a regulator to reconstruct why the agent said what it
 * said, so a half-written trace is worse than none.
 */
export async function appendToolStep(
  id: string,
  step: Omit<ToolTraceStep, 'step' | 'at'> & { at?: string },
  client?: Queryable,
): Promise<Investigation> {
  const { rows } = await db(client).query<InvestigationRow>(
    `UPDATE investigation
     SET tool_trace = COALESCE(tool_trace, '[]'::JSONB) || jsonb_build_array(
           jsonb_build_object(
             'step',   step_count + 1,
             'tool',   $2::STRING,
             'input',  $3::JSONB,
             'output', $4::JSONB,
             'at',     $5::STRING
           )
         ),
         step_count = step_count + 1,
         updated_at = now()
     WHERE id = $1
     RETURNING ${SELECT_COLUMNS}`,
    [
      id,
      step.tool,
      JSON.stringify(step.input ?? null),
      JSON.stringify(step.output ?? null),
      step.at ?? new Date().toISOString(),
    ],
  );
  const row = rows[0];
  if (!row) throw new Error(`appendToolStep: no investigation ${id}`);
  return toInvestigation(row);
}
