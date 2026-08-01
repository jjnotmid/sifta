import { XMLParser } from 'fast-xml-parser';

/**
 * Parser for the OFAC SDN list as published by the Sanctions List Service.
 *
 * Shape (abbreviated), confirmed against the 30 July 2026 publication:
 *
 *   <sdnList>
 *     <publshInformation><Publish_Date/><Record_Count/></publshInformation>
 *     <sdnEntry>
 *       <uid/> <firstName/> <lastName/> <sdnType/>
 *       <programList><program/></programList>
 *       <akaList><aka><type/><category/><firstName/><lastName/></aka></akaList>
 *       <nationalityList><nationality><country/></nationality></nationalityList>
 *       <citizenshipList><citizenship><country/></citizenship></citizenshipList>
 *       <dateOfBirthList><dateOfBirthItem><dateOfBirth/></dateOfBirthItem></dateOfBirthList>
 *       <addressList><address><country/></address></addressList>
 *     </sdnEntry>
 *   </sdnList>
 *
 * Note `publshInformation` — the typo is OFAC's and is part of the format.
 */

export interface SdnAlias {
  name: string;
  type: string;
  category: string;
}

export interface ParsedSdnEntry {
  uid: string;
  sdnType: string;
  primaryName: string;
  aliases: SdnAlias[];
  dob: string | null;
  nationality: string | null;
  jurisdiction: string;
  programs: string[];
  raw: unknown;
}

export interface ParsedSdnList {
  publishDate: string | null;
  recordCount: number | null;
  entries: ParsedSdnEntry[];
}

/**
 * Countries whose nationals we partition into a dedicated jurisdiction.
 *
 * Everything else lands in GLOBAL. This is a *performance* partition on the
 * vector index, not a compliance filter — a screen still covers every
 * partition (see src/screening). Splitting the African jurisdictions out is
 * what lets the demo show a bounded, single-partition scan on camera.
 */
const JURISDICTION_BY_COUNTRY: Record<string, string> = {
  nigeria: 'NG',
  nigerian: 'NG',
  ghana: 'GH',
  ghanaian: 'GH',
  kenya: 'KE',
  kenyan: 'KE',
};

export const GLOBAL_JURISDICTION = 'GLOBAL';

const parser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  parseTagValue: false, // keep uids and dates as strings
  isArray: (name) =>
    [
      'sdnEntry',
      'program',
      'aka',
      'nationality',
      'citizenship',
      'dateOfBirthItem',
      'address',
      'id',
      'placeOfBirthItem',
    ].includes(name),
});

export function parseSdnXml(xml: string): ParsedSdnList {
  const doc = parser.parse(xml) as {
    sdnList?: {
      publshInformation?: { Publish_Date?: string; Record_Count?: string };
      sdnEntry?: RawEntry[];
    };
  };
  const list = doc.sdnList;
  if (!list) throw new Error('not an OFAC SDN document: missing <sdnList> root');

  const rawEntries = list.sdnEntry ?? [];
  const entries = rawEntries.map(toEntry).filter((e): e is ParsedSdnEntry => e !== null);

  const count = list.publshInformation?.Record_Count;
  return {
    publishDate: list.publshInformation?.Publish_Date ?? null,
    recordCount: count === undefined ? null : Number(count),
    entries,
  };
}

interface RawEntry {
  uid?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  sdnType?: string;
  programList?: { program?: string[] };
  akaList?: { aka?: RawAka[] };
  nationalityList?: { nationality?: { country?: string }[] };
  citizenshipList?: { citizenship?: { country?: string }[] };
  dateOfBirthList?: { dateOfBirthItem?: { dateOfBirth?: string }[] };
  addressList?: { address?: { country?: string }[] };
}

interface RawAka {
  type?: string;
  category?: string;
  firstName?: string;
  lastName?: string;
}

function toEntry(raw: RawEntry): ParsedSdnEntry | null {
  const uid = raw.uid;
  if (!uid) return null;

  const primaryName = joinName(raw.firstName, raw.lastName);
  // A record with no usable name cannot be screened against; skipping it is
  // correct, but it must not silently vanish, so the ingest CLI reports the
  // count of skipped records.
  if (!primaryName) return null;

  const aliases: SdnAlias[] = [];
  const seen = new Set<string>([primaryName.toUpperCase()]);
  for (const aka of raw.akaList?.aka ?? []) {
    const name = joinName(aka.firstName, aka.lastName);
    if (!name) continue;
    const key = name.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push({
      name,
      type: aka.type ?? 'a.k.a.',
      category: aka.category ?? 'unknown',
    });
  }

  const nationality =
    firstCountry(raw.nationalityList?.nationality) ??
    firstCountry(raw.citizenshipList?.citizenship) ??
    firstCountry(raw.addressList?.address);

  return {
    uid,
    sdnType: raw.sdnType ?? 'Unknown',
    primaryName,
    aliases,
    dob: parseOfacDate(raw.dateOfBirthList?.dateOfBirthItem?.[0]?.dateOfBirth),
    nationality,
    jurisdiction: toJurisdiction(nationality),
    programs: raw.programList?.program ?? [],
    raw,
  };
}

function firstCountry(items: { country?: string }[] | undefined): string | null {
  for (const item of items ?? []) {
    if (item.country) return item.country;
  }
  return null;
}

export function toJurisdiction(country: string | null): string {
  if (!country) return GLOBAL_JURISDICTION;
  return JURISDICTION_BY_COUNTRY[country.trim().toLowerCase()] ?? GLOBAL_JURISDICTION;
}

function joinName(first?: string, last?: string): string {
  return [first, last]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * OFAC dates of birth are free text. Real examples: "12 Mar 1957",
 * "1957", "circa 1960", "01 Jan 1980 to 31 Dec 1980".
 *
 * Only an unambiguous full date becomes a DATE. A year alone or a range is
 * deliberately dropped rather than guessed: DOB is evidence an analyst clears
 * on ("DOB mismatch"), and inventing 1957-01-01 from "1957" would manufacture
 * a mismatch that is not in the source data.
 */
export function parseOfacDate(input: string | undefined): string | null {
  if (!input) return null;
  const text = input.trim();
  const match = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(text);
  if (!match) return null;
  const [, day, monthName, year] = match;
  const month = MONTHS[monthName!.toLowerCase()];
  if (!month) return null;
  const dd = day!.padStart(2, '0');
  const iso = `${year}-${month}-${dd}`;
  // Reject impossible dates like 31 Feb.
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCDate() !== Number(dd)) return null;
  return iso;
}
