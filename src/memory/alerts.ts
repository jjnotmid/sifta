import type { PoolClient } from 'pg';
import { getPool } from './pool.js';
import type { Alert, AlertInput, AlertStatus } from './types.js';
import { encodeVector } from './vector.js';

type Queryable = Pick<PoolClient, 'query'>;

function db(client?: Queryable): Queryable {
  return client ?? getPool();
}

interface AlertRow {
  id: string;
  subject_name: string;
  subject_key: string;
  subject_dob: Date | null;
  subject_nat: string | null;
  jurisdiction: string;
  txn_ref: string | null;
  txn_narration: string | null;
  matched_entity: string | null;
  match_distance: string | null;
  status: string;
  raised_at: Date;
}

function toAlert(row: AlertRow): Alert {
  return {
    id: row.id,
    subjectName: row.subject_name,
    subjectKey: row.subject_key,
    subjectDob: row.subject_dob ? row.subject_dob.toISOString().slice(0, 10) : null,
    subjectNat: row.subject_nat,
    jurisdiction: row.jurisdiction,
    txnRef: row.txn_ref,
    txnNarration: row.txn_narration,
    matchedEntity: row.matched_entity,
    matchDistance: row.match_distance === null ? null : Number(row.match_distance),
    status: row.status as AlertStatus,
    raisedAt: row.raised_at,
  };
}

const SELECT_COLUMNS = `
  id, subject_name, subject_key, subject_dob, subject_nat, jurisdiction,
  txn_ref, txn_narration, matched_entity, match_distance, status, raised_at
`;

export async function createAlert(
  input: AlertInput,
  client?: Queryable,
): Promise<Alert> {
  const { rows } = await db(client).query<AlertRow>(
    `INSERT INTO alert
       (subject_name, subject_key, subject_dob, subject_nat, jurisdiction,
        txn_ref, txn_narration, narration_vec, matched_entity, match_distance, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING ${SELECT_COLUMNS}`,
    [
      input.subjectName,
      input.subjectKey,
      input.subjectDob ?? null,
      input.subjectNat ?? null,
      input.jurisdiction,
      input.txnRef ?? null,
      input.txnNarration ?? null,
      input.narrationVec ? encodeVector(input.narrationVec) : null,
      input.matchedEntity ?? null,
      input.matchDistance ?? null,
      input.status ?? 'OPEN',
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('createAlert returned no row');
  return toAlert(row);
}

export async function getAlert(id: string, client?: Queryable): Promise<Alert | null> {
  const { rows } = await db(client).query<AlertRow>(
    `SELECT ${SELECT_COLUMNS} FROM alert WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toAlert(row) : null;
}

export async function setAlertStatus(
  id: string,
  status: AlertStatus,
  client?: Queryable,
): Promise<void> {
  await db(client).query(`UPDATE alert SET status = $2 WHERE id = $1`, [id, status]);
}

export async function listAlerts(
  options: { status?: AlertStatus; limit?: number } = {},
  client?: Queryable,
): Promise<Alert[]> {
  const limit = options.limit ?? 100;
  const { rows } = options.status
    ? await db(client).query<AlertRow>(
        `SELECT ${SELECT_COLUMNS} FROM alert WHERE status = $1 ORDER BY raised_at DESC LIMIT $2`,
        [options.status, limit],
      )
    : await db(client).query<AlertRow>(
        `SELECT ${SELECT_COLUMNS} FROM alert ORDER BY raised_at DESC LIMIT $1`,
        [limit],
      );
  return rows.map(toAlert);
}

/** Prior alerts for the same normalised subject, newest first. */
export async function alertsForSubject(
  subjectKey: string,
  limit = 20,
  client?: Queryable,
): Promise<Alert[]> {
  const { rows } = await db(client).query<AlertRow>(
    `SELECT ${SELECT_COLUMNS} FROM alert
     WHERE subject_key = $1 ORDER BY raised_at DESC LIMIT $2`,
    [subjectKey, limit],
  );
  return rows.map(toAlert);
}
