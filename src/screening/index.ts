import { CANDIDATE_LIMIT, JURISDICTIONS } from '../config.js';
import { searchCandidates } from '../memory/variants.js';
import type { Candidate } from '../memory/types.js';
import { subjectKey } from '../normalize.js';
import { getEmbeddingProvider } from '../providers/index.js';

export interface ScreenRequest {
  name: string;
  dob?: string | null;
  nationality?: string | null;
  /** Index partitions to scan. Defaults to all — see the note below. */
  partitions?: readonly string[];
  limit?: number;
}

export interface ScreenResult {
  /** Normalised identity used to recall prior decisions for this subject. */
  subjectKey: string;
  candidates: Candidate[];
  partitionsScanned: readonly string[];
}

/**
 * Screen one subject against the watchlist.
 *
 * Every partition is scanned by default. The jurisdiction prefix on the vector
 * index bounds each individual scan — which is what makes the index
 * distributed and what `npm run explain` demonstrates — but scoping a screen
 * to a single jurisdiction would be a compliance failure, not an optimisation:
 * OFAC lists 29 Nigerian nationals and 19,125 everyone-else, and a Nigerian
 * customer can perfectly well match any of them.
 *
 * Partitions are scanned concurrently and their results merged and re-ranked,
 * so the cost is one round trip, not four.
 */
export async function screenSubject(request: ScreenRequest): Promise<ScreenResult> {
  const partitions = request.partitions ?? JURISDICTIONS;
  const limit = request.limit ?? CANDIDATE_LIMIT;
  const embedder = getEmbeddingProvider();

  const [embedding] = await embedder.embed([request.name]);
  if (!embedding) throw new Error(`embedding provider returned nothing for "${request.name}"`);

  const perPartition = await Promise.all(
    partitions.map((partition) => searchCandidates(partition, embedding, limit)),
  );

  // Merge, then keep the single best variant per entity: one listed person
  // may own a dozen generated spellings and returning all of them would fill
  // the analyst's candidate set with the same individual.
  const bestByEntity = new Map<string, Candidate>();
  for (const candidate of perPartition.flat()) {
    const existing = bestByEntity.get(candidate.entityId);
    if (!existing || candidate.distance < existing.distance) {
      bestByEntity.set(candidate.entityId, candidate);
    }
  }

  const candidates = [...bestByEntity.values()]
    .sort((a, b) => a.distance - b.distance || a.entityId.localeCompare(b.entityId))
    .slice(0, limit);

  return {
    subjectKey: subjectKey(request.name, request.dob, request.nationality),
    candidates,
    partitionsScanned: partitions,
  };
}

/**
 * Distance at or below which a candidate is treated as a match.
 *
 * Embeddings are L2-normalised, so distance runs 0 (identical) to 2
 * (opposite).
 *
 * This is the operating point measured in eval/results.md: 95.0% recall at
 * 290 false positives over 5,000 clean names. It is taken from the sweep, not
 * chosen by intuition — and the sweep is why it is 0.90 rather than the 0.35
 * this constant originally held. At 0.35 the engine recalls **3.5%** of known
 * hits, missing 193 of 200. That is not a conservative setting; in AML a
 * missed hit is the compliance failure, and a screen that silently drops 96%
 * of true matches while looking clean is the worst outcome this system can
 * produce.
 *
 * Re-run `npm run eval` after any change to the embedder or the variant rules
 * and move this to whatever the new sweep reports. It is a measured value
 * with a shelf life, not a constant.
 */
export const DEFAULT_MATCH_THRESHOLD = 0.9;

export function isMatch(candidate: Candidate, threshold = DEFAULT_MATCH_THRESHOLD): boolean {
  return candidate.distance <= threshold;
}

export { screenSubject as default };
