import 'server-only';
import { tryQuery } from './db';

/**
 * Every figure the console renders comes from one of these queries. There is
 * no fixture data and no placeholder state anywhere in `web/` — if the queue
 * is empty, the screen says the queue is empty.
 *
 * Each returns a `Result`: either rows, or the reason the database could not
 * be read. Callers render the reason. A deployed console with no cluster
 * behind it is a normal, explainable condition, not a crash.
 */

export type Result<T> = { ok: true; data: T } | { ok: false; reason: string };

export type AlertStatus = 'OPEN' | 'INVESTIGATING' | 'CLEARED' | 'HIT' | 'ESCALATED';
export type Disposition = 'CLEARED' | 'HIT' | 'ESCALATED';

export interface AlertRow {
  id: string;
  subject_name: string;
  subject_key: string;
  subject_dob: string | null;
  subject_nat: string | null;
  jurisdiction: string;
  txn_ref: string | null;
  txn_narration: string | null;
  matched_entity: string | null;
  match_distance: string | null;
  status: AlertStatus;
  raised_at: Date;
  matched_name: string | null;
  prior_decisions: number;
}

const ALERT_COLUMNS = `
  a.id, a.subject_name, a.subject_key, a.subject_dob, a.subject_nat,
  a.jurisdiction, a.txn_ref, a.txn_narration, a.matched_entity,
  a.match_distance, a.status, a.raised_at,
  w.primary_name AS matched_name,
  (SELECT count(*)::int FROM decision d WHERE d.subject_key = a.subject_key) AS prior_decisions
`;

export async function listAlerts(limit = 200): Promise<Result<AlertRow[]>> {
  const result = await tryQuery<AlertRow>(
    `SELECT ${ALERT_COLUMNS}
       FROM alert a
       LEFT JOIN watchlist_entity w ON w.id = a.matched_entity
      ORDER BY
        -- Live work first: an analyst opens the queue to find what still needs
        -- a decision, not to admire what they already dispositioned.
        CASE a.status WHEN 'OPEN' THEN 0 WHEN 'INVESTIGATING' THEN 1 ELSE 2 END,
        a.match_distance ASC NULLS LAST,
        a.raised_at DESC
      LIMIT $1`,
    [limit],
  );
  return result.ok ? { ok: true, data: result.rows } : result;
}

export async function getAlert(id: string): Promise<Result<AlertRow | null>> {
  const result = await tryQuery<AlertRow>(
    `SELECT ${ALERT_COLUMNS}
       FROM alert a
       LEFT JOIN watchlist_entity w ON w.id = a.matched_entity
      WHERE a.id = $1`,
    [id],
  );
  return result.ok ? { ok: true, data: result.rows[0] ?? null } : result;
}

/**
 * Shape written into `investigation.tool_trace` by the agent's
 * `search_watchlist` step — the serialised `Candidate` from
 * `src/memory/types.ts`, so camelCase rather than column names.
 */
export interface CandidateRow {
  entityId: string;
  variantId: string;
  variantText: string;
  variantKind: string;
  primaryName: string;
  dob: string | null;
  nationality: string | null;
  sourceList: string;
  sourceRef: string;
  distance: number;
}

/**
 * The candidate set behind an alert, recovered from the investigation's tool
 * trace rather than re-run.
 *
 * Re-screening on page load would be dishonest: the Field would show today's
 * vector search, not the one the recorded decision was actually made on. An
 * audit trail that changes when you look at it is not an audit trail.
 */
