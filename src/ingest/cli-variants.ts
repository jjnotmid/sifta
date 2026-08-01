import { closePool, getPool } from '../memory/pool.js';
import { insertVariants } from '../memory/variants.js';
import type { NameVariantInput, VariantKind } from '../memory/types.js';
import { getEmbeddingProvider } from '../providers/index.js';
import { generateVariants } from './variants.js';

/**
 * Generate name variants for every listed individual, embed everything, and
 * write it to the semantic memory layer.
 *
 *   npm run ingest:variants                 # resume: only unembedded rows
 *   npm run ingest:variants -- --limit 500  # first N entities, for a smoke test
 *   npm run ingest:variants -- --all        # re-embed everything from scratch
 *
 * Resumable by default. On a bad connection or a laptop that sleeps, a run
 * that dies halfway can simply be re-run: entities whose variants already
 * carry an embedding are skipped.
 *
 * Only individuals get generated variants. Reordering the tokens of a vessel
 * name or a corporate entity produces noise, not recall — PRD §9 scopes entity
 * resolution to individuals. Every entity still keeps its primary name and
 * aliases embedded, so the full watchlist remains screenable.
 */

interface EntityRow {
  id: string;
  jurisdiction: string;
  primary_name: string;
  sdn_type: string | null;
  aliases: { name: string }[] | null;
}

const PAGE = 200;
const CONCURRENCY = 8;

/** Run `worker` over `items` with at most `concurrency` in flight. */
async function inParallel<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index]!);
    }
  });
  await Promise.all(runners);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const all = argv.includes('--all');
  const limitArg = argv.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(argv[limitArg + 1]) : Infinity;

  const embedder = getEmbeddingProvider();
  console.log(`embedding provider: ${embedder.name} (${embedder.dimensions} dims)`);
  console.log(all ? 'mode: re-embed everything' : 'mode: resume (unembedded only)');

  const pool = getPool();
  // Keyset pagination cursor. The zero UUID sorts before every generated one,
  // so the first page needs no special case.
  let after = '00000000-0000-0000-0000-000000000000';
  let entitiesProcessed = 0;
  let variantsWritten = 0;
  let skipped = 0;
  const started = Date.now();

  for (;;) {
    if (entitiesProcessed >= limit) break;

    // Two cheap queries rather than one joined aggregate. Joining
    // watchlist_entity to name_variant and grouping made every page scan the
    // whole variant table, so throughput collapsed as the table grew — the
    // pass got slower the more work it had done.
    const { rows } = await pool.query<EntityRow>(
      `SELECT id,
              jurisdiction,
              primary_name,
              raw_payload->>'sdnType' AS sdn_type,
              raw_payload->'aliases'  AS aliases
       FROM watchlist_entity
       WHERE id > $1
       ORDER BY id
       LIMIT $2`,
      [after, PAGE],
    );
    if (rows.length === 0) break;
    after = rows[rows.length - 1]!.id;

    // Embedded-variant counts for just this page, served by idx_variant_entity.
    const embeddedByEntity = new Map<string, number>();
    if (!all) {
      const { rows: counts } = await pool.query<{ entity_id: string; embedded: string }>(
        `SELECT entity_id, count(*)::STRING AS embedded
         FROM name_variant
         WHERE entity_id = ANY($1::UUID[]) AND embedding IS NOT NULL
         GROUP BY entity_id`,
        [rows.map((r) => r.id)],
      );
      for (const c of counts) embeddedByEntity.set(c.entity_id, Number(c.embedded));
    }

    const pending = rows.slice(0, Math.max(0, limit - entitiesProcessed));
    entitiesProcessed += pending.length;

    // Modest concurrency. The wall-clock cost here is round trips and vector
    // index maintenance, not CPU, so a handful of in-flight entities roughly
    // triples throughput. Kept at or below the pool size to avoid queueing.
    await inParallel(pending, CONCURRENCY, async (row) => {
      // Any embedded variant means this entity was handled by an earlier run.
      if (!all && (embeddedByEntity.get(row.id) ?? 0) > 0) {
        skipped++;
        return;
      }

      const isIndividual = row.sdn_type === 'Individual';
      const texts = new Map<string, VariantKind>();

      texts.set(row.primary_name.toUpperCase(), 'primary');
      for (const alias of row.aliases ?? []) {
        if (alias?.name) texts.set(alias.name.toUpperCase(), 'aka');
      }

      if (isIndividual) {
        // Generate from the primary name and from every alias: a customer may
        // write a shortened form of an alias just as readily as of the
        // primary name.
        const seeds = [row.primary_name, ...(row.aliases ?? []).map((a) => a.name)];
        for (const seed of seeds) {
          if (!seed) continue;
          for (const variant of generateVariants(seed)) {
            if (!texts.has(variant.text)) texts.set(variant.text, variant.kind);
          }
        }
      }

      const entries = [...texts.entries()];
      const embeddings = await embedder.embed(entries.map(([text]) => text));

      const inputs: NameVariantInput[] = entries.map(([text, kind], i) => ({
        entityId: row.id,
        jurisdiction: row.jurisdiction,
        variantText: text,
        variantKind: kind,
        embedding: embeddings[i]!,
      }));

      // Chunked at 10 by insertVariants — CockroachDB degrades badly on large
      // batched vector inserts.
      variantsWritten += await insertVariants(inputs, undefined, {
        onConflict: 'updateEmbedding',
      });
    });

    const elapsed = (Date.now() - started) / 1000;
    const rate = entitiesProcessed / Math.max(elapsed, 0.001);
    process.stdout.write(
      `\r  entities ${entitiesProcessed} (skipped ${skipped})  variants ${variantsWritten}  ${rate.toFixed(0)}/s   `,
    );
  }

  process.stdout.write('\n');

  const { rows: summary } = await pool.query<{ n: string; embedded: string }>(
    `SELECT count(*)::STRING AS n,
            count(*) FILTER (WHERE embedding IS NOT NULL)::STRING AS embedded
     FROM name_variant`,
  );
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`  name_variant rows: ${summary[0]!.n} (${summary[0]!.embedded} embedded)`);
  console.log(`  done in ${elapsed}s`);
}

main()
  .then(() => closePool())
  .catch(async (err: Error) => {
    console.error(`\ningest:variants failed: ${err.message}`);
    await closePool();
    process.exit(1);
  });
