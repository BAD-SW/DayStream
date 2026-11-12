import { describe, it, expect } from 'vitest';
import { formStatusFor, type StatusContext } from '../src/services/form-status.service';

const now = new Date('2026-07-06T12:00:00Z');
const ctx = (over: Partial<StatusContext> = {}): StatusContext => ({
  hasVisited: false, serviceIds: new Set(), lastCompletedAt: null, now, ...over,
});

describe('formStatusFor', () => {
  it('a form with no rules is optional and never missing', () => {
    expect(formStatusFor({ applies: {}, renewAfterMonths: null }, ctx())).toBe('optional');
    expect(formStatusFor({ applies: {}, renewAfterMonths: 6 }, ctx({ lastCompletedAt: new Date('2020-01-01') }))).toBe('optional');
  });

  it('first-visit form is missing before the first visit, not needed after', () => {
    const rules = { applies: { first_visit: true }, renewAfterMonths: null };
    expect(formStatusFor(rules, ctx())).toBe('missing');
    expect(formStatusFor(rules, ctx({ hasVisited: true }))).toBe('not_needed');
  });

  it('a completed first-visit form stays done after the visit', () => {
    const rules = { applies: { first_visit: true }, renewAfterMonths: null };
    expect(formStatusFor(rules, ctx({ hasVisited: true, lastCompletedAt: new Date('2026-01-01') }))).toBe('done');
  });

  it('service form applies only when one of its services is in context', () => {
    const rules = { applies: { service_ids: ['s1', 's2'] }, renewAfterMonths: null };
    expect(formStatusFor(rules, ctx({ serviceIds: new Set(['s2']) }))).toBe('missing');
    expect(formStatusFor(rules, ctx({ serviceIds: new Set(['s9']) }))).toBe('not_needed');
    expect(formStatusFor(rules, ctx())).toBe('not_needed');
  });

  it('renewal: done inside the period, out of date once it passes', () => {
    const rules = { applies: { service_ids: ['s1'] }, renewAfterMonths: 12 };
    const base = { serviceIds: new Set(['s1']) };
    expect(formStatusFor(rules, ctx({ ...base, lastCompletedAt: new Date('2025-08-01T00:00:00Z') }))).toBe('done');
    expect(formStatusFor(rules, ctx({ ...base, lastCompletedAt: new Date('2025-07-06T00:00:00Z') }))).toBe('out_of_date');
    expect(formStatusFor(rules, ctx({ ...base, lastCompletedAt: new Date('2024-01-01') }))).toBe('out_of_date');
  });

  it('an expired form that no longer applies is not needed', () => {
    const rules = { applies: { service_ids: ['s1'] }, renewAfterMonths: 6 };
    expect(formStatusFor(rules, ctx({ lastCompletedAt: new Date('2024-01-01') }))).toBe('not_needed');
  });

  it('no renewal period means a completed form never expires', () => {
    const rules = { applies: { first_visit: true }, renewAfterMonths: null };
    expect(formStatusFor(rules, ctx({ lastCompletedAt: new Date('2010-01-01') }))).toBe('done');
  });
});
