/**
 * Jaro-Winkler string similarity — the baseline Sifta is measured against.
 *
 * This is the standard fuzzy-matching algorithm in commercial sanctions
 * screening. It is implemented properly here, not strawmanned: the comparison
 * is only worth publishing if the baseline is the real thing, tuned to a
 * realistic operating threshold.
 *
 * Its structural weakness on African names is the prefix bonus. Winkler boosts
 * scores for pairs sharing a leading substring, which is exactly wrong for
 * CHUKWUEMEKA -> EMEKA or OLUWASEUN -> SEUN, where the customer's spelling
 * shares no prefix at all with the listed one.
 */

export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0 || lenB === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(lenA, lenB) / 2) - 1);
  const matchedA = new Array<boolean>(lenA).fill(false);
  const matchedB = new Array<boolean>(lenB).fill(false);

  let matches = 0;
  for (let i = 0; i < lenA; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, lenB);
    for (let j = start; j < end; j++) {
      if (matchedB[j] || a[i] !== b[j]) continue;
      matchedA[i] = true;
      matchedB[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < lenA; i++) {
    if (!matchedA[i]) continue;
    while (!matchedB[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  return (matches / lenA + matches / lenB + (matches - transpositions) / matches) / 3;
}

/** Standard Winkler prefix boost: p = 0.1, up to 4 leading characters. */
export function jaroWinkler(a: string, b: string, scalingFactor = 0.1): number {
  const base = jaro(a, b);
  if (base === 0) return 0;
  let prefix = 0;
  const max = Math.min(4, a.length, b.length);
  while (prefix < max && a[prefix] === b[prefix]) prefix++;
  return base + prefix * scalingFactor * (1 - base);
}

/**
 * Token-aware comparison.
 *
 * Comparing full name strings directly would penalise the baseline unfairly
 * for token *order*, which is trivially fixable and not the interesting
 * failure. A real screening engine compares token sets. So: best-match each
 * token of the shorter name against the longer, and average. This makes the
 * baseline order-insensitive, removing the easiest criticism of the
 * comparison — the baseline still loses on transliteration and contraction,
 * which are the failures that actually matter.
 */
export function nameSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const tokensA = a.split(' ').filter(Boolean);
  const tokensB = b.split(' ').filter(Boolean);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const [short, long] =
    tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];

  let total = 0;
  for (const token of short) {
    let best = 0;
    for (const other of long) {
      const score = jaroWinkler(token, other);
      if (score > best) best = score;
      if (best === 1) break;
    }
    total += best;
  }
  return total / short.length;
}
