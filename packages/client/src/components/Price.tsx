import { useCurrency } from '../hooks/useCurrency';

interface PriceProps {
  amount: number; // in cents / minor units
}

/**
 * Display a formatted price using the tenant's configured currency.
 */
export function Price({ amount }: PriceProps) {
  const { format } = useCurrency();
  return <span>{format(amount)}</span>;
}
