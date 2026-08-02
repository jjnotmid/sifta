'use server';

import { revalidatePath } from 'next/cache';
import { getPool } from '@/lib/db';
import type { Disposition } from '@/lib/queries';

/**
 * Record an analyst's disposition.
 *
 * Two writes in one transaction: an INSERT into the append-only ledger, and a
 * status change on the alert. The ledger row is never updated — the
 * `sifta_app` grant does not permit it, so this is enforced by the database
 * rather than by this function being careful.
 *
 * The rationale is required and is not defaulted. It is the analyst's own
 * words about why this person is or is not the sanctioned individual, and it
 * is the thing the next screen of the same subject inherits. Auto-filling it
 * would poison the memory layer with text no human ever wrote.
 */
export async function dispositionAlert(input: {
  alertId: string;
  disposition: Disposition;
  rationale: string;
  decidedBy: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const rationale = input.rationale.trim();
  if (rationale.length < 8) {
    return {
      ok: false,
      error: 'A rationale is required. This is the record a regulator reads.',
    };
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{ subject_key: string; matched_entity: string | null }>(
      'SELECT subject_key, matched_entity FROM alert WHERE id = $1',
      [input.alertId],
    );
    const alert = rows[0];
    if (!alert) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Alert not found.' };
    }

    await client.query(
      `INSERT INTO decision
         (alert_id, subject_key, entity_id, disposition, rationale, decided_by, agent_assisted)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [
        input.alertId,
        alert.subject_key,
        alert.matched_entity,
        input.disposition,
        rationale,
        input.decidedBy,
      ],
    );

    await client.query('UPDATE alert SET status = $1 WHERE id = $2', [
      input.disposition,
      input.alertId,
    ]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return {
      ok: false,
      // State what happened and what to do (§8). No apology.
      error: `Could not record the decision. ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    client.release();
  }

  revalidatePath('/queue');
  revalidatePath('/ledger');
  revalidatePath(`/alerts/${input.alertId}`);
  return { ok: true };
}
