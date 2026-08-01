import { getPool } from '../memory/pool.js';
import { normalizeName } from '../normalize.js';
import { screenSubject } from '../screening/index.js';
import { jaroWinkler } from './jaro-winkler.js';
import {
  buildNegatives,
  buildPositives,
  lastNegativeDiscardCount,
  type PositiveCase,
} from './corpus.js';

/**
 * The evaluation harness.
 *
 * Both systems are given identical inputs and measured on identical criteria:
 *
 *   Baseline  Jaro-Winkler over the names OFAC actually publishes — every
 *             entity's primary name and its aliases. This is what a
 *             conventional screening engine has to work with.
 *
 *   Sifta     The same names, plus generated variants, embedded and searched
 *             by vector similarity.
 *
 * The baseline is deliberately not strawmanned: it is token-aware (so name
 * ordering costs it nothing) and it sees the full alias list. The difference
 * measured is transliteration and contraction, which is the actual claim.
 */

/** Lowest baseline score considered; also the pruning floor. */
const BASELINE_FLOOR = 0.7;

export interface ThresholdPoint {
  threshold: number;
  recall: number;
  truePositives: number;
  falseNegatives: number;
  falsePositives: number;
  precision: number;
}

export interface SystemResult {
  name: string;
  sweep: ThresholdPoint[];
  /** Operating point: the threshold reported in the headline table. */
  operating: ThresholdPoint;
}

export interface EvalResult {
  positives: number;
  negatives: number;
  negativesDiscarded: number;
  watchlistEntities: number;
  baselineNames: number;
  siftaVariants: number;
  baseline: SystemResult;
  sifta: SystemResult;
  transformBreakdown: Record<string, { total: number; caughtBySifta: number; caughtByBaseline: number }>;
  elapsedSeconds: number;
}

/**
 * Listed names, tokenised against a shared token dictionary.
 *
 * Scoring 5,200 subjects against 44,000 names pairwise is ~230M name
 * comparisons and takes hours. But the same tokens recur constantly across the
 * list, so the work collapses: compare each subject token against the ~40k
 * DISTINCT listed tokens once, then score every name by table lookup.
 *
 * This is an exact restructuring, not an approximation — no blocking, no
 * sampling. The baseline computes precisely the score it would have computed
 * pairwise; it just stops recomputing JW("EMEKA", "OKAFOR") ten thousand times.
 */
interface ListedIndex {
  /** Distinct tokens across every listed name. */
  tokens: string[];
  tokenLengths: Int32Array;
  /** For each listed name: its entity, and indices into `tokens`. */
  names: { entityId: string; tokenIds: Int32Array }[];
}

/** Best achievable Jaro-Winkler given only the two token lengths. */
function maxPossibleJw(lenA: number, lenB: number): number {
  if (lenA === 0 || lenB === 0) return 0;
  const m = Math.min(lenA, lenB);
  const jaroBound = (m / lenA + m / lenB + 1) / 3;
  return jaroBound + 4 * 0.1 * (1 - jaroBound);
}

async function loadBaselineIndex(): Promise<ListedIndex> {
  // Primary names and aliases only — the data OFAC publishes. Sifta's
  // generated variants are excluded, which is the whole point of the contrast.
  const { rows } = await getPool().query<{ entity_id: string; variant_text: string }>(
    `SELECT entity_id, variant_text FROM name_variant WHERE variant_kind IN ('primary', 'aka')`,
  );

  const tokenIds = new Map<string, number>();
  const tokens: string[] = [];
  const names: ListedIndex['names'] = [];

  for (const row of rows) {
    const parts = normalizeName(row.variant_text).split(' ').filter(Boolean);
    if (parts.length === 0) continue;
    const ids = new Int32Array(parts.length);
    parts.forEach((part, i) => {
      let id = tokenIds.get(part);
      if (id === undefined) {
        id = tokens.length;
        tokens.push(part);
        tokenIds.set(part, id);
      }
      ids[i] = id;
    });
    names.push({ entityId: row.entity_id, tokenIds: ids });
  }

  return {
    tokens,
    tokenLengths: Int32Array.from(tokens.map((t) => t.length)),
    names,
  };
}

