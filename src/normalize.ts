/**
 * Name normalisation shared by ingestion, screening, and the memory layer.
 *
 * The subject key is the hinge the whole memory thesis turns on: if "Joshua
 * Usifoh" and "Usifoh Usifoh Joshua" do not collapse to the same key, the agent
 * cannot recall last week's decision and the product does not work. So the key
 * is built to be deliberately insensitive to the things African names vary by
 * and sensitive to nothing else.
 */

/** Unicode NFD decomposition, then drop combining marks. Ìbùkún → Ibukun. */
export function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(/\p{Mn}/gu, '').normalize('NFC');
}

/**
 * Uppercase, de-accent, drop punctuation, collapse whitespace.
 * Preserves token order — use `nameTokens` when order must not matter.
 */
export function normalizeName(input: string): string {
  return stripDiacritics(input)
    .toUpperCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameTokens(input: string): string[] {
  const normalized = normalizeName(input);
  return normalized.length === 0 ? [] : normalized.split(' ');
}

/**
 * Stable identity key for a screening subject.
 *
 * Tokens are sorted, so name ordering cannot produce two different keys for one
 * person — this is what makes `recall_prior_decisions` fire on "Joshua Usifoh"
 * after a decision was recorded against "Usifoh Joshua".
 *
 * DOB and nationality participate when known. They are what an analyst actually
 * cleared on ("DOB mismatch"), so a subject who shares a name but not a DOB must
 * not inherit that clearance.
 */
export function subjectKey(
  name: string,
  dob?: string | Date | null,
  nationality?: string | null,
): string {
  const tokens = [...new Set(nameTokens(name))].sort();
  const parts = [tokens.join('|')];
  parts.push(dob ? toIsoDate(dob) : '-');
  parts.push(nationality ? normalizeName(nationality) : '-');
  return parts.join('::');
}

function toIsoDate(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  // Accept 'YYYY-MM-DD' and anything Date can parse; fall back to the raw
  // string rather than silently producing 'Invalid Date'.
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.trim() : parsed.toISOString().slice(0, 10);
}
