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
 * (opposite). This default is the operating point reported in eval/results.md;
 * `npm run eval` sweeps the full range rather than assuming it.
 */
export const DEFAULT_MATCH_THRESHOLD = 0.35;

export function isMatch(candidate: Candidate, threshold = DEFAULT_MATCH_THRESHOLD): boolean {
  return candidate.distance <= threshold;
}

export { screenSubject as default };
