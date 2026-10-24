import { describe, it, expect } from 'vitest';
import {
  parseCsv, classifyCell, detectHeaderRow, detectColumns, applyMapping, CUSTOMER_FIELDS,
} from '../src/services/migration/import-engine';

/**
 * Phase 50 Wave 1 — unit coverage for the pure detection engine: CSV parsing,
 * cell classification, header-row detection (by comparing row 0 against the data
 * below), and column identification (name-based with a header, value-based
 * without). No DB/IO — pure functions of their inputs.
 */

describe('parseCsv', () => {
  it('parses rows and handles quoted fields with commas', () => {
    const grid = parseCsv('a,b,c\n1,"two, 2",3');
    expect(grid).toEqual([['a', 'b', 'c'], ['1', 'two, 2', '3']]);
  });
  it('drops a trailing empty line and a BOM', () => {
    const grid = parseCsv('\uFEFFx,y\n1,2\n');
    expect(grid).toEqual([['x', 'y'], ['1', '2']]);
  });
});

describe('classifyCell', () => {
  it('classifies the obvious shapes', () => {
    expect(classifyCell('alex@example.com')).toBe('email');
    expect(classifyCell('+1 (555) 123-4567')).toBe('phone');
    expect(classifyCell('2026-10-21')).toBe('date');
    expect(classifyCell('42')).toBe('number');
    expect(classifyCell('$1,074.01')).toBe('money');
    expect(classifyCell('Alex Rivera')).toBe('text');
    expect(classifyCell('')).toBe('empty');
  });
});

describe('detectHeaderRow', () => {
  it('detects a header when row 0 is labels over value-shaped data', () => {
    const grid = [
      ['First Name', 'Email', 'Phone'],
      ['Alex', 'alex@example.com', '+15551234567'],
      ['Sam', 'sam@example.com', '+15559876543'],
    ];
    const r = detectHeaderRow(grid);
    expect(r.hasHeader).toBe(true);
  });

  it('detects NO header when row 0 is data of the same kind as the rows below', () => {
    const grid = [
      ['Alex', 'alex@example.com', '+15551234567'],
      ['Sam', 'sam@example.com', '+15559876543'],
      ['Jo', 'jo@example.com', '+15550001111'],
    ];
    const r = detectHeaderRow(grid);
    expect(r.hasHeader).toBe(false);
  });
});

describe('detectColumns', () => {
  it('maps by header name when a header is present', () => {
    const grid = [
      ['Surname', 'E-mail Address', 'Mobile'],
      ['Rivera', 'alex@example.com', '+15551234567'],
    ];
    const cols = detectColumns(grid, true, CUSTOMER_FIELDS);
    const byIdx = Object.fromEntries(cols.map((c) => [c.index, c.field]));
    expect(byIdx[0]).toBe('last_name');   // Surname
    expect(byIdx[1]).toBe('email');       // E-mail Address
    expect(byIdx[2]).toBe('phone');       // Mobile
    expect(cols.every((c) => c.field === null || c.confident)).toBe(true);
  });

  it('maps by VALUES when there is no header', () => {
    const grid = [
      ['Alex', 'alex@example.com', '2026-10-21'],
      ['Sam', 'sam@example.com', '2025-01-02'],
      ['Jo', 'jo@example.com', '2024-06-30'],
    ];
    const cols = detectColumns(grid, false, CUSTOMER_FIELDS);
    const byIdx = Object.fromEntries(cols.map((c) => [c.index, c.field]));
    expect(byIdx[1]).toBe('email');       // column of email-shaped values
    // column 2 is all dates → a date field (DOB in the customer set)
    expect(byIdx[2]).toBe('date_of_birth');
  });

  it('leaves an unrecognised column unmapped rather than guessing', () => {
    const grid = [
      ['Loyalty #', 'Email'],
      ['L-001', 'alex@example.com'],
    ];
    const cols = detectColumns(grid, true, CUSTOMER_FIELDS);
    expect(cols[0].field).toBeNull();     // "Loyalty #" matches nothing
    expect(cols[1].field).toBe('email');
  });
});

describe('applyMapping', () => {
  it('builds field-keyed row objects, skipping the header row', () => {
    const grid = [
      ['First Name', 'Email'],
      ['Alex', 'alex@example.com'],
      ['Sam', 'sam@example.com'],
    ];
    const rows = applyMapping(grid, true, { 0: 'first_name', 1: 'email' });
    expect(rows).toEqual([
      { first_name: 'Alex', email: 'alex@example.com' },
      { first_name: 'Sam', email: 'sam@example.com' },
    ]);
  });
});
