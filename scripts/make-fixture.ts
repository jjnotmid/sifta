import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Carve a small, committable fixture out of the real OFAC SDN download.
 *
 * Every record in the fixture is genuine OFAC data, copied verbatim. Nothing
 * is synthesised — the parser tests would be worthless if they ran against
 * hand-written XML that happened to match the parser's assumptions.
 *
 * Selection is deliberate rather than "first N": the fixture must contain the
 * awkward shapes the parser has to survive, otherwise the tests only prove it
 * handles the easy case.
 *
 *   npx tsx scripts/make-fixture.ts
 */
const SOURCE = fileURLToPath(new URL('../data/raw/sdn.xml', import.meta.url));
const DEST = fileURLToPath(new URL('../tests/fixtures/sdn-sample.xml', import.meta.url));

interface Pick {
  label: string;
  match: (block: string) => boolean;
  limit: number;
}

const PICKS: Pick[] = [
  {
    label: 'Nigerian nationals (the domain the product exists for)',
    match: (b) => /<country>Nigeria<\/country>/.test(b),
    limit: 12,
  },
  {
    label: 'Ghanaian / Kenyan (proves jurisdiction partitioning is real)',
    match: (b) => /<country>(Ghana|Kenya)<\/country>/.test(b),
    limit: 6,
  },
  {
    label: 'individuals with a full parseable DOB',
    match: (b) =>
      /<sdnType>Individual<\/sdnType>/.test(b) &&
      /<dateOfBirth>\d{1,2}\s+[A-Za-z]{3}\s+\d{4}<\/dateOfBirth>/.test(b),
    limit: 8,
  },
  {
    label: 'individuals with a year-only or fuzzy DOB (must not be guessed at)',
    match: (b) =>
      /<dateOfBirth>/.test(b) &&
      !/<dateOfBirth>\d{1,2}\s+[A-Za-z]{3}\s+\d{4}<\/dateOfBirth>/.test(b),
    limit: 5,
  },
  {
    label: 'entries with no DOB and no nationality (must parse, not throw)',
    match: (b) => !/<dateOfBirth>/.test(b) && !/<nationalityList>/.test(b),
    limit: 5,
  },
  {
    label: 'entries with many aliases (alias extraction must not drop any)',
    match: (b) => (b.match(/<aka>/g) ?? []).length >= 4,
    limit: 6,
  },
  {
    label: 'non-individual records (vessels, entities)',
    match: (b) => /<sdnType>(Vessel|Entity)<\/sdnType>/.test(b),
    limit: 4,
  },
];

async function main(): Promise<void> {
  const xml = await readFile(SOURCE, 'utf8');

  const header = xml.slice(0, xml.indexOf('<sdnEntry>'));
  // OFAC publishes with CRLF line endings.
  const blocks = [...xml.matchAll(/ {2}<sdnEntry>[\s\S]*?<\/sdnEntry>\r?\n/g)].map(
    (m) => m[0],
  );
  if (blocks.length === 0) throw new Error('no <sdnEntry> blocks found in source');

  const chosen = new Map<string, string>();
  const report: string[] = [];

  for (const pick of PICKS) {
    let taken = 0;
    for (const block of blocks) {
      if (taken >= pick.limit) break;
      const uid = /<uid>(\d+)<\/uid>/.exec(block)?.[1];
      if (!uid || chosen.has(uid)) continue;
      if (!pick.match(block)) continue;
      chosen.set(uid, block);
      taken++;
    }
    report.push(`  ${taken.toString().padStart(3)}  ${pick.label}`);
  }

  const body = [...chosen.values()].join('');
  const fixture = `${header}${body}</sdnList>\n`;

  await mkdir(dirname(DEST), { recursive: true });
  await writeFile(DEST, fixture, 'utf8');

  console.log(`fixture: ${chosen.size} real SDN records from ${blocks.length} available`);
  console.log(report.join('\n'));
  console.log(`written to ${DEST} (${(fixture.length / 1024).toFixed(1)} KB)`);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
