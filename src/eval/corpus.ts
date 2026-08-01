import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPool } from '../memory/pool.js';
import { normalizeName } from '../normalize.js';
import { generateVariants } from '../ingest/variants.js';

/**
 * Evaluation corpora.
 *
 * Everything here is deterministic — a fixed-seed PRNG and fixed SQL ordering
 * — so `npm run eval` twice produces byte-identical numbers. A benchmark you
 * cannot reproduce is a marketing claim, not a measurement.
 */

const NAMES_PATH = fileURLToPath(new URL('../../data/nigerian-names.json', import.meta.url));

export const POSITIVE_SEED = 0x5_1f7a;
export const NEGATIVE_SEED = 0x9_c3e1;

/** mulberry32 — small, fast, and reproducible across platforms. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length]!;
}

// ---------------------------------------------------------------------------
// Known positives
// ---------------------------------------------------------------------------

export interface PositiveCase {
  /** What the customer wrote on the transfer. */
  subjectName: string;
  /** The entity that must be found. */
  entityId: string;
  /** How the watchlist spells it. */
  listedName: string;
  /** Which variant rule produced the base spelling, before the typo. */
  transform: string;
}

/**
 * 200 real SDN individuals, each rendered the way a customer might actually
 * write them.
 *
 * METHODOLOGY — this matters, and is restated in eval/results.md.
 *
 * A naive positive set would take a name, run it through Sifta's own variant
 * generator, and check that Sifta finds it. That is circular: the string would
 * already be sitting in the index verbatim, and the test would prove only that
 * the pipeline is self-consistent.
 *
 * So every positive gets a single character-level typo applied on top of the
 * variant transformation. The resulting string appears verbatim in NEITHER
 * system's index. Sifta has to generalise from a near neighbour; the baseline
 * has to absorb the same noise. Both are handed identical inputs.
 */
export async function buildPositives(count = 200): Promise<PositiveCase[]> {
  const pool = getPool();
  // Deterministic selection: individuals with a multi-token name, ordered by
  // primary key, sampled at a fixed stride so the set is stable and spread
  // across the list rather than clustered at one end.
  const { rows } = await pool.query<{ id: string; primary_name: string }>(
    `SELECT id, primary_name
     FROM watchlist_entity
     WHERE raw_payload->>'sdnType' = 'Individual'
       AND array_length(string_to_array(primary_name, ' '), 1) >= 2
     ORDER BY id`,
  );
  if (rows.length < count) {
    throw new Error(
      `need ${count} listed individuals for the positive set, found ${rows.length}. Run: npm run ingest:ofac`,
    );
  }

  const stride = Math.floor(rows.length / count);
  const rng = makeRng(POSITIVE_SEED);
  const cases: PositiveCase[] = [];

  for (let i = 0; i < count; i++) {
    const row = rows[i * stride]!;
    const listed = normalizeName(row.primary_name);

    // Choose a spelling a customer might plausibly use. Prefer a generated
    // variant; fall back to the listed name when no rule fires.
    const variants = generateVariants(row.primary_name);
    const chosen = variants.length > 0 ? pick(rng, variants) : null;
    const base = chosen?.text ?? listed;

    cases.push({
      subjectName: applyTypo(base, rng),
      entityId: row.id,
      listedName: listed,
      transform: chosen?.kind ?? 'none',
    });
  }
  return cases;
}

/**
 * One realistic keying error: adjacent transposition, deletion, or
 * substitution. Never applied to a name short enough for the result to be
 * meaningless.
 */
export function applyTypo(name: string, rng: () => number): string {
  const chars = [...name];
  const editable = chars
    .map((c, i) => (c === ' ' ? -1 : i))
    .filter((i) => i > 0 && i < chars.length - 1);
  if (editable.length < 2) return name;

  const at = pick(rng, editable);
  const mode = Math.floor(rng() * 3);

  if (mode === 0 && chars[at + 1] !== ' ') {
    const next = chars[at + 1]!;
    chars[at + 1] = chars[at]!;
    chars[at] = next;
  } else if (mode === 1) {
    chars.splice(at, 1);
  } else {
    // Substitute a keyboard-adjacent-ish letter, staying within A-Z.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const replacement = pick(rng, [...alphabet]);
    chars[at] = replacement === chars[at] ? 'X' : replacement;
  }
  return chars.join('').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Known negatives
// ---------------------------------------------------------------------------

interface NameGroup {
  given: string[];
  surnames: string[];
}

interface NameCorpus {
  yoruba: NameGroup;
  igbo: NameGroup;
  hausa: NameGroup;
}

export function loadNameCorpus(): NameCorpus {
  return JSON.parse(readFileSync(NAMES_PATH, 'utf8')) as NameCorpus;
}

/**
 * 5,000 synthetic ordinary Nigerian customers.
 *
 * Built combinatorially from the documented corpus, then filtered against the
 * ingested watchlist so a genuine collision cannot be counted as a false
 * positive. Any name whose token set overlaps a listed name too closely is
 * discarded and replaced — the false-positive number must measure the
 * matcher's noise, not our carelessness.
 */
export async function buildNegatives(count = 5000): Promise<string[]> {
  const corpus = loadNameCorpus();
  const groups = [corpus.yoruba, corpus.igbo, corpus.hausa];
  const rng = makeRng(NEGATIVE_SEED);

  const listed = await loadListedTokenSets();
  const out: string[] = [];
  const seen = new Set<string>();
  let discarded = 0;

  // Bounded attempts: the combinatorial space is far larger than `count`, so
  // this terminates comfortably, but the guard keeps a corpus edit from
  // producing an infinite loop.
  const maxAttempts = count * 50;
  for (let attempt = 0; out.length < count && attempt < maxAttempts; attempt++) {
    const group = pick(rng, groups);
    const parts = [pick(rng, group.given)];
    // Roughly a third carry a middle name, matching how Nigerian names are
    // actually presented on transfer forms.
    if (rng() < 0.35) parts.push(pick(rng, pick(rng, groups).given));
    parts.push(pick(rng, group.surnames));

    const name = parts.join(' ');
    if (seen.has(name)) continue;
    seen.add(name);

    if (collidesWithWatchlist(name, listed)) {
      discarded++;
      continue;
    }
    out.push(name);
  }

  if (out.length < count) {
    throw new Error(
      `could only build ${out.length} of ${count} negatives; expand data/nigerian-names.json`,
    );
  }
  negativeDiscardCount = discarded;
  return out;
}

let negativeDiscardCount = 0;
export function lastNegativeDiscardCount(): number {
  return negativeDiscardCount;
}

async function loadListedTokenSets(): Promise<Set<string>> {
  const { rows } = await getPool().query<{ variant_text: string }>(
    `SELECT variant_text FROM name_variant`,
  );
  const set = new Set<string>();
  for (const row of rows) {
    const tokens = normalizeName(row.variant_text).split(' ').filter(Boolean);
    if (tokens.length >= 2) set.add([...tokens].sort().join(' '));
  }
  return set;
}

function collidesWithWatchlist(name: string, listed: Set<string>): boolean {
  const tokens = normalizeName(name).split(' ').filter(Boolean);
  const key = [...tokens].sort().join(' ');
  if (listed.has(key)) return true;
  // Also reject any two-token subset appearing verbatim on the list, which is
  // how a "given + surname" pair would genuinely collide.
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      if (listed.has([tokens[i]!, tokens[j]!].sort().join(' '))) return true;
    }
  }
  return false;
}
