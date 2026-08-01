import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/memory/migrate.js';
import { closePool, getPool } from '../../src/memory/pool.js';
import { countEntities, findEntityByRef } from '../../src/memory/watchlist.js';
import { countVariants } from '../../src/memory/variants.js';
import { ingestSdn } from '../../src/ingest/ingest-ofac.js';
import { parseOfacDate, parseSdnXml, toJurisdiction } from '../../src/ingest/ofac.js';
import { resetTables } from '../helpers/db.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/sdn-sample.xml', import.meta.url));

let xml: string;

beforeAll(async () => {
  xml = await readFile(FIXTURE, 'utf8');
  await migrate();
  await resetTables();
});

afterAll(async () => {
  await closePool();
});

describe('OFAC SDN parser', () => {
  it('parses every record in the fixture — none silently dropped', () => {
    const declared = (xml.match(/<sdnEntry>/g) ?? []).length;
    expect(declared).toBeGreaterThan(20); // the fixture is meaningfully sized

    const list = parseSdnXml(xml);
    // Every fixture record carries a name, so parsed count must equal the
    // number of records present. A regression that drops entries shows here.
    expect(list.entries).toHaveLength(declared);
  });

  it('reads the publication header', () => {
    const list = parseSdnXml(xml);
    expect(list.publishDate).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    // Record_Count describes the full published list, not the fixture subset.
    expect(list.recordCount).toBeGreaterThan(10_000);
  });

  it('extracts aliases rather than dropping them', () => {
    const list = parseSdnXml(xml);
    const withAliases = list.entries.filter((e) => e.aliases.length > 0);
    expect(withAliases.length).toBeGreaterThan(0);

    // Cross-check against the raw XML: every <aka> block carrying a name must
    // survive into a parsed alias, minus those that duplicate the primary name.
    const akaBlocks = (xml.match(/<aka>/g) ?? []).length;
    const parsedAliases = list.entries.reduce((n, e) => n + e.aliases.length, 0);
    expect(parsedAliases).toBeGreaterThan(akaBlocks * 0.8);

    for (const entry of withAliases) {
      for (const alias of entry.aliases) {
        expect(alias.name.trim()).not.toBe('');
        expect(alias.type).toMatch(/k\.a\./);
      }
    }
  });

  it('does not emit an alias that merely repeats the primary name', () => {
    const list = parseSdnXml(xml);
    for (const entry of list.entries) {
      const names = entry.aliases.map((a) => a.name.toUpperCase());
      expect(names).not.toContain(entry.primaryName.toUpperCase());
      expect(new Set(names).size).toBe(names.length); // no duplicate aliases
    }
  });

  it('parses entries with a missing DOB or nationality without erroring', () => {
    const list = parseSdnXml(xml);
    const noDob = list.entries.filter((e) => e.dob === null);
    const noNationality = list.entries.filter((e) => e.nationality === null);

    // The fixture is built to include both shapes; if it does not, the test
    // is not proving anything.
    expect(noDob.length).toBeGreaterThan(0);
    expect(noNationality.length).toBeGreaterThan(0);

    for (const entry of [...noDob, ...noNationality]) {
      expect(entry.primaryName).toBeTruthy();
      expect(entry.uid).toBeTruthy();
      expect(entry.jurisdiction).toBeTruthy();
    }
  });

  it('assigns a jurisdiction to every entry', () => {
    const list = parseSdnXml(xml);
    for (const entry of list.entries) {
      expect(['NG', 'GH', 'KE', 'GLOBAL']).toContain(entry.jurisdiction);
    }
    // The fixture deliberately includes African nationals.
    const african = list.entries.filter((e) => e.jurisdiction !== 'GLOBAL');
    expect(african.length).toBeGreaterThan(0);
  });
});

