import { describe, it, expect } from 'vitest';
import { resolveMethodType, parseExpiry } from '../src/services/migration/payment-method-import';

describe('resolveMethodType — card vs bank account', () => {
  it('defaults to card when nothing says otherwise', () => {
    expect(resolveMethodType({ brand: 'Visa' })).toEqual({ type: 'card', scheme: null });
    expect(resolveMethodType({})).toEqual({ type: 'card', scheme: null });
  });
  it('recognises SEPA, ACH and Bacs from an explicit type', () => {
    expect(resolveMethodType({ method_type: 'SEPA' })).toEqual({ type: 'bank_draw', scheme: 'SEPA' });
    expect(resolveMethodType({ method_type: 'sepa_debit' })).toEqual({ type: 'bank_draw', scheme: 'SEPA' });
    expect(resolveMethodType({ method_type: 'ACH' })).toEqual({ type: 'bank_draw', scheme: 'ACH' });
    expect(resolveMethodType({ method_type: 'us_bank_account' })).toEqual({ type: 'bank_draw', scheme: 'ACH' });
    expect(resolveMethodType({ method_type: 'Bacs Direct Debit' })).toEqual({ type: 'bank_draw', scheme: 'Bacs' });
  });
  it('recognises card types', () => {
    expect(resolveMethodType({ method_type: 'Credit Card' })).toEqual({ type: 'card', scheme: null });
    expect(resolveMethodType({ method_type: 'card' })).toEqual({ type: 'card', scheme: null });
  });
  it('falls back to the brand text when there is no type column', () => {
    expect(resolveMethodType({ brand: 'SEPA Direct Debit' })).toEqual({ type: 'bank_draw', scheme: 'SEPA' });
  });
  it('rejects an unrecognised explicit type instead of guessing', () => {
    expect('error' in resolveMethodType({ method_type: 'crypto' })).toBe(true);
  });
});

describe('parseExpiry — separate or combined expiry', () => {
  it('reads separate month and year, including two-digit years', () => {
    expect(parseExpiry({ exp_month: '9', exp_year: '2028' })).toEqual({ month: 9, year: 2028 });
    expect(parseExpiry({ exp_month: '12', exp_year: '27' })).toEqual({ month: 12, year: 2027 });
  });
  it('splits a combined expiry in the usual formats', () => {
    expect(parseExpiry({ expiry: '09/28' })).toEqual({ month: 9, year: 2028 });
    expect(parseExpiry({ expiry: '3/2030' })).toEqual({ month: 3, year: 2030 });
    expect(parseExpiry({ expiry: '12-27' })).toEqual({ month: 12, year: 2027 });
  });
  it('returns nulls for out-of-range or missing values instead of storing them', () => {
    expect(parseExpiry({ expiry: '13/28' })).toEqual({ month: null, year: 2028 });
    expect(parseExpiry({})).toEqual({ month: null, year: null });
  });
});
