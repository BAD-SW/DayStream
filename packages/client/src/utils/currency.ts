/**
 * Format a monetary amount for display.
 * Amount is in minor units (cents) and currency is the ISO code.
 */
export function formatCurrency(amountInCents: number, currency: string = 'EUR'): string {
  const amount = amountInCents / 100;
  const symbols: Record<string, string> = {
    USD: '$',
    EUR: '€',
  };
  const symbol = symbols[currency.toUpperCase()] || currency + ' ';
  return `${symbol}${amount.toFixed(2)}`;
}

/**
 * Get the currency symbol for an ISO currency code.
 */
export function getCurrencySymbol(currency: string = 'EUR'): string {
  const symbols: Record<string, string> = {
    USD: '$',
    EUR: '€',
  };
  return symbols[currency.toUpperCase()] || currency;
}
