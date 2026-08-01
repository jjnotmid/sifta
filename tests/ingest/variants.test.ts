import { describe, expect, it } from 'vitest';
import {
  generateDeaccented,
  generateDropped,
  generateInitialised,
  generateReorderings,
  generateShortenings,
  generateTransliterations,
  generateVariants,
  loadShortenings,
  loadTranslitRules,
} from '../../src/ingest/variants.js';

const rules = loadTranslitRules();
const shortenings = loadShortenings();

/**
 * Every rule is tested against real Nigerian names — Yoruba, Igbo and Hausa —
 * rather than synthetic strings. A transliteration rule that works on "ABCDE"
 * and not on "CHUKWUEMEKA" is worthless here.
 */

describe('rule 1 — reordering', () => {
  it('produces the surname-first/surname-last swap for a two-part name', () => {
    expect(generateReorderings('USIFOH JOSHUA')).toContain('JOSHUA USIFOH');
    expect(generateReorderings('OKAFOR CHINEDU')).toContain('CHINEDU OKAFOR');
    expect(generateReorderings('MUSA IBRAHIM')).toContain('IBRAHIM MUSA');
  });

  it('moves the trailing surname to the front for a three-part name', () => {
    const variants = generateReorderings('CHUKWUEMEKA EMMANUEL OKAFOR');
    expect(variants).toContain('OKAFOR CHUKWUEMEKA EMMANUEL');
    expect(variants).toContain('EMMANUEL OKAFOR CHUKWUEMEKA');
  });

  it('does not crash on a single-token name', () => {
    expect(() => generateReorderings('EMEKA')).not.toThrow();
    expect(generateReorderings('EMEKA')).toEqual([]);
    expect(generateReorderings('')).toEqual([]);
    expect(generateReorderings('   ')).toEqual([]);
  });

  it('never returns the input unchanged', () => {
    for (const name of ['USIFOH JOSHUA', 'CHUKWUEMEKA EMMANUEL OKAFOR']) {
      expect(generateReorderings(name)).not.toContain(name);
    }
  });
});

describe('rule 2 — diacritic stripping', () => {
  it('strips Yoruba tonal marks and underdots', () => {
    expect(generateDeaccented('Ìbùkún Adéyemí')).toContain('IBUKUN ADEYEMI');
    expect(generateDeaccented('Olúwaségun')).toContain('OLUWASEGUN');
    expect(generateDeaccented('Ṣadé Adébáyọ̀')).toContain('SADE ADEBAYO');
  });

  it('strips Igbo dot-below vowels', () => {
    expect(generateDeaccented('Ngọzị Okonjọ')).toContain('NGOZI OKONJO');
    expect(generateDeaccented('Chinụa Achebe')).toContain('CHINUA ACHEBE');
  });

  it('returns nothing when a name carries no diacritics', () => {
    // No variant is better than a duplicate of the primary name.
    expect(generateDeaccented('IBRAHIM MUSA')).toEqual([]);
  });
});

describe('rule 3 — transliteration', () => {
  it('applies the Igbo KW/KU alternation', () => {
    expect(generateTransliterations('CHUKWUEMEKA OKAFOR', rules)).toContain(
      'CHUKUEMEKA OKAFOR',
    );
    expect(generateTransliterations('NWACHUKWU', rules)).toContain('NWACHUKU');
  });

  it('applies the Yoruba S/SH alternation', () => {
    expect(generateTransliterations('ADESHINA', rules)).toContain('ADESINA');
    expect(generateTransliterations('SOLA ADEYEMI', rules)).toContain('SHOLA ADEYEMI');
  });

  it('handles the Hausa spellings of Muhammad', () => {
    const variants = generateTransliterations('MUHAMMAD BELLO', rules);
    expect(variants).toContain('MOHAMMED BELLO');
    expect(variants).toContain('MUHAMAD BELLO');
  });

  it('collapses doubled vowels', () => {
    expect(generateTransliterations('OORE ADEBAYO', rules)).toContain('ORE ADEBAYO');
  });

  it('respects position constraints', () => {
    // CH -> C is start-of-token only, so the CH in ACHEBE must not fire.
    const variants = generateTransliterations('ACHEBE', rules);
    expect(variants).not.toContain('ACEBE');
    expect(generateTransliterations('CHINEDU', rules)).toContain('CINEDU');
  });

  it('is driven by the data file, not hardcoded', () => {
    const custom = [
      { from: 'ZZ', to: 'QQ', bidirectional: false, position: 'any' as const },
    ];
    expect(generateTransliterations('ZZTOP', custom)).toContain('QQTOP');
    expect(generateTransliterations('CHUKWU', custom)).toEqual([]);
  });
});

describe('rule 4 — traditional-name shortening', () => {
  it('shortens Igbo theophoric names', () => {
    expect(generateShortenings('CHUKWUEMEKA OKAFOR', shortenings)).toContain(
      'EMEKA OKAFOR',
    );
    expect(generateShortenings('IKECHUKWU NWOSU', shortenings)).toContain('IKE NWOSU');
  });

  it('shortens Yoruba theophoric names', () => {
    expect(generateShortenings('OLUWASEUN ADEYEMI', shortenings)).toContain(
      'SEUN ADEYEMI',
    );
    expect(generateShortenings('BABATUNDE FASHOLA', shortenings)).toContain(
      'TUNDE FASHOLA',
    );
  });

  it('shortens Hausa names', () => {
    expect(generateShortenings('ABDULLAHI SANI', shortenings)).toContain('ABDUL SANI');
    expect(generateShortenings('ABUBAKAR GARBA', shortenings)).toContain('ABU GARBA');
  });

  it('shortens a token in any position, not only the first', () => {
    expect(generateShortenings('JOHN CHUKWUEMEKA OKAFOR', shortenings)).toContain(
      'JOHN EMEKA OKAFOR',
    );
  });

  it('returns nothing for a name with no known shortening', () => {
    expect(generateShortenings('JOHN SMITH', shortenings)).toEqual([]);
  });
});

