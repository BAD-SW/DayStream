/** Phase 44, requirement 5: which template a customer's email uses, and the built-in wording's language. */
import { describe, it, expect } from 'vitest';
import { pickTemplateForLanguage } from '../src/services/document-branding-resolver.service';
import { msgIn, hasMessage } from '../src/i18n';

const tpl = (id: string, language: string | null) => ({ id, language });

describe('pickTemplateForLanguage', () => {
  const all = [tpl('none', null), tpl('en', 'en'), tpl('es', 'es')];

  it('uses the template in the recipient\'s language', () => {
    expect(pickTemplateForLanguage(all, 'es')?.id).toBe('es');
  });

  it('falls back to the English template when there is none in that language', () => {
    expect(pickTemplateForLanguage(all, 'fr')?.id).toBe('en');
  });

  it('falls back to a template with no language when there is no English one', () => {
    expect(pickTemplateForLanguage([tpl('none', null), tpl('es', 'es')], 'fr')?.id).toBe('none');
  });

  it('treats no language on the customer as English', () => {
    expect(pickTemplateForLanguage(all, null)?.id).toBe('en');
  });

  it('never sends a template in another language', () => {
    expect(pickTemplateForLanguage([tpl('es', 'es')], 'en')).toBeNull();
    expect(pickTemplateForLanguage([], 'es')).toBeNull();
  });
});

describe('built-in email wording', () => {
  it('has English for the greeting, the table and the plain email', () => {
    for (const key of ['email:greeting', 'email:table.total', 'email:plain.title.bookingConfirmation', 'email:types.payment.receipt']) {
      expect(hasMessage(key), key).toBe(true);
    }
    expect(msgIn('en', 'email:greeting', { name: 'Ana' })).toBe('Hi Ana,');
  });

  it('is written in the recipient\'s language when it has a translation, else English', () => {
    expect(msgIn('fr', 'email:plain.service', { value: 'Massage' })).toBe('Service: Massage');
  });
});
