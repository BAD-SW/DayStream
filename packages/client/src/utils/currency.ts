import { currentLocale } from '../i18n';

const SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
};

/**
 * Get the business currency from localStorage, defaults to EUR.
 */
export function getBusinessCurrency(): string {
  return localStorage.getItem('business_currency') || 'EUR';
}

/**
 * Format a monetary amount for display.
 * Amount is in minor units (cents). Currency defaults to the business currency from localStorage.
 */
export function formatCurrency(amountInCents: number, currency?: string): string {
  // In the format of the language shown (Phase 44): €12.50 in English, 12,50 € in Spanish.
  const curr = (currency || getBusinessCurrency()).toUpperCase();
  try {
    return new Intl.NumberFormat(currentLocale(), { style: 'currency', currency: curr }).format(amountInCents / 100);
  } catch {
    const symbol = SYMBOLS[curr] || curr + ' ';
    return `${symbol}${(amountInCents / 100).toFixed(2)}`;
  }
}

/**
 * Get the currency symbol for an ISO currency code.
 */
export function getCurrencySymbol(currency?: string): string {
  const curr = currency || getBusinessCurrency();
  return SYMBOLS[curr.toUpperCase()] || curr;
}
