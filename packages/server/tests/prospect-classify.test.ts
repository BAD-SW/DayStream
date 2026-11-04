import { describe, it, expect } from 'vitest';

import {
  passesContactFilter,
  passesConfidence,
  classifyProspect,
  reclassifyPreservingManual,
  DEFAULT_CONTACT_FILTER,
  DEFAULT_CONFIDENCE_THRESHOLD,
  ClassifyInput,
} from '../src/services/prospect-classify';

const withContact = (phone: string | null, website: string | null): ClassifyInput => ({
  confidence: 0.9, phone, website,
});

describe('passesContactFilter', () => {
  it("'all' accepts everything, including fully blank contact", () => {
    expect(passesContactFilter(withContact(null, null), 'all')).toBe(true);
  });

  it("'phone_or_web' (default) accepts phone-only or website-only, rejects neither", () => {
    expect(DEFAULT_CONTACT_FILTER).toBe('phone_or_web');
    expect(passesContactFilter(withContact('716-555-0100', null), 'phone_or_web')).toBe(true);
    expect(passesContactFilter(withContact(null, 'https://x.test'), 'phone_or_web')).toBe(true);
    expect(passesContactFilter(withContact(null, null), 'phone_or_web')).toBe(false);
  });

  it("'phone_and_web' requires both", () => {
    expect(passesContactFilter(withContact('716-555-0100', 'https://x.test'), 'phone_and_web')).toBe(true);
    expect(passesContactFilter(withContact('716-555-0100', null), 'phone_and_web')).toBe(false);
    expect(passesContactFilter(withContact(null, 'https://x.test'), 'phone_and_web')).toBe(false);
  });

  it('treats whitespace-only values as missing', () => {
    expect(passesContactFilter(withContact('   ', '  '), 'phone_or_web')).toBe(false);
  });
});

describe('passesConfidence', () => {
  it('passes when threshold is null or <= 0 (disabled)', () => {
    expect(passesConfidence({ confidence: 0.01, phone: null, website: null }, null)).toBe(true);
    expect(passesConfidence({ confidence: 0.01, phone: null, website: null }, 0)).toBe(true);
  });

  it('passes a record at or above the threshold, holds below', () => {
    expect(passesConfidence({ confidence: 0.5, phone: null, website: null }, 0.3)).toBe(true);
    expect(passesConfidence({ confidence: 0.3, phone: null, website: null }, 0.3)).toBe(true);
    expect(passesConfidence({ confidence: 0.2, phone: null, website: null }, 0.3)).toBe(false);
  });

  it('never holds purely for a missing confidence signal', () => {
    expect(passesConfidence({ confidence: null, phone: null, website: null }, 0.3)).toBe(true);
  });
});

describe('classifyProspect', () => {
  it('includes a strong, reachable record', () => {
    const c = classifyProspect({ confidence: 0.9, phone: '716-555-0100', website: 'https://x.test' });
    expect(c.inclusion).toBe('included');
    expect(c.holdReason).toBeNull();
  });

  it('Exotic Tan (phone only, no website) is INCLUDED under the default filter', () => {
    // Real business reachable by phone — the default phone_or_web keeps it.
    const c = classifyProspect({ confidence: 0.88, phone: '716-555-0199', website: null });
    expect(c.inclusion).toBe('included');
  });

  it('holds a record with no phone and no website under the default filter', () => {
    const c = classifyProspect({ confidence: 0.9, phone: null, website: null });
    expect(c.inclusion).toBe('held');
    expect(c.holdReason).toBe('contact');
  });

  it('holds a low-confidence record with reason confidence (confidence evaluated first)', () => {
    const c = classifyProspect({ confidence: 0.1, phone: null, website: null });
    expect(c.inclusion).toBe('held');
    expect(c.holdReason).toBe('confidence');
  });

  it('uses the default confidence threshold of 0.3', () => {
    expect(DEFAULT_CONFIDENCE_THRESHOLD).toBe(0.3);
    expect(classifyProspect({ confidence: 0.29, phone: 'p', website: 'w' }).holdReason).toBe('confidence');
    expect(classifyProspect({ confidence: 0.31, phone: 'p', website: 'w' }).inclusion).toBe('included');
  });

  it("'phone_and_web' holds a phone-only record on contact", () => {
    const c = classifyProspect(
      { confidence: 0.9, phone: '716-555-0100', website: null },
      { contactFilter: 'phone_and_web' },
    );
    expect(c.inclusion).toBe('held');
    expect(c.holdReason).toBe('contact');
  });

  it("'all' includes a contact-less record", () => {
    const c = classifyProspect(
      { confidence: 0.9, phone: null, website: null },
      { contactFilter: 'all' },
    );
    expect(c.inclusion).toBe('included');
  });
});

describe('reclassifyPreservingManual', () => {
  it('keeps a manual hold regardless of the computed result', () => {
    const c = reclassifyPreservingManual(
      { confidence: 0.99, phone: '716-555-0100', website: 'https://x.test' },
      { inclusion: 'held', holdReason: 'manual' },
      { contactFilter: 'all' },
    );
    expect(c.inclusion).toBe('held');
    expect(c.holdReason).toBe('manual');
  });

  it('recomputes a non-manual record when the filter changes', () => {
    // previously held on contact; operator switches to 'all' -> now included
    const c = reclassifyPreservingManual(
      { confidence: 0.9, phone: null, website: null },
      { inclusion: 'held', holdReason: 'contact' },
      { contactFilter: 'all' },
    );
    expect(c.inclusion).toBe('included');
    expect(c.holdReason).toBeNull();
  });

  it('can newly hold a previously-included record when the filter tightens', () => {
    const c = reclassifyPreservingManual(
      { confidence: 0.9, phone: '716-555-0100', website: null },
      { inclusion: 'included', holdReason: null },
      { contactFilter: 'phone_and_web' },
    );
    expect(c.inclusion).toBe('held');
    expect(c.holdReason).toBe('contact');
  });
});
