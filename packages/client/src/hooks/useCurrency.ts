import { formatCurrency } from '@daystream/shared';

/**
 * Hook for formatting currency values.
 * For now returns a formatter using EUR (Transcend's currency).
 * Will read from tenant context once tenant config is loaded on auth.
 */
export function useCurrency() {
  // TODO: Read from tenant context when available
  const currency = 'EUR';
  const locale = navigator.language || 'en-US';

  return {
    currency,
    format: (amountInCents: number) => formatCurrency(amountInCents, currency, locale),
  };
}
