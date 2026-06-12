import { describe, it, expect } from 'vitest';
import { generateSlug } from '../src/utils/slug';
import { formatCurrency } from '../src/utils/currency';
import { formatDate } from '../src/utils/date';

describe('generateSlug', () => {
  it('converts name to lowercase slug', () => {
    expect(generateSlug('Transcend Health Mallorca')).toBe('transcend-health-mallorca');
  });

  it('removes accents', () => {
    expect(generateSlug('Café Résumé')).toBe('cafe-resume');
  });

  it('handles special characters', () => {
    expect(generateSlug('Hello & World!')).toBe('hello-world');
  });

  it('trims leading/trailing hyphens', () => {
    expect(generateSlug('  --test--  ')).toBe('test');
  });

  it('truncates to 100 characters', () => {
    const longName = 'a'.repeat(150);
    expect(generateSlug(longName).length).toBeLessThanOrEqual(100);
  });

  it('handles empty string', () => {
    expect(generateSlug('')).toBe('');
  });
});

describe('formatCurrency', () => {
  it('formats EUR correctly', () => {
    const result = formatCurrency(4500, 'EUR', 'en-US');
    expect(result).toContain('45');
    expect(result).toContain('00');
  });

  it('formats USD correctly', () => {
    const result = formatCurrency(1299, 'USD', 'en-US');
    expect(result).toBe('$12.99');
  });

  it('formats GBP correctly', () => {
    const result = formatCurrency(1000, 'GBP', 'en-GB');
    expect(result).toContain('10');
  });

  it('handles zero', () => {
    const result = formatCurrency(0, 'EUR', 'en-US');
    expect(result).toContain('0');
  });
});

describe('formatDate', () => {
  it('formats a date string', () => {
    const result = formatDate('2026-06-11T12:00:00Z', 'en-US');
    expect(result).toContain('Jun');
    expect(result).toContain('2026');
  });

  it('formats a Date object', () => {
    const result = formatDate(new Date('2026-01-15'), 'en-US');
    expect(result).toContain('Jan');
    expect(result).toContain('2026');
  });
});
