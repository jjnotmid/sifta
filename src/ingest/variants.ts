import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { VariantKind } from '../memory/types.js';
import { nameTokens, normalizeName, stripDiacritics } from '../normalize.js';

/**
 * Name variant generation — the core of the product.
 *
 * Western screening engines fail on African names structurally, not
 * incidentally: ordering is unstable, transliteration is plural, traditional
 * names contract in ways that share no prefix with their full form. Rather
 * than trying to make the *matcher* cleverer, Sifta expands the *watchlist*:
 * every plausible way a listed name might be written is generated, embedded,
 * and indexed. Matching then becomes an ordinary nearest-neighbour lookup.
 *
 * Each rule below is a separate exported function so it can be tested, tuned,
 * and reasoned about in isolation. Two of them are driven entirely by
 * human-editable data files in data/, which the project owner is expected to
 * expand — that is where most of the remaining accuracy lives.
 */

export interface Variant {
  text: string;
  kind: VariantKind;
}

export type RulePosition = 'any' | 'start' | 'end';

export interface TranslitRule {
  from: string;
  to: string;
  bidirectional?: boolean;
  position?: RulePosition;
  language?: string;
  note?: string;
}

export type ShorteningTable = Map<string, string[]>;

/**
 * Upper bound on variants emitted for one name.
 *
 * Candidate-set explosion is the problem this product exists to reduce, so a
 * generator that emits hundreds of spellings per entity would be
 * self-defeating — it would inflate every candidate set it is meant to shrink.
 * Truncation is deterministic (stable rule order), never random.
 */
export const MAX_VARIANTS_PER_NAME = 100;

const TRANSLIT_PATH = fileURLToPath(new URL('../../data/translit-rules.json', import.meta.url));
const SHORTENINGS_PATH = fileURLToPath(new URL('../../data/name-shortenings.json', import.meta.url));

let cachedRules: TranslitRule[] | null = null;
let cachedShortenings: ShorteningTable | null = null;

export function loadTranslitRules(): TranslitRule[] {
  if (cachedRules) return cachedRules;
  const parsed = JSON.parse(readFileSync(TRANSLIT_PATH, 'utf8')) as {
    rules?: TranslitRule[];
  };
  if (!Array.isArray(parsed.rules)) {
    throw new Error('data/translit-rules.json: expected a "rules" array');
  }
  cachedRules = parsed.rules;
  return cachedRules;
}

export function loadShortenings(): ShorteningTable {
  if (cachedShortenings) return cachedShortenings;
  const parsed = JSON.parse(readFileSync(SHORTENINGS_PATH, 'utf8')) as {
    shortenings?: Record<string, string[]>;
  };
  if (!parsed.shortenings || typeof parsed.shortenings !== 'object') {
    throw new Error('data/name-shortenings.json: expected a "shortenings" object');
  }
  cachedShortenings = new Map(
    Object.entries(parsed.shortenings).map(([full, shorts]) => [
      full.toUpperCase(),
      shorts.map((s) => s.toUpperCase()),
    ]),
  );
  return cachedShortenings;
}

// ---------------------------------------------------------------------------
// Rule 1 — reordering
// ---------------------------------------------------------------------------

/**
 * Surname-first and surname-last permutations.
 *
 * "Usifoh Joshua" and "Joshua Usifoh" are one person. Standard matchers assume
 * surname position is stable; across Nigerian institutions it is not — the
 * same customer writes it differently on different forms.
 *
 * Rotations plus a first/last swap, not the full permutation set: n! variants
 * for a four-part name would be exactly the explosion we are trying to avoid.
 */
export function generateReorderings(name: string): string[] {
  const tokens = nameTokens(name);
  if (tokens.length < 2) return [];
  const original = tokens.join(' ');
  const out = new Set<string>();

  for (let shift = 1; shift < tokens.length; shift++) {
    const rotated = [...tokens.slice(-shift), ...tokens.slice(0, -shift)];
    out.add(rotated.join(' '));
  }

  if (tokens.length > 2) {
    const swapped = [...tokens];
    const first = swapped[0]!;
    swapped[0] = swapped[swapped.length - 1]!;
    swapped[swapped.length - 1] = first;
    out.add(swapped.join(' '));
  }

  out.delete(original);
  return [...out];
}

// ---------------------------------------------------------------------------
// Rule 2 — diacritic stripping
// ---------------------------------------------------------------------------

/**
 * Unicode NFD normalisation with combining marks removed.
 *
 * Ìbùkún → IBUKUN, Ngọzị → NGOZI. Tonal marks and underdots are stripped
 * inconsistently across banking systems, so both forms circulate.
 */
export function generateDeaccented(name: string): string[] {
  const withMarks = name.toUpperCase().replace(/\s+/g, ' ').trim();
  const stripped = normalizeName(name);
  if (stripped.length === 0) return [];
  // Only a variant if the name actually carried marks; otherwise this would
  // duplicate the primary name.
  return stripDiacritics(withMarks) === withMarks ? [] : [stripped];
}

// ---------------------------------------------------------------------------
// Rule 3 — transliteration
// ---------------------------------------------------------------------------

