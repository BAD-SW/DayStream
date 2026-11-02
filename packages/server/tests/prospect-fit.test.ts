import { describe, it, expect } from 'vitest';

import {
  classifyCategoryFit,
  deriveFitSignals,
  computeFitScore,
  fitTier,
  scoreFit,
  chainKey,
  detectMultiLocation,
  valuateTerritory,
  mergeFitConfig,
  DEFAULT_FIT_WEIGHTS,
  DEFAULT_FIT_TIER_THRESHOLDS,
  FitInput,
} from '../src/services/prospect-fit';

describe('classifyCategoryFit', () => {
  it('classifies recovery/spa/physio as strong', () => {
    expect(classifyCategoryFit('spa', 'day_spa')).toBe('strong');
    expect(classifyCategoryFit('massage_therapy', null)).toBe('strong');
    expect(classifyCategoryFit(null, 'physical_therapy')).toBe('strong');
    expect(classifyCategoryFit('cryotherapy', null)).toBe('strong');
  });

  it('classifies barber/tanning/nail as weak', () => {
    expect(classifyCategoryFit('tanning_salon', null)).toBe('weak');
    expect(classifyCategoryFit('barber', null)).toBe('weak');
    expect(classifyCategoryFit('nail_salon', null)).toBe('weak');
  });

  it('classifies everything else as moderate', () => {
    expect(classifyCategoryFit('hair_salon', null)).toBe('moderate');
    expect(classifyCategoryFit('beauty_salon', null)).toBe('moderate');
    expect(classifyCategoryFit(null, null)).toBe('moderate');
  });
});

describe('deriveFitSignals', () => {
  it('derives presence flags and category fit', () => {
    const input: FitInput = {
      name: 'Transcend Recovery Spa',
      category: 'spa',
      basicCategory: 'day_spa',
      confidence: 0.92,
      phone: '716-555-0100',
      website: 'https://transcend.test',
      social: null,
      address: '1 Main St, Buffalo NY',
    };
    const s = deriveFitSignals(input);
    expect(s.category_fit).toBe('strong');
    expect(s.has_phone).toBe(true);
    expect(s.has_website).toBe(true);
    expect(s.has_social).toBe(false);
    expect(s.address_complete).toBe(true);
    expect(s.confidence).toBe(0.92);
  });

  it('treats empty strings as missing', () => {
    const s = deriveFitSignals({
      name: 'X', category: null, basicCategory: null, confidence: null,
      phone: '', website: '   ', social: '', address: '',
    });
    expect(s.has_phone).toBe(false);
    expect(s.has_website).toBe(false);
    expect(s.address_complete).toBe(false);
  });
});

describe('computeFitScore + fitTier', () => {
  it('scores a strong-fit, well-contactable, multi-location business highly', () => {
    const result = scoreFit({
      name: 'Advanced Care Physical Therapy',
      category: 'physical_therapy',
      basicCategory: 'physiotherapist',
      confidence: 0.95,
      phone: '716-555-0100',
      website: 'https://advancedcare.test',
      social: 'https://facebook.com/advancedcare',
      address: '100 Elm St',
      multiLocation: true,
    });
    // base 10 + strong 45 + website 15 + phone 10 + social 5 + multi 15 = 100
    expect(result.score).toBe(100);
    expect(result.tier).toBe('strong');
  });

  it('Exotic Tan: real business, found, but LOW fit (weak category, no website)', () => {
    const result = scoreFit({
      name: 'Exotic Tan',
      category: 'tanning_salon',
      basicCategory: 'tanning_salon',
      confidence: 0.88, // high Overture confidence...
      phone: '716-555-0199',
      website: null,    // Facebook-only, no website
      social: 'https://facebook.com/exotictan',
      address: '50 Transit Rd',
    });
    // base 10 + weak 5 + phone 10 + social 5 = 30
    expect(result.score).toBe(30);
    expect(result.tier).toBe('weak');
    // confidence is high but is NOT part of the fit score (strictly separate)
    expect(result.signals.confidence).toBe(0.88);
  });

  it('a moderate category with decent contactability lands mid-tier', () => {
    const result = scoreFit({
      name: 'Bella Hair Studio',
      category: 'hair_salon',
      basicCategory: 'hair_salon',
      confidence: 0.8,
      phone: '716-555-0150',
      website: 'https://bellahair.test',
      social: null,
      address: '22 Center St',
    });
    // base 10 + moderate 25 + website 15 + phone 10 = 60
    expect(result.score).toBe(60);
    expect(result.tier).toBe('moderate');
  });

  it('clamps to 0..100', () => {
    const high = computeFitScore(
      deriveFitSignals({
        name: 'X', category: 'spa', basicCategory: 'spa', confidence: 1,
        phone: 'p', website: 'w', social: 's', address: 'a', multiLocation: true,
      }),
      { ...DEFAULT_FIT_WEIGHTS, categoryStrong: 200 },
    );
    expect(high).toBe(100);
  });

  it('fitTier respects thresholds', () => {
    expect(fitTier(70)).toBe('strong');
    expect(fitTier(69)).toBe('moderate');
    expect(fitTier(45)).toBe('moderate');
    expect(fitTier(44)).toBe('weak');
    expect(DEFAULT_FIT_TIER_THRESHOLDS.strong).toBe(70);
  });
});

