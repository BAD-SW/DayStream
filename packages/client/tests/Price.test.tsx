import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Price } from '../src/components/Price';

// Mock the useCurrency hook
vi.mock('../src/hooks/useCurrency', () => ({
  useCurrency: () => ({
    currency: 'EUR',
    format: (amountInCents: number) => {
      const amount = amountInCents / 100;
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(amount);
    },
  }),
}));

describe('Price component', () => {
  it('renders formatted price', () => {
    render(<Price amount={4500} />);
    // €45.00 (formatted by Intl)
    expect(screen.getByText(/45/)).toBeInTheDocument();
  });

  it('renders zero price', () => {
    render(<Price amount={0} />);
    expect(screen.getByText(/0/)).toBeInTheDocument();
  });

  it('renders cents correctly', () => {
    render(<Price amount={1299} />);
    expect(screen.getByText(/12\.99/)).toBeInTheDocument();
  });
});
