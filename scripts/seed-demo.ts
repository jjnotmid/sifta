/**
 * Raise a demo queue from data already in the database.
 *
 * Nothing here is invented, per the build rules. Two sources, both real:
 *
 *   True positives  Real OFAC SDN individuals, their names passed through the
 *                   Phase 3 variant generator and given one character-level
 *                   typo — the same construction the eval uses. These are
 *                   people who really are on the list, written the way a
 *                   customer might actually write them.
 *
 *   Noise           Synthetic Nigerian names combined from
 *                   `data/nigerian-names.json`, cross-checked against the
 *                   watchlist and discarded on a genuine collision. These are
 *                   ordinary customers who are not on any list.
 *
 * Each subject is screened for real, an alert is raised with the real match
 * distance, and the real agent loop investigates it. A handful are then
 * dispositioned by a "human", and their subjects re-screened, so the memory
 * recall path has something to recall.
 *
 * Idempotent: it clears previously seeded alerts first. The ledger is
 * append-only and is NOT cleared — see the note in `reset()`.
 */

import { investigate } from '../src/agent/index.js';
import { createAlert } from '../src/memory/alerts.js';
import { recordDecision } from '../src/memory/decisions.js';
import { closePool, getPool } from '../src/memory/pool.js';
import { subjectKey } from '../src/normalize.js';
import { screenSubject } from '../src/screening/index.js';
import { generateVariants } from '../src/ingest/variants.js';
import { applyTypo, buildNegatives, makeRng } from '../src/eval/corpus.js';

const SEED = 0x51f7a;
const POSITIVES = 16;
const NOISE = 10;

/** Analyst identities used for the seeded dispositions. */
const ANALYST = 'analyst@demo';

interface Subject {
  name: string;
  dob: string | null;
  nationality: string | null;
  origin: 'listed' | 'customer';
}

async function main(): Promise<void> {
  const rng = makeRng(SEED);

  await reset();

  const subjects = [
    ...(await listedSubjects(POSITIVES, rng)),
    ...(await customerSubjects(NOISE, rng)),
  ];

  console.log(`Raising ${subjects.length} alerts…`);

  const raised: {
    alertId: string;
    subject: Subject;
    matched: boolean;
    entityId: string | null;
  }[] = [];

  for (const subject of subjects) {
    const screen = await screenSubject({
      name: subject.name,
      dob: subject.dob,
      nationality: subject.nationality,
    });
    const best = screen.candidates[0];

    const alert = await createAlert({
      subjectName: subject.name,
      subjectKey: screen.subjectKey,
      subjectDob: subject.dob,
      subjectNat: subject.nationality,
      jurisdiction: subject.nationality ?? 'NG',
      txnRef: `TXN-${String(Math.floor(rng() * 1_000_000)).padStart(6, '0')}`,
      txnNarration: narration(subject, rng),
      matchedEntity: best?.entityId ?? null,
      matchDistance: best?.distance ?? null,
    });

    // The real agent loop, against the real database.
    const outcome = await investigate(alert);
    raised.push({
      alertId: alert.id,
      subject,
      matched: outcome.kind !== 'NO_CANDIDATES' && outcome.candidates.length > 0,
      entityId: best?.entityId ?? null,
    });
    process.stdout.write('.');
  }

  process.stdout.write('\n');

  // --- Give the memory layer something to recall -------------------------
  //
  // Disposition a few alerts as a human would, then raise a SECOND alert for
  // the same subjects. The second investigation hits the recall path and
  // auto-disposes from the ledger without an LLM call — which is the whole
  // product thesis, and the thing the two-Field comparison in the UI shows.
  // Must be subjects that actually produced a candidate inside the match
  // threshold. A subject with no candidates short-circuits at "nothing
  // matched" and never reaches the recall path, so clearing those would
  // demonstrate nothing.
  const toDisposition = raised.filter((r) => r.matched).slice(0, 2);
  if (toDisposition.length === 0) {
    console.warn('No alert matched inside the threshold; skipping the memory-recall seed.');
  }

  for (const { alertId, subject, entityId } of toDisposition) {
    await recordDecision({
      alertId,
      subjectKey: subjectKey(subject.name, subject.dob, subject.nationality),
      // The entity this subject was cleared AGAINST. Without it the ledger row
      // says "this person was cleared" without saying of what, and the recall
      // path correctly refuses to inherit it — a prior clearance against one
      // listed individual is not a clearance against a different one the
      // subject matches today.
      entityId,
      disposition: 'CLEARED',
      rationale:
        'Date of birth on file does not match the listed individual, and the customer has ' +
        'transacted on this account since 2019 with consistent counterparties. Name overlap only.',
      decidedBy: ANALYST,
      agentAssisted: true,
    });
    await getPool().query('UPDATE alert SET status = $1 WHERE id = $2', ['CLEARED', alertId]);
  }

  console.log(`Dispositioned ${toDisposition.length} alerts.`);

  for (const { subject } of toDisposition) {
    const screen = await screenSubject({
      name: subject.name,
      dob: subject.dob,
      nationality: subject.nationality,
    });
    const best = screen.candidates[0];
    const repeat = await createAlert({
      subjectName: subject.name,
      subjectKey: screen.subjectKey,
      subjectDob: subject.dob,
      subjectNat: subject.nationality,
      jurisdiction: subject.nationality ?? 'NG',
      txnRef: `TXN-${String(Math.floor(rng() * 1_000_000)).padStart(6, '0')}`,
      txnNarration: narration(subject, rng),
      matchedEntity: best?.entityId ?? null,
      matchDistance: best?.distance ?? null,
    });
    const outcome = await investigate(repeat);
    console.log(
      `  repeat screen of ${subject.name}: ${outcome.kind}` +
        (outcome.inheritedFrom ? ` (inherited ${outcome.inheritedFrom.slice(0, 8)})` : ''),
    );
  }

  const { rows } = await getPool().query<{ alerts: number; decisions: number }>(
    `SELECT (SELECT count(*)::int FROM alert) AS alerts,
            (SELECT count(*)::int FROM decision) AS decisions`,
  );
  console.log(`\nQueue: ${rows[0]!.alerts} alerts, ${rows[0]!.decisions} decisions.`);
  console.log('Run `cd web && npm run dev` and open http://localhost:3000/queue');

  await closePool();
}

