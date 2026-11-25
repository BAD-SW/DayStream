import { describe, it, expect } from 'vitest';
import { msg, msgIn, languageFromHeader, withLanguage, hasMessage, requestLanguage } from '../src/i18n';

describe('msgIn', () => {
  it('returns the English message for en', () => {
    expect(msgIn('en', 'errors:invalid_credentials')).toBe('Invalid email or password.');
  });

  it('returns the translation when there is one', () => {
    expect(msgIn('es', 'errors:invalid_credentials')).toBe('Correo o contraseña inválidos.');
  });

  it('fills in values in a translation', () => {
    expect(msgIn('es', 'errors:validation.any.required', { field: 'email' })).toBe('email es obligatorio.');
  });

  it('falls back to English for a language with no files', () => {
    expect(msgIn('fr', 'errors:forbidden')).toBe('You do not have permission to perform this action.');
  });

  it('returns the key when there is no English phrase', () => {
    expect(msgIn('en', 'errors:nonexistent')).toBe('nonexistent');
    expect(hasMessage('errors:nonexistent')).toBe(false);
    expect(hasMessage('errors:generic')).toBe(true);
  });

  it('uses the errors namespace when none is given, and fills in values', () => {
    expect(msgIn('en', 'validation.string.max', { field: 'name', limit: 100 })).toBe('name must be at most 100 characters.');
  });
});

describe('languageFromHeader', () => {
  it('detects English', () => {
    expect(languageFromHeader('en-US,en;q=0.9')).toBe('en');
  });

  it('detects Spanish, including regional variants', () => {
    expect(languageFromHeader('es-ES,es;q=0.9')).toBe('es');
    expect(languageFromHeader('es-MX')).toBe('es');
  });

  it('falls back to English for a language that is not offered, or no header', () => {
    expect(languageFromHeader('fr-FR,fr;q=0.9')).toBe('en');
    expect(languageFromHeader(undefined)).toBe('en');
  });
});

describe('msg (the request language)', () => {
  it('writes English outside a request', () => {
    expect(msg('errors:generic')).toBe('Something went wrong. Please try again.');
  });

  it('writes the language set for the work', () => {
    expect(withLanguage('es', () => msg('errors:generic'))).toBe('Algo salió mal. Por favor, inténtalo de nuevo.');
  });

  it('keeps the language of the request for the rest of it', async () => {
    const seen = await new Promise<string>((resolve) => {
      const req = { headers: { 'accept-language': 'en-GB' } } as never;
      requestLanguage(req, {} as never, () => { setTimeout(() => resolve(msg('errors:forbidden')), 0); });
    });
    expect(seen).toBe('You do not have permission to perform this action.');
  });
});
