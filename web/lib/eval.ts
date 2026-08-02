import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * The headline numbers, parsed out of `eval/results.md`.
 *
 * They are read from the generated file rather than typed into the page, so
 * the marketing claim cannot drift from the last `npm run eval`. If the file
 * is missing or its shape changes, this returns null and the page omits the
 * section — an absent number is honest, a stale hardcoded one is not.
 */

export interface EvalHeadline {
  positives: number;
  negatives: number;
  matchedRecall: string;
  baselineFalsePositives: number;
  siftaFalsePositives: number;
  baselinePrecision: string;
  siftaPrecision: string;
  reduction: string;
  entities: number;
  variants: number;
}

export async function readEvalHeadline(): Promise<EvalHeadline | null> {
  let markdown: string;
  try {
    markdown = await readFile(path.join(process.cwd(), '..', 'eval', 'results.md'), 'utf8');
  } catch {
    return null;
  }

  const recall = /the baseline's own ceiling \(([\d.]+%)\)/.exec(markdown);
  const fpRow = /\| False positives \(of (\d+)\) \| (\d+) \| (\d+) \|/.exec(markdown);
  const precisionRow = /\| Precision \| ([\d.]+%) \| ([\d.]+%) \|/.exec(markdown);
  // The label is wrapped in `**` in the source, so the asterisks sit BEFORE
  // "False-positive", not after the colon. Tolerate either.
  const reduction = /False-positive reduction at matched recall:\s*\*{0,2}([\d.]+%)/.exec(markdown);
  const positives = /\| Known positives \| (\d+) \|/.exec(markdown);
  const entities = /\| Watchlist entities \| ([\d,]+) \|/.exec(markdown);
  const variants = /\| Embedded variants available to Sifta \| ([\d,]+) \|/.exec(markdown);

  if (!recall || !fpRow || !precisionRow || !reduction) return null;

  return {
    positives: positives ? Number(positives[1]) : 0,
    negatives: Number(fpRow[1]),
    matchedRecall: recall[1]!,
    baselineFalsePositives: Number(fpRow[2]),
    siftaFalsePositives: Number(fpRow[3]),
    baselinePrecision: precisionRow[1]!,
    siftaPrecision: precisionRow[2]!,
    reduction: reduction[1]!,
    entities: entities ? Number(entities[1]!.replace(/,/g, '')) : 0,
    variants: variants ? Number(variants[1]!.replace(/,/g, '')) : 0,
  };
}
