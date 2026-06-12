/**
 * Server-side localized error messages.
 * Used for API responses that need to be in the user's language.
 */

const messages: Record<string, Record<string, string>> = {
  en: {
    'error.generic': 'Something went wrong. Please try again.',
    'error.not_found': 'Resource not found.',
    'error.validation': 'Validation failed.',
    'error.unauthorized': 'Authentication required.',
    'error.forbidden': 'You do not have permission to perform this action.',
    'error.rate_limited': 'Too many requests. Please try again later.',
    'error.invalid_credentials': 'Invalid email or password.',
    'error.account_locked': 'Account is locked. Please try again later.',
    'error.email_exists': 'A user with this email already exists.',
    'error.tenant_suspended': 'This account has been suspended. Please contact support.',
    'error.token_expired': 'Your session has expired. Please sign in again.',
  },
  es: {
    'error.generic': 'Algo salió mal. Por favor, inténtalo de nuevo.',
    'error.not_found': 'Recurso no encontrado.',
    'error.validation': 'La validación falló.',
    'error.unauthorized': 'Se requiere autenticación.',
    'error.forbidden': 'No tienes permiso para realizar esta acción.',
    'error.rate_limited': 'Demasiadas solicitudes. Por favor, inténtalo más tarde.',
    'error.invalid_credentials': 'Correo o contraseña inválidos.',
    'error.account_locked': 'La cuenta está bloqueada. Por favor, inténtalo más tarde.',
    'error.email_exists': 'Ya existe un usuario con este correo electrónico.',
    'error.tenant_suspended': 'Esta cuenta ha sido suspendida. Por favor, contacta con soporte.',
    'error.token_expired': 'Tu sesión ha expirado. Por favor, inicia sesión de nuevo.',
  },
};

/**
 * Get a localized error message.
 * Falls back to English if the requested language or key is not found.
 */
export function getLocalizedMessage(key: string, lang: string): string {
  const langMessages = messages[lang] || messages['en'];
  return langMessages[key] || messages['en'][key] || messages['en']['error.generic'];
}

/**
 * Detect language from request headers (Accept-Language).
 */
export function detectLanguageFromRequest(acceptLanguage?: string): string {
  if (!acceptLanguage) return 'en';
  const primary = acceptLanguage.split(',')[0]?.split('-')[0]?.toLowerCase();
  if (primary && messages[primary]) return primary;
  return 'en';
}