describe('jurisdiction mapping', () => {
  it('maps the seeded African countries and defaults everything else', () => {
    expect(toJurisdiction('Nigeria')).toBe('NG');
    expect(toJurisdiction('nigeria')).toBe('NG');
    expect(toJurisdiction('Ghana')).toBe('GH');
    expect(toJurisdiction('Kenya')).toBe('KE');
    expect(toJurisdiction('Cuba')).toBe('GLOBAL');
    expect(toJurisdiction(null)).toBe('GLOBAL');
  });
});

describe('OFAC date parsing', () => {
  it('parses an unambiguous full date', () => {
    expect(parseOfacDate('12 Mar 1957')).toBe('1957-03-12');
    expect(parseOfacDate('01 Jan 1980')).toBe('1980-01-01');
    expect(parseOfacDate('7 Sep 1962')).toBe('1962-09-07');
  });

  it('refuses to guess at a partial or fuzzy date', () => {
    // Inventing 1957-01-01 from "1957" would manufacture a DOB mismatch that
    // is not in the source — and DOB mismatch is exactly what analysts clear
    // alerts on.
    expect(parseOfacDate('1957')).toBeNull();
    expect(parseOfacDate('circa 1960')).toBeNull();
    expect(parseOfacDate('01 Jan 1980 to 31 Dec 1980')).toBeNull();
    expect(parseOfacDate('')).toBeNull();
    expect(parseOfacDate(undefined)).toBeNull();
  });

  it('rejects a calendar-impossible date', () => {
    expect(parseOfacDate('31 Feb 1970')).toBeNull();
    expect(parseOfacDate('12 Xyz 1957')).toBeNull();
  });
});

describe('ingestion into the watchlist', () => {
  it('writes entities and their name variants', async () => {
    const list = parseSdnXml(xml);
    const summary = await ingestSdn(list);

    expect(summary.entitiesWritten).toBe(list.entries.length);
    expect(await countEntities('OFAC_SDN')).toBe(list.entries.length);

    // One 'primary' variant per entity, plus one 'aka' per alias.
    const expectedVariants =
      list.entries.length + list.entries.reduce((n, e) => n + e.aliases.length, 0);
    expect(await countVariants()).toBe(expectedVariants);
  });

  it('preserves DOB, nationality and the raw payload on the row', async () => {
    const list = parseSdnXml(xml);
    const withDob = list.entries.find((e) => e.dob !== null);
    expect(withDob).toBeDefined();

    const stored = await findEntityByRef('OFAC_SDN', withDob!.uid);
    expect(stored).not.toBeNull();
    expect(stored!.dob).toBe(withDob!.dob);
    expect(stored!.primaryName).toBe(withDob!.primaryName);

    const payload = stored!.rawPayload as { programs: string[]; aliases: unknown[] };
    expect(Array.isArray(payload.programs)).toBe(true);
    expect(payload.aliases).toHaveLength(withDob!.aliases.length);
  });

  it('re-ingesting the same file does not duplicate rows', async () => {
    const list = parseSdnXml(xml);
    const entitiesBefore = await countEntities('OFAC_SDN');
    const variantsBefore = await countVariants();

    await ingestSdn(list);
    await ingestSdn(list);

    expect(await countEntities('OFAC_SDN')).toBe(entitiesBefore);
    expect(await countVariants()).toBe(variantsBefore);
  });

  it('updates in place when a republished record changes', async () => {
    const list = parseSdnXml(xml);
    const target = list.entries[0]!;

    const amended = {
      ...list,
      entries: [{ ...target, primaryName: `${target.primaryName} (AMENDED)` }],
    };
    await ingestSdn(amended);

    const stored = await findEntityByRef('OFAC_SDN', target.uid);
    expect(stored!.primaryName).toBe(`${target.primaryName} (AMENDED)`);
    // Still one row for that source_ref, not two.
    const { rows } = await getPool().query<{ n: string }>(
      `SELECT count(*)::STRING AS n FROM watchlist_entity WHERE source_list = 'OFAC_SDN' AND source_ref = $1`,
      [target.uid],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });
});
