import { readFile } from 'node:fs/promises';
import { insertVariants } from '../memory/variants.js';
import { upsertEntities } from '../memory/watchlist.js';
import type { NameVariantInput, WatchlistEntityInput } from '../memory/types.js';
import { parseSdnXml, type ParsedSdnEntry, type ParsedSdnList } from './ofac.js';

export const OFAC_SDN_URL =
  'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML';

/** Entity upserts carry no vector, so they batch freely. */
const ENTITY_CHUNK = 200;

export interface IngestSummary {
  publishDate: string | null;
  recordCount: number | null;
  entitiesParsed: number;
  entitiesWritten: number;
  aliasesWritten: number;
  skipped: number;
  byJurisdiction: Record<string, number>;
}

export async function loadSdnFile(path: string): Promise<ParsedSdnList> {
  const xml = await readFile(path, 'utf8');
  return parseSdnXml(xml);
}

/**
 * Write a parsed SDN list into the watchlist.
 *
 * Idempotent: entities upsert on (source_list, source_ref) and name variants
 * upsert on (entity_id, variant_text, variant_kind), so re-running against a
 * republished list updates in place rather than duplicating. Sanctions lists
 * are republished daily and this job is expected to run repeatedly.
 *
 * Embeddings are deliberately NOT written here. Phase 3 generates the full
 * variant set — reorderings, transliterations, shortenings — and embeds
 * everything in one pass, so a name is never embedded twice.
 */
export async function ingestSdn(
  list: ParsedSdnList,
  options: { onProgress?: (written: number, total: number) => void } = {},
): Promise<IngestSummary> {
  const entries = list.entries;
  const byJurisdiction: Record<string, number> = {};
  let entitiesWritten = 0;
  let aliasesWritten = 0;

  for (let i = 0; i < entries.length; i += ENTITY_CHUNK) {
    const chunk = entries.slice(i, i + ENTITY_CHUNK);
    const inputs: WatchlistEntityInput[] = chunk.map(toEntityInput);
    const ids = await upsertEntities(inputs);
    entitiesWritten += ids.length;

    for (const entry of chunk) {
      byJurisdiction[entry.jurisdiction] = (byJurisdiction[entry.jurisdiction] ?? 0) + 1;
    }

    // Primary name and every alias become name_variant rows immediately, so
    // aliases are queryable first-class data rather than buried in JSON.
    const variants: NameVariantInput[] = [];
    chunk.forEach((entry, idx) => {
      const entityId = ids[idx]!;
      variants.push({
        entityId,
        jurisdiction: entry.jurisdiction,
        variantText: entry.primaryName,
        variantKind: 'primary',
      });
      for (const alias of entry.aliases) {
        variants.push({
          entityId,
          jurisdiction: entry.jurisdiction,
          variantText: alias.name,
          variantKind: 'aka',
        });
      }
    });
    aliasesWritten += await insertVariants(variants);

    options.onProgress?.(Math.min(i + ENTITY_CHUNK, entries.length), entries.length);
  }

  return {
    publishDate: list.publishDate,
    recordCount: list.recordCount,
    entitiesParsed: entries.length,
    entitiesWritten,
    aliasesWritten,
    skipped: (list.recordCount ?? entries.length) - entries.length,
    byJurisdiction,
  };
}

function toEntityInput(entry: ParsedSdnEntry): WatchlistEntityInput {
  return {
    sourceList: 'OFAC_SDN',
    sourceRef: entry.uid,
    jurisdiction: entry.jurisdiction,
    primaryName: entry.primaryName,
    dob: entry.dob,
    nationality: entry.nationality,
    rawPayload: {
      sdnType: entry.sdnType,
      programs: entry.programs,
      aliases: entry.aliases,
      source: entry.raw,
    },
  };
}
