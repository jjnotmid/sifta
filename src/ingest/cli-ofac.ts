import { fileURLToPath } from 'node:url';
import { closePool } from '../memory/pool.js';
import { countEntities } from '../memory/watchlist.js';
import { downloadTo } from './download.js';
import { ingestSdn, loadSdnFile, OFAC_SDN_URL } from './ingest-ofac.js';

/**
 * Download (or reuse) the real OFAC SDN list and load it into the watchlist.
 *
 *   npm run ingest:ofac              # cached download, full ingest
 *   npm run ingest:ofac -- --refresh # force a fresh download
 *
 * The raw XML is cached under data/raw/ and gitignored. A small real-data
 * fixture lives in tests/fixtures/ so the parser tests need no network.
 */
const RAW_PATH = fileURLToPath(new URL('../../data/raw/sdn.xml', import.meta.url));

async function main(): Promise<void> {
  const refresh = process.argv.includes('--refresh');

  console.log(`OFAC SDN → ${RAW_PATH}`);
  const { bytes, cached } = await downloadTo(OFAC_SDN_URL, RAW_PATH, {
    useCache: !refresh,
  });
  console.log(
    cached
      ? `  using cached copy (${mb(bytes)} MB) — pass --refresh to re-download`
      : `  downloaded ${mb(bytes)} MB`,
  );

  const list = await loadSdnFile(RAW_PATH);
  console.log(
    `  published ${list.publishDate ?? 'unknown'}, ${list.recordCount ?? '?'} records declared, ${list.entries.length} parsed`,
  );

  const started = Date.now();
  const summary = await ingestSdn(list, {
    onProgress: (written, total) => {
      if (written % 2000 === 0 || written === total) {
        process.stdout.write(`\r  ingesting ${written}/${total}`);
      }
    },
  });
  process.stdout.write('\n');

  const total = await countEntities('OFAC_SDN');
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`  entities in database: ${total}`);
  console.log(`  name variants written this run: ${summary.aliasesWritten}`);
  console.log(`  by jurisdiction: ${formatJurisdictions(summary.byJurisdiction)}`);
  if (summary.skipped > 0) {
    console.log(`  skipped (no usable name): ${summary.skipped}`);
  }
  console.log(`  done in ${elapsed}s`);
}

function mb(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

function formatJurisdictions(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `${code}=${n}`)
    .join(' ');
}

main()
  .then(() => closePool())
  .catch(async (err: Error) => {
    console.error(`\ningest:ofac failed: ${err.message}`);
    await closePool();
    process.exit(1);
  });
