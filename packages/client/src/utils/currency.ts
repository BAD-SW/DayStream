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
  const curr = currency || getBusinessCurrency();
  const amount = (amountInCents / 100).toFixed(2);
  const symbol = SYMBOLS[curr.toUpperCase()] || curr + ' ';
  return `${symbol}${amount}`;
}

/**
 * Get the currency symbol for an ISO currency code.
 */
export function getCurrencySymbol(currency?: string): string {
  const curr = currency || getBusinessCurrency();
  return SYMBOLS[curr.toUpperCase()] || curr;
}
