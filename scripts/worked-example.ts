/**
 * Find a real worked example for the marketing page, and commit it as data.
 *
 * The homepage claim is "a customer writes their name a normal way, ordinary
 * screening misses them, Sifta catches them". That claim has to be true of a
 * specific real person on the real list, scored by the real matchers — not an
 * illustration someone drew. So this script searches for one.
 *
 * For each real OFAC individual it generates the variant set, then for every
 * variant asks both systems the same question:
 *
 *   baseline  max Jaro-Winkler similarity against the entity's primary name
 *             and every alias OFAC publishes — the best case for the baseline
 *   sifta     L2 distance from the vector index, and whether the top-ranked
 *             candidate is actually this entity
 *
 * A qualifying example is one the baseline misses at its own operating
 * threshold and Sifta catches at its own. Both thresholds come from
 * eval/results.md, so the page and the evaluation cannot disagree.
 *
 * Writes web/data/worked-example.json. Re-run after any change to the variant
 * rules or the embedder.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { nameSimilarity } from '../src/eval/jaro-winkler.js';
import { generateVariants } from '../src/ingest/variants.js';
import { closePool, getPool } from '../src/memory/pool.js';
import { screenSubject, DEFAULT_MATCH_THRESHOLD } from '../src/screening/index.js';

/** The baseline's operating threshold from eval/results.md (similarity). */
const BASELINE_THRESHOLD = 0.88;

