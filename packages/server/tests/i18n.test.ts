import { describe, it, expect } from 'vitest';
import { getLocalizedMessage, detectLanguageFromRequest } from '../src/i18n/messages';

describe('getLocalizedMessage', () => {
  it('returns English message for en', () => {
    const msg = getLocalizedMessage('error.invalid_credentials', 'en');
    expect(msg).toBe('Invalid email or password.');
  });

  it('returns Spanish message for es', () => {
    const msg = getLocalizedMessage('error.invalid_credentials', 'es');
    expect(msg).toBe('Correo o contraseña inválidos.');
  });

  it('falls back to English for unsupported language', () => {
    const msg = getLocalizedMessage('error.forbidden', 'fr');
    expect(msg).toBe('You do not have permission to perform this action.');
  });

  it('falls back to generic error for unknown key', () => {
    const msg = getLocalizedMessage('error.nonexistent', 'en');
    expect(msg).toBe('Something went wrong. Please try again.');
  });
});

describe('detectLanguageFromRequest', () => {
  it('detects English', () => {
    expect(detectLanguageFromRequest('en-US,en;q=0.9')).toBe('en');
  });

  it('detects Spanish', () => {
    expect(detectLanguageFromRequest('es-ES,es;q=0.9,en;q=0.8')).toBe('es');
  });

  it('falls back to English for unsupported language', () => {
    expect(detectLanguageFromRequest('fr-FR,fr;q=0.9')).toBe('en');
  });

  it('returns en for undefined header', () => {
    expect(detectLanguageFromRequest(undefined)).toBe('en');
  });
});