/**
 * Spelling alternations from data/translit-rules.json.
 *
 * Rules are applied one at a time to the whole name rather than combined, so
 * output stays proportional to the number of rules instead of exponential in
 * them.
 */
export function generateTransliterations(
  name: string,
  rules: readonly TranslitRule[] = loadTranslitRules(),
): string[] {
  const normalized = normalizeName(name);
  if (normalized.length === 0) return [];
  const out = new Set<string>();

  for (const rule of rules) {
    const position = rule.position ?? 'any';
    out.add(applyRule(normalized, rule.from, rule.to, position));
    if (rule.bidirectional) {
      out.add(applyRule(normalized, rule.to, rule.from, position));
    }
  }

  out.delete(normalized);
  return [...out];
}

function applyRule(
  name: string,
  from: string,
  to: string,
  position: RulePosition,
): string {
  if (from.length === 0) return name;
  return name
    .split(' ')
    .map((token) => {
      switch (position) {
        case 'start':
          return token.startsWith(from) ? to + token.slice(from.length) : token;
        case 'end':
          return token.endsWith(from)
            ? token.slice(0, token.length - from.length) + to
            : token;
        default:
          return token.split(from).join(to);
      }
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// Rule 4 — traditional-name shortening
// ---------------------------------------------------------------------------

/**
 * Contractions from data/name-shortenings.json.
 *
 * Chukwuemeka → Emeka, Oluwaseun → Seun. These are the variants that most
 * reliably defeat edit-distance matching, because the short form frequently
 * shares no prefix with the full one — and Jaro-Winkler specifically boosts
 * common-prefix matches. This rule is where Sifta beats the baseline.
 */
export function generateShortenings(
  name: string,
  table: ShorteningTable = loadShortenings(),
): string[] {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return [];
  const original = tokens.join(' ');
  const out = new Set<string>();

  tokens.forEach((token, index) => {
    for (const short of table.get(token) ?? []) {
      const replaced = [...tokens];
      replaced[index] = short;
      out.add(replaced.join(' '));
    }
  });

  out.delete(original);
  return [...out];
}

// ---------------------------------------------------------------------------
// Rule 5 — initialisation
// ---------------------------------------------------------------------------

/** Middle names reduced to initials: "Chukwuemeka E Okafor". */
export function generateInitialised(name: string): string[] {
  const tokens = nameTokens(name);
  if (tokens.length < 3) return [];
  const initialised = tokens.map((token, i) =>
    i === 0 || i === tokens.length - 1 ? token : token.charAt(0),
  );
  const text = initialised.join(' ');
  return text === tokens.join(' ') ? [] : [text];
}

// ---------------------------------------------------------------------------
// Rule 6 — name-part dropping
// ---------------------------------------------------------------------------

/**
 * Middle names removed. Many people carry an English given name, a traditional
 * name and a family name, and present different subsets in different contexts.
 */
export function generateDropped(name: string): string[] {
  const tokens = nameTokens(name);
  if (tokens.length < 3) return [];
  const original = tokens.join(' ');
  const out = new Set<string>();

  for (let i = 1; i < tokens.length - 1; i++) {
    out.add(tokens.filter((_, idx) => idx !== i).join(' '));
  }
  // All middle names dropped at once.
  out.add([tokens[0]!, tokens[tokens.length - 1]!].join(' '));

  out.delete(original);
  return [...out];
}

// ---------------------------------------------------------------------------
// Combined generation
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  rules?: readonly TranslitRule[];
  shortenings?: ShorteningTable;
  max?: number;
}

/**
 * Every variant for one name, deduplicated and deterministically ordered.
 *
 * Rules are applied in a fixed order and the result is truncated at `max`, so
 * the same input always produces the same set in the same sequence. The ingest
 * relies on that: re-running variant generation must be a no-op, not a source
 * of churn in the vector index.
 */
export function generateVariants(
  name: string,
  options: GenerateOptions = {},
): Variant[] {
  const rules = options.rules ?? loadTranslitRules();
  const shortenings = options.shortenings ?? loadShortenings();
  const max = options.max ?? MAX_VARIANTS_PER_NAME;

  const primary = normalizeName(name);
  const seen = new Set<string>([primary]);
  const variants: Variant[] = [];

  const add = (texts: readonly string[], kind: VariantKind): void => {
    for (const text of texts) {
      if (text.length === 0 || seen.has(text)) continue;
      seen.add(text);
      variants.push({ text, kind });
    }
  };

  add(generateDeaccented(name), 'deaccented');
  add(generateReorderings(primary), 'reordered');
  add(generateTransliterations(primary, rules), 'translit');

  const shortened = generateShortenings(primary, shortenings);
  add(shortened, 'shortened');

  add(generateInitialised(primary), 'initialised');
  add(generateDropped(primary), 'dropped');

  // Second order: reorderings of the shortened forms. "Okafor Emeka" is at
  // least as common as "Emeka Okafor" and neither first-order rule reaches it.
  // Restricted to shortenings — applying it to every rule's output would
  // multiply the set without a matching gain in recall.
  for (const short of shortened) {
    add(generateReorderings(short), 'reordered');
  }

  return variants.length > max ? variants.slice(0, max) : variants;
}
