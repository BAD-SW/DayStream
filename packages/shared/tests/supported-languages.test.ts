import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, LANGUAGE_OPTIONS, LANGUAGE_LABELS,
  isSupportedLanguage, languageFromText, supportedLanguagesText,
} from '../src/constants/supported';

describe('supported languages (the one list)', () => {
  it('currently supports English only', () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual(['en']);
    expect(DEFAULT_LANGUAGE).toBe('en');
  });

  it('options, labels and the list always agree', () => {
    expect(LANGUAGE_OPTIONS.map((o) => o.code)).toEqual([...SUPPORTED_LANGUAGES]);
    for (const code of SUPPORTED_LANGUAGES) expect(LANGUAGE_LABELS[code]).toBeTruthy();
    expect(DEFAULT_LANGUAGE).toSatisfy(isSupportedLanguage);
  });

  it('isSupportedLanguage accepts codes on the list only', () => {
    expect(isSupportedLanguage('en')).toBe(true);
    expect(isSupportedLanguage('es')).toBe(false);
    expect(isSupportedLanguage('English')).toBe(false);
    expect(isSupportedLanguage(null)).toBe(false);
  });

  it('languageFromText reads codes and names, and refuses others', () => {
    expect(languageFromText('en')).toBe('en');
    expect(languageFromText(' EN-us ')).toBe('en');
    expect(languageFromText('English')).toBe('en');
    expect(languageFromText('es')).toBeNull();
    expect(languageFromText('Spanish')).toBeNull();
    expect(languageFromText('')).toBeNull();
  });

  it('describes the list in words', () => {
    expect(supportedLanguagesText()).toBe('English');
  });
});