/**
 * Clear prior seed output so re-running does not stack duplicate queues.
 *
 * `decision` is deliberately NOT cleared by DELETE — the table is append-only
 * by grant and by design, and a seed script that quietly deletes ledger rows
 * would contradict the guarantee the whole product rests on. Root can
 * truncate it if you genuinely want a clean slate; that is a decision for a
 * human at a psql prompt, not a side effect of seeding.
 */
async function reset(): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM investigation');
  await pool.query(
    `DELETE FROM alert WHERE id NOT IN (SELECT alert_id FROM decision)`,
  );
}

/** Real listed individuals, spelled the way a customer might write them. */
async function listedSubjects(count: number, rng: () => number): Promise<Subject[]> {
  const { rows } = await getPool().query<{
    primary_name: string;
    dob: string | null;
    nationality: string | null;
  }>(
    // Individuals only. PRD §9 scopes entity resolution to individuals, and a
    // demo queue full of shipping companies as "customers" would misrepresent
    // what the screening engine is for. `sdnType` is OFAC's own field, so this
    // is their classification rather than ours.
    `SELECT primary_name, dob::text, nationality
       FROM watchlist_entity
      WHERE raw_payload->>'sdnType' = 'Individual'
      ORDER BY id
      LIMIT $1`,
    [count * 4],
  );

  const subjects: Subject[] = [];
  for (const row of rows) {
    if (subjects.length >= count) break;
    const variants = generateVariants(row.primary_name);
    const pick = variants[Math.floor(rng() * variants.length)];
    if (!pick) continue;
    subjects.push({
      name: applyTypo(pick.text, rng),
      // The customer's own claimed identity, which is what makes DOB
      // comparison meaningful: it often differs from the listed record.
      dob: rng() > 0.5 ? row.dob : null,
      nationality: row.nationality,
      origin: 'listed',
    });
  }
  return subjects;
}

/**
 * Ordinary customers, from the eval's own negative-corpus builder.
 *
 * Reused rather than reimplemented: `buildNegatives` combines names from
 * `data/nigerian-names.json` and then cross-checks each one against the
 * ingested watchlist, discarding genuine collisions. A seeded queue whose
 * "clean" customers quietly included a real listed person would make the
 * memory demo a lie.
 */
async function customerSubjects(count: number, rng: () => number): Promise<Subject[]> {
  const names = await buildNegatives(count);
  return names.map((name) => ({
    name,
    dob: `19${60 + Math.floor(rng() * 40)}-0${1 + Math.floor(rng() * 9)}-1${Math.floor(rng() * 9)}`,
    nationality: 'NG',
    origin: 'customer' as const,
  }));
}

const NARRATIONS = [
  'Inbound wire from correspondent bank, trade settlement',
  'Outbound transfer to supplier account, invoice settlement',
  'Cross-border remittance, family support',
  'Merchant settlement, POS aggregator',
  'FX purchase, import duty payment',
];

function narration(subject: Subject, rng: () => number): string {
  const base = NARRATIONS[Math.floor(rng() * NARRATIONS.length)] ?? NARRATIONS[0]!;
  return `${base} — ${subject.name}`;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