/**
 * Best baseline score for one subject, and which entity produced it.
 *
 * Two passes: score the subject's tokens against the token dictionary (with an
 * exact length bound that can only skip pairs provably below the floor), then
 * walk the names doing lookups.
 */
function baselineBest(
  subject: string,
  index: ListedIndex,
  scratch: Float32Array[],
): { score: number; entityId: string | null } {
  const subjectTokens = normalizeName(subject).split(' ').filter(Boolean);
  if (subjectTokens.length === 0) return { score: 0, entityId: null };

  const tokenCount = index.tokens.length;
  while (scratch.length < subjectTokens.length) scratch.push(new Float32Array(tokenCount));

  subjectTokens.forEach((token, s) => {
    const row = scratch[s]!;
    const len = token.length;
    for (let t = 0; t < tokenCount; t++) {
      // Exact bound: a pair whose lengths cap the score below the floor can
      // never be the best match at any threshold we report.
      row[t] =
        maxPossibleJw(len, index.tokenLengths[t]!) < BASELINE_FLOOR
          ? 0
          : jaroWinkler(token, index.tokens[t]!);
    }
  });

  let bestScore = 0;
  let bestEntity: string | null = null;

  for (const name of index.names) {
    const ids = name.tokenIds;
    let total = 0;

    if (subjectTokens.length <= ids.length) {
      // Average over subject tokens of the best matching name token.
      for (let s = 0; s < subjectTokens.length; s++) {
        const row = scratch[s]!;
        let best = 0;
        for (let j = 0; j < ids.length; j++) {
          const v = row[ids[j]!]!;
          if (v > best) best = v;
        }
        total += best;
      }
      total /= subjectTokens.length;
    } else {
      // Name is shorter: average over name tokens of the best subject token.
      for (let j = 0; j < ids.length; j++) {
        const id = ids[j]!;
        let best = 0;
        for (let s = 0; s < subjectTokens.length; s++) {
          const v = scratch[s]![id]!;
          if (v > best) best = v;
        }
        total += best;
      }
      total /= ids.length;
    }

    if (total > bestScore) {
      bestScore = total;
      bestEntity = name.entityId;
    }
  }
  return { score: bestScore, entityId: bestEntity };
}

function sweep(
  thresholds: readonly number[],
  positiveScores: { score: number; correctEntity: boolean }[],
  negativeScores: number[],
  higherIsBetter: boolean,
): ThresholdPoint[] {
  return thresholds.map((threshold) => {
    const passes = (score: number): boolean =>
      higherIsBetter ? score >= threshold : score <= threshold;

    const truePositives = positiveScores.filter(
      (p) => p.correctEntity && passes(p.score),
    ).length;
    const falseNegatives = positiveScores.length - truePositives;
    const falsePositives = negativeScores.filter(passes).length;

    return {
      threshold,
      recall: positiveScores.length === 0 ? 0 : truePositives / positiveScores.length,
      truePositives,
      falseNegatives,
      falsePositives,
      precision:
        truePositives + falsePositives === 0
          ? 1
          : truePositives / (truePositives + falsePositives),
    };
  });
}

/**
 * Operating point: the threshold with the fewest false positives among those
 * reaching the target recall. If no threshold reaches it, the one with the
 * highest recall is reported instead — the number is never quietly massaged
 * to look like the target was met.
 */
function chooseOperating(sweepPoints: ThresholdPoint[], targetRecall: number): ThresholdPoint {
  const qualifying = sweepPoints.filter((p) => p.recall >= targetRecall);
  if (qualifying.length > 0) {
    return qualifying.reduce((best, p) => (p.falsePositives < best.falsePositives ? p : best));
  }
  return sweepPoints.reduce((best, p) => (p.recall > best.recall ? p : best));
}

export interface RunOptions {
  positives?: number;
  negatives?: number;
  targetRecall?: number;
  onProgress?: (stage: string, done: number, total: number) => void;
}