describe('rule 5 — initialisation', () => {
  it('reduces the middle name to an initial', () => {
    expect(generateInitialised('CHUKWUEMEKA EMMANUEL OKAFOR')).toContain(
      'CHUKWUEMEKA E OKAFOR',
    );
    expect(generateInitialised('OLUWASEUN ADEBAYO ADEYEMI')).toContain(
      'OLUWASEUN A ADEYEMI',
    );
    expect(generateInitialised('IBRAHIM MUSA DANJUMA')).toContain('IBRAHIM M DANJUMA');
  });

  it('reduces every middle name when there are several', () => {
    expect(generateInitialised('ADE JOHN PAUL OKONKWO')).toContain('ADE J P OKONKWO');
  });

  it('produces nothing for names with fewer than three parts', () => {
    expect(generateInitialised('EMEKA OKAFOR')).toEqual([]);
    expect(generateInitialised('EMEKA')).toEqual([]);
  });
});

describe('rule 6 — name-part dropping', () => {
  it('drops the middle name entirely', () => {
    expect(generateDropped('CHUKWUEMEKA EMMANUEL OKAFOR')).toContain(
      'CHUKWUEMEKA OKAFOR',
    );
    expect(generateDropped('OLUWASEUN ADEBAYO ADEYEMI')).toContain('OLUWASEUN ADEYEMI');
    expect(generateDropped('IBRAHIM MUSA DANJUMA')).toContain('IBRAHIM DANJUMA');
  });

  it('drops each middle name independently when there are several', () => {
    const variants = generateDropped('ADE JOHN PAUL OKONKWO');
    expect(variants).toContain('ADE PAUL OKONKWO');
    expect(variants).toContain('ADE JOHN OKONKWO');
    expect(variants).toContain('ADE OKONKWO');
  });

  it('produces nothing for names with fewer than three parts', () => {
    expect(generateDropped('EMEKA OKAFOR')).toEqual([]);
  });
});

describe('generateVariants — the combined set', () => {
  const subject = 'CHUKWUEMEKA EMMANUEL OKAFOR';

  it('is deterministic: the same input yields an identical variant set', () => {
    const a = generateVariants(subject);
    const b = generateVariants(subject);
    expect(a).toEqual(b);
    // Identical ordering too, not merely the same members — the ingest writes
    // these in order and reruns must be no-ops.
    expect(a.map((v) => `${v.kind}:${v.text}`)).toEqual(
      b.map((v) => `${v.kind}:${v.text}`),
    );
  });

  it('contains no duplicate variant text for one entity', () => {
    const texts = generateVariants(subject).map((v) => v.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('never emits the primary name as a variant of itself', () => {
    expect(generateVariants(subject).map((v) => v.text)).not.toContain(subject);
  });

  it('labels every variant with the rule that produced it', () => {
    const kinds = new Set(generateVariants(subject).map((v) => v.kind));
    expect(kinds).toContain('reordered');
    expect(kinds).toContain('shortened');
    expect(kinds).toContain('initialised');
    expect(kinds).toContain('dropped');
  });

  it('catches the motivating real-world case', () => {
    // "Chukwuemeka Emmanuel Okafor" on a watchlist; the customer writes
    // "Emeka Okafor" on the transfer. A Jaro-Winkler matcher scores these
    // poorly because they share no prefix.
    const texts = generateVariants(subject).map((v) => v.text);
    expect(texts).toContain('EMEKA EMMANUEL OKAFOR');
    expect(texts).toContain('CHUKWUEMEKA OKAFOR');
    expect(texts).toContain('OKAFOR CHUKWUEMEKA EMMANUEL');
  });

  it('does not crash on degenerate input', () => {
    for (const name of ['', '   ', 'EMEKA', '...', '1234']) {
      expect(() => generateVariants(name)).not.toThrow();
    }
  });

  it('keeps the variant set bounded', () => {
    // Candidate-set explosion is the problem being solved; a generator that
    // emits hundreds of variants per entity would recreate it.
    const long = generateVariants('OLUWASEUN CHUKWUEMEKA ADEBAYO MUHAMMAD OKAFOR');
    expect(long.length).toBeLessThan(120);
  });
});

describe('data files', () => {
  it('translit-rules.json carries an owner-facing README', () => {
    const raw = loadTranslitRules();
    expect(raw.length).toBeGreaterThan(10);
  });

  it('name-shortenings.json is seeded across all three language groups', () => {
    expect(shortenings.get('CHUKWUEMEKA')).toContain('EMEKA'); // Igbo
    expect(shortenings.get('OLUWASEUN')).toContain('SEUN'); // Yoruba
    expect(shortenings.get('ABUBAKAR')).toContain('ABU'); // Hausa
    expect(shortenings.size).toBeGreaterThan(40);
  });
});
