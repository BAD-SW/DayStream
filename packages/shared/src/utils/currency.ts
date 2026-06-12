/**
 * Format a monetary amount (stored as integer cents/minor units) for display.
 */
export function formatCurrency(amountInCents: number, currency: string, locale: string): string {
  const amount = amountInCents / 100;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amount);
}