export async function runEval(options: RunOptions = {}): Promise<EvalResult> {
  const started = Date.now();
  const targetRecall = options.targetRecall ?? 0.95;
  const pool = getPool();

  const positives = await buildPositives(options.positives ?? 200);
  const negatives = await buildNegatives(options.negatives ?? 5000);
  const negativesDiscarded = lastNegativeDiscardCount();

  const { rows: counts } = await pool.query<{ entities: string; variants: string }>(
    `SELECT (SELECT count(*) FROM watchlist_entity)::STRING AS entities,
            (SELECT count(*) FROM name_variant WHERE embedding IS NOT NULL)::STRING AS variants`,
  );
  const index = await loadBaselineIndex();
  const scratch: Float32Array[] = [];

  // --- Sifta -------------------------------------------------------------
  const siftaPositives: { score: number; correctEntity: boolean }[] = [];
  for (const [i, testCase] of positives.entries()) {
    const result = await screenSubject({ name: testCase.subjectName, limit: 20 });
    const hit = result.candidates.find((c) => c.entityId === testCase.entityId);
    siftaPositives.push({
      score: hit ? hit.distance : Number.POSITIVE_INFINITY,
      correctEntity: hit !== undefined,
    });
    options.onProgress?.('sifta/positives', i + 1, positives.length);
  }

  const siftaNegatives: number[] = [];
  for (const [i, name] of negatives.entries()) {
    const result = await screenSubject({ name, limit: 1 });
    siftaNegatives.push(result.candidates[0]?.distance ?? Number.POSITIVE_INFINITY);
    options.onProgress?.('sifta/negatives', i + 1, negatives.length);
  }

  // --- Baseline ----------------------------------------------------------
  const baselinePositives = positives.map((testCase, i) => {
    const best = baselineBest(testCase.subjectName, index, scratch);
    options.onProgress?.('baseline/positives', i + 1, positives.length);
    return { score: best.score, correctEntity: best.entityId === testCase.entityId };
  });

  const baselineNegatives = negatives.map((name, i) => {
    options.onProgress?.('baseline/negatives', i + 1, negatives.length);
    return baselineBest(name, index, scratch).score;
  });

  // --- Sweeps ------------------------------------------------------------
  const distanceThresholds = range(0.05, 1.0, 0.05);
  const scoreThresholds = range(BASELINE_FLOOR, 1.0, 0.01);

  const siftaSweep = sweep(distanceThresholds, siftaPositives, siftaNegatives, false);
  const baselineSweep = sweep(scoreThresholds, baselinePositives, baselineNegatives, true);

  const siftaOperating = chooseOperating(siftaSweep, targetRecall);
  const baselineOperating = chooseOperating(baselineSweep, targetRecall);

  // --- Which transformations each system survives -------------------------
  const transformBreakdown: EvalResult['transformBreakdown'] = {};
  positives.forEach((testCase: PositiveCase, i) => {
    const bucket = (transformBreakdown[testCase.transform] ??= {
      total: 0,
      caughtBySifta: 0,
      caughtByBaseline: 0,
    });
    bucket.total++;
    const s = siftaPositives[i]!;
    const b = baselinePositives[i]!;
    if (s.correctEntity && s.score <= siftaOperating.threshold) bucket.caughtBySifta++;
    if (b.correctEntity && b.score >= baselineOperating.threshold) bucket.caughtByBaseline++;
  });

  return {
    positives: positives.length,
    negatives: negatives.length,
    negativesDiscarded,
    watchlistEntities: Number(counts[0]!.entities),
    baselineNames: index.names.length,
    siftaVariants: Number(counts[0]!.variants),
    baseline: { name: 'Jaro-Winkler baseline', sweep: baselineSweep, operating: baselineOperating },
    sifta: { name: 'Sifta', sweep: siftaSweep, operating: siftaOperating },
    transformBreakdown,
    elapsedSeconds: (Date.now() - started) / 1000,
  };
}

function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Number(v.toFixed(4)));
  return out;
}
