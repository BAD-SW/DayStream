/**
 * Comparing a translation file with its English source (Phase 44, design sections 8 and 9), shared by
 * the translation command and the checks run with the tests.
 */

export type TranslationBundle = Record<string, string>;

/** The fill-ins ({{name}}) and numbered tags (<1>, </1>) of a phrase, sorted, as they must match. */
export function placeholdersOf(text: string): string[] {
  const found = [
    ...(text.match(/\{\{\s*[\w.-]+\s*\}\}/g) ?? []).map((p) => p.replace(/\s+/g, '')),
    ...(text.match(/<\/?\d+\s*\/?>/g) ?? []).map((p) => p.replace(/\s+/g, '')),
  ];
  return found.sort();
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** The plural forms a language uses ('one', 'other', and 'many' for Spanish). */
export function pluralForms(locale: string): string[] {
  return new Intl.PluralRules(locale).resolvedOptions().pluralCategories as string[];
}

/**
 * The keys a translation needs: every English key, with plural keys (x_one / x_other) expanded into the
 * target language's own forms. Each needed key maps to the English key whose phrase is its source.
 */
export function neededKeys(english: TranslationBundle, locale: string): Map<string, string> {
  const needed = new Map<string, string>();
  const forms = pluralForms(locale);
  for (const key of Object.keys(english)) {
    const m = PLURAL_SUFFIX.exec(key);
    if (!m) { needed.set(key, key); continue; }
    const base = key.slice(0, -m[0].length);
    for (const form of forms) {
      const source = english[`${base}_${form}`] !== undefined ? `${base}_${form}` : `${base}_other`;
      if (english[source] !== undefined && !needed.has(`${base}_${form}`)) needed.set(`${base}_${form}`, source);
    }
  }
  return needed;
}

export interface BundleProblems {
  /** Needed keys with no translation (reported, not failed). */
  missing: string[];
  /** Translations whose fill-ins or tags differ from the English phrase (failed). */
  mismatched: { key: string; english: string; translated: string }[];
  /** Keys in the translation that English no longer has (reported). */
  unused: string[];
}

export function compareBundles(english: TranslationBundle, translated: TranslationBundle, locale: string): BundleProblems {
  const needed = neededKeys(english, locale);
  const missing: string[] = [];
  const mismatched: BundleProblems['mismatched'] = [];
  for (const [key, source] of needed) {
    const value = translated[key];
    if (value === undefined || value === '') { missing.push(key); continue; }
    if (placeholdersOf(value).join('|') !== placeholdersOf(english[source]).join('|')) {
      mismatched.push({ key, english: english[source], translated: value });
    }
  }
  const unused = Object.keys(translated).filter((k) => !needed.has(k));
  return { missing, mismatched, unused };
}
