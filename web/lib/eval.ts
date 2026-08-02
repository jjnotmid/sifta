import headline from '@/data/eval-headline.json';

/**
 * The measured headline, imported as data.
 *
 * `web/data/eval-headline.json` is generated from `eval/results.md` by
 * `npm run eval:snapshot` and committed. It is deliberately NOT parsed from
 * the markdown at request time: `eval/` sits above the deployed app root, so
 * on any real deployment the file is not in the bundle, the parse returns
 * null, and the numbers section vanishes from the live site without a word.
 *
 * A committed snapshot goes stale if you forget to regenerate it — which is a
 * visible, fixable failure — rather than disappearing silently, which is not.
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
  generatedAt: string;
}

export function readEvalHeadline(): EvalHeadline {
  return headline as EvalHeadline;
}
