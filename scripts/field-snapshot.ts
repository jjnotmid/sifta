/**
 * Snapshot one real screening result for the marketing hero.
 *
 * The hero Field reads the most recent investigation's candidate set out of
 * the database. That works locally and renders nothing at all on a deployment
 * with no cluster attached — which silently removes the single element the
 * brief says the product is remembered by (§5). The page did not break; the
 * signature just quietly wasn't there.
 *
 * The fix is not a decorative fallback. It is a real recorded screen — real
 * candidates, real variant spellings, real L2 distances — extracted here and
 * committed, exactly as the eval headline and the worked example are. Same
 * rule as everywhere else in this repo: generated from measurement, never
 * hand-written.
 *
 * Re-run after `npm run seed:demo`.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { closePool, getPool } from '../src/memory/pool.js';
import { DEFAULT_MATCH_THRESHOLD } from '../src/screening/index.js';

const OUT_DIR = fileURLToPath(new URL('../web/data/', import.meta.url));
const OUT = `${OUT_DIR}field-example.json`;

interface Candidate {
  variantText: string;
  primaryName: string;
  distance: number | string;
}

interface Cell {
  label: string;
  distance: number;
  state: 'candidate' | 'cleared' | 'match';
}

async function main(): Promise<void> {
  const pool = getPool();

  // Prefer a screen that actually found something: a Field with no amber
  // module demonstrates the grid but not the point of it.
  const { rows } = await pool.query<{ subject_name: string; tool_trace: unknown }>(
    `SELECT a.subject_name, i.tool_trace
       FROM investigation i
       JOIN alert a ON a.id = i.alert_id
      WHERE i.tool_trace IS NOT NULL
      ORDER BY a.match_distance ASC NULLS LAST, i.updated_at DESC
      LIMIT 20`,
  );

  let chosen: { subject: string; cells: Cell[] } | null = null;

  for (const row of rows) {
    const trace = row.tool_trace;
    if (!Array.isArray(trace)) continue;

    for (const step of trace) {
      const candidates = (step as { output?: { candidates?: unknown } }).output?.candidates;
      if (!Array.isArray(candidates) || candidates.length === 0) continue;

      const cells: Cell[] = (candidates as Candidate[]).map((c) => {
        const distance = Number(c.distance);
        return {
          label: `${c.variantText}  ·  ${c.primaryName}`,
          distance: Number(distance.toFixed(4)),
          state: distance <= DEFAULT_MATCH_THRESHOLD ? 'match' : 'cleared',
        };
      });

      if (cells.some((c) => c.state === 'match')) {
        chosen = { subject: row.subject_name, cells };
        break;
      }
      chosen ??= { subject: row.subject_name, cells };
    }
    if (chosen?.cells.some((c) => c.state === 'match')) break;
  }

  if (!chosen) {
    console.error('No recorded screen found. Run `npm run seed:demo` first.');
    process.exitCode = 1;
    await closePool();
    return;
  }

  const payload = {
    subject: chosen.subject,
    threshold: DEFAULT_MATCH_THRESHOLD,
    cells: chosen.cells,
    generatedAt: new Date().toISOString().slice(0, 10),
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const matches = chosen.cells.filter((c) => c.state === 'match').length;
  console.log(`Wrote web/data/field-example.json`);
  console.log(`  screen of "${chosen.subject}": ${chosen.cells.length} candidates, ${matches} match`);

  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await closePool();
});