describe('multi-location detection', () => {
  it('chainKey strips filler and normalizes', () => {
    expect(chainKey('The Advanced Care Physical Therapy, LLC')).toBe('advanced care physical therapy');
  });

  it('flags same-name different-location records as a chain', () => {
    const names = [
      'Advanced Care Physical Therapy', // 0
      'Advanced Care Physical Therapy', // 1
      'Susan Naturally Day Spa',        // 2 (singleton)
      'Advanced Care Physical Therapy', // 3
    ];
    const multi = detectMultiLocation(names);
    expect(multi.has(0)).toBe(true);
    expect(multi.has(1)).toBe(true);
    expect(multi.has(3)).toBe(true);
    expect(multi.has(2)).toBe(false);
    expect(multi.size).toBe(3);
  });

  it('does not flag a unique business', () => {
    const multi = detectMultiLocation(['Island Aesthetics', 'Grand Island Physical Therapy']);
    expect(multi.size).toBe(0);
  });
});

describe('valuateTerritory', () => {
  it('counts by tier and averages included fit scores', () => {
    const v = valuateTerritory([
      { fit_score: 90, fit_tier: 'strong', inclusion: 'included' },
      { fit_score: 60, fit_tier: 'moderate', inclusion: 'included' },
      { fit_score: 30, fit_tier: 'weak', inclusion: 'included' },
      { fit_score: 95, fit_tier: 'strong', inclusion: 'held' }, // excluded from counts
    ]);
    expect(v.total).toBe(4);
    expect(v.included).toBe(3);
    expect(v.strong).toBe(1);
    expect(v.moderate).toBe(1);
    expect(v.weak).toBe(1);
    expect(v.averageFitScore).toBe(60); // (90+60+30)/3
  });

  it('handles an empty territory', () => {
    const v = valuateTerritory([]);
    expect(v.total).toBe(0);
    expect(v.averageFitScore).toBe(0);
  });
});

describe('mergeFitConfig', () => {
  it('uses defaults when override is empty/null', () => {
    const c = mergeFitConfig(null);
    expect(c.weights).toEqual(DEFAULT_FIT_WEIGHTS);
    expect(c.tierThresholds).toEqual(DEFAULT_FIT_TIER_THRESHOLDS);
  });

  it('merges a partial override over defaults', () => {
    const c = mergeFitConfig({ weights: { categoryStrong: 50 }, tierThresholds: { strong: 80 } });
    expect(c.weights.categoryStrong).toBe(50);
    expect(c.weights.base).toBe(DEFAULT_FIT_WEIGHTS.base); // untouched
    expect(c.tierThresholds.strong).toBe(80);
    expect(c.tierThresholds.moderate).toBe(DEFAULT_FIT_TIER_THRESHOLDS.moderate);
  });
});
