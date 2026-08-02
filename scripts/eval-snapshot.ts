/**
 * Snapshot the eval headline into `web/data/eval-headline.json`.
 *
 * The marketing page used to parse `eval/results.md` at request time. That
 * works locally and breaks the moment the app is deployed on its own: the
 * console is rooted at `web/`, so a file one directory up is not in the
 * bundle, the parse returns null, and the entire numbers section silently
 * disappears from the live site. Silent omission is exactly the failure mode
 * that section was written to avoid.
 *
 * So the numbers are extracted here, by script, and committed as JSON inside
 * `web/`. Still generated from the measured file — never hand-typed — but now
 * a plain import that works anywhere with no filesystem access at all.
 *
 * Re-run this after every `npm run eval`; `npm run verify` should call both.
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const RESULTS = fileURLToPath(new URL('../eval/results.md', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../web/data/', import.meta.url));
const OUT = `${OUT_DIR}eval-headline.json`;

interface Headline {
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
  generatedAt: string;
}

function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(
      `Could not find ${what} in eval/results.md. Re-run 'npm run eval' first; ` +
        `if the report's wording changed, update the patterns in scripts/eval-snapshot.ts.`,
    );
  }
  return value;
}

async function main(): Promise<void> {
  const markdown = await readFile(RESULTS, 'utf8');

  const recall = need(/the baseline's own ceiling \(([\d.]+%)\)/.exec(markdown), 'matched recall');
  const fp = need(
    /\| False positives \(of (\d+)\) \| (\d+) \| (\d+) \|/.exec(markdown),
    'the false-positive row',
  );
  const precision = need(
    /\| Precision \| ([\d.]+%) \| ([\d.]+%) \|/.exec(markdown),
    'the precision row',
  );
  const reduction = need(
    /False-positive reduction at matched recall:\s*\*{0,2}([\d.]+%)/.exec(markdown),
    'the reduction figure',
  );
  const positives = need(/\| Known positives \| (\d+) \|/.exec(markdown), 'the positive count');
  const entities = need(/\| Watchlist entities \| ([\d,]+) \|/.exec(markdown), 'the entity count');
  const variants = need(
    /\| Embedded variants available to Sifta \| ([\d,]+) \|/.exec(markdown),
    'the variant count',
  );

  const headline: Headline = {
    positives: Number(positives[1]),
    negatives: Number(fp[1]),
    matchedRecall: recall[1]!,
    baselineFalsePositives: Number(fp[2]),
    siftaFalsePositives: Number(fp[3]),
    baselinePrecision: precision[1]!,
    siftaPrecision: precision[2]!,
    reduction: reduction[1]!,
    entities: Number(entities[1]!.replace(/,/g, '')),
    variants: Number(variants[1]!.replace(/,/g, '')),
    generatedAt: new Date().toISOString().slice(0, 10),
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT, `${JSON.stringify(headline, null, 2)}\n`, 'utf8');

  console.log(`Wrote web/data/eval-headline.json`);
  console.log(
    `  ${headline.reduction} fewer false positives at ${headline.matchedRecall} matched recall ` +
      `(${headline.baselineFalsePositives} → ${headline.siftaFalsePositives})`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
