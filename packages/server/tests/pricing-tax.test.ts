import { describe, it, expect } from 'vitest';
import { calculateTax } from '../src/services/tax.service';

describe('Tax Calculation', () => {
  describe('Exclusive mode (tax added on top)', () => {
    it('calculates 21% tax on €100', () => {
      const result = calculateTax(10000, 2100, 'exclusive');
      expect(result.subtotal).toBe(10000);
      expect(result.tax_amount).toBe(2100);
      expect(result.total).toBe(12100);
      expect(result.tax_rate).toBe(2100);
      expect(result.display_mode).toBe('exclusive');
    });

    it('calculates 10% reduced rate', () => {
      const result = calculateTax(7500, 1000, 'exclusive');
      expect(result.subtotal).toBe(7500);
      expect(result.tax_amount).toBe(750);
      expect(result.total).toBe(8250);
    });

    it('handles zero rate', () => {
      const result = calculateTax(5000, 0, 'exclusive');
      expect(result.tax_amount).toBe(0);
      expect(result.total).toBe(5000);
    });
  });

  describe('Inclusive mode (tax extracted from total)', () => {
    it('extracts 21% tax from €121 total', () => {
      const result = calculateTax(12100, 2100, 'inclusive');
      expect(result.total).toBe(12100);
      expect(result.subtotal).toBe(10000);
      expect(result.tax_amount).toBe(2100);
      expect(result.display_mode).toBe('inclusive');
    });

    it('extracts 10% from €110', () => {
      const result = calculateTax(11000, 1000, 'inclusive');
      expect(result.total).toBe(11000);
      expect(result.subtotal).toBe(10000);
      expect(result.tax_amount).toBe(1000);
    });

    it('handles zero rate in inclusive mode', () => {
      const result = calculateTax(5000, 0, 'inclusive');
      expect(result.tax_amount).toBe(0);
      expect(result.subtotal).toBe(5000);
      expect(result.total).toBe(5000);
    });

    it('handles small amounts with rounding', () => {
      // €9.99 with 21% inclusive
      const result = calculateTax(999, 2100, 'inclusive');
      expect(result.total).toBe(999);
      expect(result.subtotal + result.tax_amount).toBe(999);
      expect(result.subtotal).toBe(826); // 999 × 10000 / 12100 = 826
      expect(result.tax_amount).toBe(173);
    });
  });

  describe('Edge cases', () => {
    it('zero amount returns all zeros', () => {
      const result = calculateTax(0, 2100, 'exclusive');
      expect(result.total).toBe(0);
      expect(result.tax_amount).toBe(0);
    });

    it('1 cent amount', () => {
      const result = calculateTax(1, 2100, 'exclusive');
      expect(result.subtotal).toBe(1);
      expect(result.tax_amount).toBe(0); // rounds to 0
      expect(result.total).toBe(1);
    });
  });
});
