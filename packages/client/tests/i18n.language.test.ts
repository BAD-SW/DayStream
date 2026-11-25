/** Phase 44, requirement 2 and 4: which language is shown, and the format dates and numbers use. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveLanguage, rememberChoice, deviceChoiceUnsaved, markChoiceSaved, currentLocale, browserLanguage, showLanguage } from '../src/i18n';
import { formatMoney, formatDay, formatCountry } from '../src/utils/format';

function setBrowserLanguages(list: string[]) {
  Object.defineProperty(window.navigator, 'languages', { value: list, configurable: true });
  Object.defineProperty(window.navigator, 'language', { value: list[0], configurable: true });
}

describe('the language shown', () => {
  beforeEach(() => { localStorage.clear(); setBrowserLanguages(['en-US']); });
  afterEach(() => localStorage.clear());

  it('is always English for the System persona', () => {
    rememberChoice('en', false);
    expect(resolveLanguage({ persona: 'system', accountLanguage: 'en' })).toBe('en');
  });

  it('uses the account\'s language first', () => {
    expect(resolveLanguage({ persona: 'business', accountLanguage: 'en' })).toBe('en');
  });

  it('ignores an account language that is not offered and falls back to English', () => {
    setBrowserLanguages(['fr-FR']);
    expect(resolveLanguage({ persona: 'business', accountLanguage: 'fr' })).toBe('en');
  });

  it('treats regional variants as the language, and other languages as not offered', () => {
    setBrowserLanguages(['fr-CA', 'en-GB']);
    expect(browserLanguage()).toBe('en');
    setBrowserLanguages(['fr-FR']);
    expect(browserLanguage()).toBeNull();
  });

  it('offers only the business\'s languages, falling back to its default language', () => {
    setBrowserLanguages(['es-ES']);
    // The account chose Spanish, but the business offers only English: English, and the choice is kept.
    expect(resolveLanguage({ persona: 'business', accountLanguage: 'es', offered: ['en'] })).toBe('en');
    // A business whose default is Spanish and that offers only Spanish.
    setBrowserLanguages(['en-US']);
    expect(resolveLanguage({ persona: 'business', accountLanguage: 'en', offered: ['es'] })).toBe('es');
    // The business offers both: the account's choice.
    expect(resolveLanguage({ persona: 'business', accountLanguage: 'es', offered: ['en', 'es'] })).toBe('es');
  });

  it('remembers a choice made while signed out until it is saved to the account', () => {
    rememberChoice('en', false);
    expect(deviceChoiceUnsaved()).toBe(true);
    markChoiceSaved();
    expect(deviceChoiceUnsaved()).toBe(false);
    rememberChoice('en', true);
    expect(deviceChoiceUnsaved()).toBe(false);
  });
});

describe('formats', () => {
  it('follow the device\'s regional setting for the language shown', () => {
    setBrowserLanguages(['en-GB']);
    expect(currentLocale()).toBe('en-GB');
    expect(formatDay('2026-11-24')).toBe('24/11/2026');
    setBrowserLanguages(['en-US']);
    expect(formatDay('2026-11-24')).toBe('11/24/2026');
  });

  it('use the language\'s default when the device is set to another language', () => {
    setBrowserLanguages(['de-DE']);
    expect(currentLocale()).toBe('en-US');
  });

  it('name countries in the language shown, from the browser\'s built-in names', async () => {
    setBrowserLanguages(['en-US']);
    expect(formatCountry('ES', 'Spain')).toBe('Spain');
    await showLanguage('es');
    expect(formatCountry('ES', 'Spain')).toBe('España');
    expect(formatCountry('DE', 'Germany')).toBe('Alemania');
    await showLanguage('en');
  });

  it('keep the business\'s currency', () => {
    setBrowserLanguages(['en-US']);
    expect(formatMoney(1250, 'EUR')).toBe('€12.50');
    expect(formatMoney(123450, 'GBP')).toBe('£1,234.50');
  });
});