const RESULTS = fileURLToPath(new URL('../eval/results.md', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../web/data/', import.meta.url));
const OUT = `${OUT_DIR}worked-example.json`;

interface Row {
  id: string;
  primary_name: string;
  nationality: string | null;
  dob: string | null;
  /**
   * Primary name plus every alias OFAC publishes, taken from `name_variant`
   * — the same rows `src/eval/run.ts` builds the baseline index from, so the
   * baseline here sees exactly what it sees in the evaluation.
   */
  known: string[];
}

interface WorkedExample {
  written: string;
  listed: string;
  variantKind: string;
  nationality: string | null;
  aliases: string[];
  baselineScore: number;
  baselineThreshold: number;
  baselineCaught: boolean;
  siftaDistance: number;
  siftaThreshold: number;
  siftaCaught: boolean;
  candidatesScreened: number;
  entitiesOnList: number;
  /** Baseline false positives at its operating threshold, from the eval. */
  baselineFalsePositivesAtOperating: number;
  /** Threshold the baseline would need to catch this person. */
  baselineThresholdToCatch: number;
  /** Baseline false positives at THAT threshold. The cost of catching him. */
  baselineFalsePositivesToCatch: number;
  generatedAt: string;
}

/** Prefer names our audience recognises; fall back to the whole list. */
const PREFERRED = ['Nigeria', 'Ghana', 'Kenya', 'NG', 'GH', 'KE'];

/**
 * How plausible each rule's output is as something a real person would write
 * on a transfer form. Lower is better.
 *
 * This matters because the widest *numeric* gap is not the best *argument*.
 * Dropping a name part can mangle a hyphenated surname into a stub — a real
 * transformation with a real score, but nobody writes that, so it reads as a
 * rigged example and undermines the honest numbers next to it. Initialised
 * middle names and traditional contractions are what banks actually receive.
 */
const KIND_RANK: Record<string, number> = {
  shortened: 0,
  initialised: 1,
  reordered: 2,
  deaccented: 3,
  translit: 4,
  dropped: 9,
};

async function main(): Promise<void> {
  const pool = getPool();

  const { rows: totals } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM watchlist_entity`,
  );
  // pg returns COUNT as a string; Number() so the committed JSON is typed.
  const entitiesOnList = Number(totals[0]!.n);

  const { rows } = await pool.query<Row>(
    `SELECT e.id, e.primary_name, e.nationality, e.dob::text,
            ARRAY(
              SELECT v.variant_text FROM name_variant v
               WHERE v.entity_id = e.id AND v.variant_kind IN ('primary', 'aka')
            ) AS known
       FROM watchlist_entity e
      WHERE e.raw_payload->>'sdnType' = 'Individual'
      ORDER BY
        CASE WHEN e.nationality = ANY($1) THEN 0 ELSE 1 END,
        e.id
      LIMIT 400`,
    [PREFERRED],
  );

  console.log(`Searching ${rows.length} real individuals for a qualifying example…`);

  type Partial = Omit<
    WorkedExample,
    | 'baselineFalsePositivesAtOperating'
    | 'baselineThresholdToCatch'
    | 'baselineFalsePositivesToCatch'
  >;
  const found: Partial[] = [];

  for (const row of rows) {
    // Everything the baseline is allowed to see. Giving it the full published
    // alias list is the point — the gap must not come from withholding data.
    const baselineCorpus = [row.primary_name, ...row.known].filter(
      (n): n is string => typeof n === 'string' && n.length > 0,
    );
    const aliases = row.known.filter((n) => n !== row.primary_name);

    for (const variant of generateVariants(row.primary_name)) {
      if (variant.kind === 'primary') continue;

      const baselineScore = Math.max(
        ...baselineCorpus.map((known) => nameSimilarity(variant.text, known)),
      );
      if (baselineScore >= BASELINE_THRESHOLD) continue; // baseline catches it

      const screen = await screenSubject({ name: variant.text, limit: 20 });
      const top = screen.candidates[0];
      if (!top || top.entityId !== row.id) continue; // must rank the right person first
      if (top.distance > DEFAULT_MATCH_THRESHOLD) continue; // Sifta misses it too

      const candidate: Omit<
        WorkedExample,
        | 'baselineFalsePositivesAtOperating'
        | 'baselineThresholdToCatch'
        | 'baselineFalsePositivesToCatch'
      > = {
        written: variant.text,
        listed: row.primary_name,
        variantKind: variant.kind,
        nationality: row.nationality,
        aliases: aliases.slice(0, 6),
        baselineScore: Number(baselineScore.toFixed(4)),
        baselineThreshold: BASELINE_THRESHOLD,
        baselineCaught: false,
        siftaDistance: Number(top.distance.toFixed(4)),
        siftaThreshold: DEFAULT_MATCH_THRESHOLD,
        siftaCaught: true,
        candidatesScreened: screen.candidates.length,
        entitiesOnList,
        generatedAt: new Date().toISOString().slice(0, 10),
      };

      found.push(candidate);
    }
  }

  // Plausibility first, then the entity's own relevance, then the numeric gap.
  const gap = (v: Partial) => v.siftaThreshold - v.siftaDistance + (1 - v.baselineScore);
  found.sort((a, b) => {
    // Relevance to the buyer first. Sifta is pitched at Nigerian institutions,
    // and a Nigerian-listed subject makes the example concrete for them in a
    // way an equally valid Yemeni one does not.
    const na = PREFERRED.includes(a.nationality ?? '') ? 0 : 1;
    const nb = PREFERRED.includes(b.nationality ?? '') ? 0 : 1;
    if (na !== nb) return na - nb;
    const ka = KIND_RANK[a.variantKind] ?? 5;
    const kb = KIND_RANK[b.variantKind] ?? 5;
    if (ka !== kb) return ka - kb;
    return gap(b) - gap(a);
  });

  console.log(`\n${found.length} qualifying examples. Top candidates:`);
  for (const v of found.slice(0, 8)) {
    console.log(
      `  ${v.written.padEnd(34)} ← ${v.listed.padEnd(38)} ` +
        `[${v.variantKind}] ${v.nationality ?? '—'} jw=${v.baselineScore} d=${v.siftaDistance}`,
    );
  }

  const best = found[0];
  if (!best) {
    console.error('No qualifying example found. Widen the search or re-run the ingest.');
    process.exitCode = 1;
    await closePool();
    return;
  }

  // What it would cost the baseline to catch this person by loosening up.
  // The obvious objection to any near-miss example is "just lower the
  // threshold", and the sweep already answers it.
  const sweep = await readBaselineSweep();
  const atOperating = sweep.get(BASELINE_THRESHOLD.toFixed(2)) ?? 0;
  let thresholdToCatch = BASELINE_THRESHOLD;
  let fpToCatch = atOperating;
  for (const [threshold, fps] of [...sweep.entries()].sort(
    (a, b) => Number(b[0]) - Number(a[0]),
  )) {
    if (Number(threshold) <= best.baselineScore) {
      thresholdToCatch = Number(threshold);
      fpToCatch = fps;
      break;
    }
  }

  const output: WorkedExample = {
    ...best,
    baselineFalsePositivesAtOperating: atOperating,
    baselineThresholdToCatch: thresholdToCatch,
    baselineFalsePositivesToCatch: fpToCatch,
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(
    `  catching him needs threshold ${thresholdToCatch} → ` +
      `${fpToCatch} false positives (vs ${atOperating})`,
  );
  console.log(`\nWrote web/data/worked-example.json`);
  console.log(`  written as "${best.written}", listed as "${best.listed}"`);
  console.log(
    `  baseline ${best.baselineScore} < ${best.baselineThreshold} (miss) · ` +
      `sifta ${best.siftaDistance} <= ${best.siftaThreshold} (catch)`,
  );

  await closePool();
}

/** The baseline sweep from eval/results.md: threshold -> false positives. */
async function readBaselineSweep(): Promise<Map<string, number>> {
  const markdown = await readFile(RESULTS, 'utf8');
  const section = markdown.split('## Full threshold sweep — Sifta')[0] ?? markdown;
  const map = new Map<string, number>();
  for (const line of section.split('\n')) {
    const m = /^\| (0\.\d{2}) \| [\d.]+% \| \d+ \| (\d+) \|/.exec(line.trim());
    if (m) map.set(m[1]!, Number(m[2]));
  }
  return map;
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await closePool();
});