export async function getCandidates(alertId: string): Promise<CandidateRow[]> {
  const result = await tryQuery<{ tool_trace: unknown }>(
    `SELECT tool_trace FROM investigation WHERE alert_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [alertId],
  );
  if (!result.ok) return [];

  const trace = result.rows[0]?.tool_trace;
  if (!Array.isArray(trace)) return [];

  for (const step of trace) {
    const output = (step as { output?: unknown }).output;
    const candidates = (output as { candidates?: unknown } | undefined)?.candidates;
    if (Array.isArray(candidates) && candidates.length > 0) {
      return candidates as CandidateRow[];
    }
  }
  return [];
}

export interface TraceStep {
  step: number;
  tool: string;
  input: unknown;
  output: unknown;
  at: string;
}

export interface InvestigationRow {
  id: string;
  alert_id: string;
  state: string;
  step_count: number;
  tool_trace: TraceStep[] | null;
  updated_at: Date;
}

export async function getInvestigation(alertId: string): Promise<InvestigationRow | null> {
  const result = await tryQuery<InvestigationRow>(
    `SELECT id, alert_id, state, step_count, tool_trace, updated_at
       FROM investigation WHERE alert_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [alertId],
  );
  return result.ok ? (result.rows[0] ?? null) : null;
}

export interface DecisionRow {
  id: string;
  alert_id: string;
  subject_key: string;
  entity_id: string | null;
  disposition: Disposition;
  rationale: string;
  decided_by: string;
  agent_assisted: boolean;
  decided_at: Date;
  subject_name: string | null;
}

/**
 * Prior decisions for a subject, excluding the alert being viewed.
 *
 * This is the memory payoff — what the institution already concluded about
 * this person, in the analyst's own words.
 */
export async function getPriorDecisions(
  subjectKey: string,
  excludeAlertId?: string,
): Promise<DecisionRow[]> {
  const result = await tryQuery<DecisionRow>(
    `SELECT d.id, d.alert_id, d.subject_key, d.entity_id, d.disposition, d.rationale,
            d.decided_by, d.agent_assisted, d.decided_at, a.subject_name
       FROM decision d
       LEFT JOIN alert a ON a.id = d.alert_id
      WHERE d.subject_key = $1 AND ($2::uuid IS NULL OR d.alert_id <> $2::uuid)
      ORDER BY d.decided_at DESC`,
    [subjectKey, excludeAlertId ?? null],
  );
  return result.ok ? result.rows : [];
}

export async function listDecisions(limit = 500): Promise<Result<DecisionRow[]>> {
  const result = await tryQuery<DecisionRow>(
    `SELECT d.id, d.alert_id, d.subject_key, d.entity_id, d.disposition, d.rationale,
            d.decided_by, d.agent_assisted, d.decided_at, a.subject_name
       FROM decision d
       LEFT JOIN alert a ON a.id = d.alert_id
      ORDER BY d.decided_at DESC
      LIMIT $1`,
    [limit],
  );
  return result.ok ? { ok: true, data: result.rows } : result;
}

export interface Totals {
  entities: number;
  variants: number;
  alerts: number;
  open: number;
  decisions: number;
}

export async function getTotals(): Promise<Totals | null> {
  const result = await tryQuery<Totals>(
    `SELECT
       (SELECT count(*)::int FROM watchlist_entity) AS entities,
       (SELECT count(*)::int FROM name_variant)     AS variants,
       (SELECT count(*)::int FROM alert)            AS alerts,
       (SELECT count(*)::int FROM alert WHERE status IN ('OPEN','INVESTIGATING')) AS open,
       (SELECT count(*)::int FROM decision)         AS decisions`,
  );
  return result.ok ? (result.rows[0] ?? null) : null;
}

/** The candidate set for the marketing hero — most recent recorded screen. */
export async function getHeroCandidates(): Promise<CandidateRow[]> {
  const result = await tryQuery<{ tool_trace: unknown }>(
    `SELECT tool_trace FROM investigation
      WHERE tool_trace IS NOT NULL
      ORDER BY updated_at DESC LIMIT 1`,
  );
  if (!result.ok) return [];

  const trace = result.rows[0]?.tool_trace;
  if (!Array.isArray(trace)) return [];

  for (const step of trace) {
    const candidates = (step as { output?: { candidates?: unknown } }).output?.candidates;
    if (Array.isArray(candidates) && candidates.length > 0) {
      return candidates as CandidateRow[];
    }
  }
  return [];
}
