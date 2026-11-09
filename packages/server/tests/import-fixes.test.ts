import { describe, it, expect } from 'vitest';
import { parseDateCell, detectDateOrder, customerMatchInput } from '../src/services/migration/import-core';
import { appointmentStart, isNotHappening } from '../src/services/migration/appointment-import';
import { balanceImportKey } from '../src/services/migration/account-balance-import';

describe('dates — day-first and month-first', () => {
  it('reads ISO dates regardless of order', () => {
    expect(parseDateCell('2026-03-15', 'dmy')).toBe('2026-03-15');
    expect(parseDateCell('2026-03-15', 'mdy')).toBe('2026-03-15');
  });
  it('reads the same digits differently by order', () => {
    expect(parseDateCell('05/04/2026', 'mdy')).toBe('2026-05-04'); // May 4
    expect(parseDateCell('05/04/2026', 'dmy')).toBe('2026-04-05'); // 5 April
  });
  it('accepts a day-first date that month-first rejects', () => {
    expect(parseDateCell('15/03/2026', 'dmy')).toBe('2026-03-15');
    expect(parseDateCell('15/03/2026', 'mdy')).toBeNull();
  });
  it('accepts dots and dashes as separators', () => {
    expect(parseDateCell('15.03.2026', 'dmy')).toBe('2026-03-15');
    expect(parseDateCell('3-15-2026', 'mdy')).toBe('2026-03-15');
  });
  it('expands two-digit years: near future is 20xx, otherwise 19xx (birth dates)', () => {
    const nextYY = String((new Date().getUTCFullYear() + 1) % 100).padStart(2, '0');
    expect(parseDateCell(`03/04/${nextYY}`, 'mdy')).toBe(`20${nextYY}-03-04`);
    expect(parseDateCell('05/03/67', 'mdy')).toBe('1967-05-03');
  });
  it('rejects impossible dates', () => {
    expect(parseDateCell('31/02/2026', 'dmy')).toBeNull();
    expect(parseDateCell('2026-13-01', 'dmy')).toBeNull();
  });
  it('still reads written-out dates', () => {
    expect(parseDateCell('15 March 2026', 'dmy')).toBe('2026-03-15');
  });
});

describe('detectDateOrder — working the order out from a file', () => {
  it('a first part over 12 means day-first', () => {
    expect(detectDateOrder(['05/04/2026', '15/03/2026', '01/02/2026'])).toBe('dmy');
  });
  it('a second part over 12 means month-first', () => {
    expect(detectDateOrder(['05/04/2026', '3/15/2026'])).toBe('mdy');
  });
  it('cannot tell when every part is 12 or under, or the file contradicts itself', () => {
    expect(detectDateOrder(['05/04/2026', '01/02/2026'])).toBeNull();
    expect(detectDateOrder(['15/03/2026', '3/15/2026'])).toBeNull();
    expect(detectDateOrder(['2026-03-15', 'Visa', ''])).toBeNull();
  });
});

describe('appointments — business time zone', () => {
  it('reads the time as Madrid wall-clock time (summer, UTC+2)', () => {
    expect(appointmentStart('2026-07-10', 14 * 60 + 30, 'Europe/Madrid').toISOString()).toBe('2026-07-10T12:30:00.000Z');
  });
  it('reads the time as Madrid wall-clock time (winter, UTC+1)', () => {
    expect(appointmentStart('2026-01-10', 14 * 60 + 30, 'Europe/Madrid').toISOString()).toBe('2026-01-10T13:30:00.000Z');
  });
  it('reads New York time and defaults a blank time to local noon', () => {
    expect(appointmentStart('2026-07-10', 9 * 60, 'America/New_York').toISOString()).toBe('2026-07-10T13:00:00.000Z');
    expect(appointmentStart('2026-07-10', null, 'America/New_York').toISOString()).toBe('2026-07-10T16:00:00.000Z');
  });
});

describe('appointments — statuses that mean it will not happen', () => {
  it('recognises cancelled and no-show in their usual spellings', () => {
    for (const s of ['cancelled', 'Canceled', 'No Show', 'no_show', 'no-show', 'Late Cancel', 'missed']) {
      expect(isNotHappening(s)).toBe(true);
    }
  });
  it('treats booked statuses and blank as happening', () => {
    for (const s of ['', 'confirmed', 'Booked', 'pending', 'checked in']) expect(isNotHappening(s)).toBe(false);
  });
});

describe('account balances — import key', () => {
  const base = { kind: 'credit' as const, customerId: 'c1', amountCents: 4500, description: 'Gift' };
  it('is the same for the same balance (re-import detected), ignoring spacing and capitals', () => {
    expect(balanceImportKey(base)).toBe(balanceImportKey({ ...base, description: '  gift ' }));
  });
  it('differs when anything that defines the balance differs', () => {
    const k = balanceImportKey(base);
    expect(balanceImportKey({ ...base, amountCents: 4600 })).not.toBe(k);
    expect(balanceImportKey({ ...base, customerId: 'c2' })).not.toBe(k);
    expect(balanceImportKey({ ...base, kind: 'invoice', issueDate: '2026-03-01' })).not.toBe(k);
  });
  it('fits the column', () => {
    expect(balanceImportKey({ ...base, description: 'x'.repeat(2000) }).length).toBeLessThanOrEqual(255);
  });
});

describe('customer matching keys', () => {
  it('every customer-linked import offers the processor customer id first', () => {
    expect(customerMatchInput({ processor_customer_id: 'cus_1', legacy_customer_id: 'L1', email: 'a@x.com' })).toEqual({
      processorCustomerIds: ['cus_1'], legacyCustomerId: 'L1', email: 'a@x.com', phone: undefined,
    });
  });
});
