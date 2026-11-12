import { describe, it, expect } from 'vitest';
import {
  validateFormDefinition,
  validateFormAnswers,
  isSignedForm,
  entriesByColumn,
  type FormDefinition,
} from '../src/forms/definition';

const signed: FormDefinition = {
  items: [
    { id: 'h', type: 'heading', text: 'Waiver' },
    { id: 't', type: 'text', text: 'I accept the risks.' },
    { id: 'q1', type: 'write_in', label: 'Emergency contact', required: true },
    { id: 'q2', type: 'single_choice', label: 'Experience', required: false, options: ['New', 'Regular'] },
    { id: 'a', type: 'agree', label: 'I have read and agree' },
    { id: 's', type: 'signature', label: 'Signature' },
  ],
};

describe('validateFormDefinition', () => {
  it('accepts a signed form', () => {
    expect(validateFormDefinition(signed)).toEqual([]);
    expect(isSignedForm(signed)).toBe(true);
  });

  it('accepts a form with neither agree nor signature', () => {
    const def: FormDefinition = { items: [{ id: 'q', type: 'write_in', label: 'Notes', required: false }] };
    expect(validateFormDefinition(def)).toEqual([]);
    expect(isSignedForm(def)).toBe(false);
  });

  it('rejects agree without signature and the reverse', () => {
    const onlyAgree: FormDefinition = { items: [{ id: 'a', type: 'agree', label: 'Agree' }] };
    const onlySig: FormDefinition = { items: [{ id: 's', type: 'signature', label: 'Sign' }] };
    expect(validateFormDefinition(onlyAgree)).not.toEqual([]);
    expect(validateFormDefinition(onlySig)).not.toEqual([]);
  });

  it('rejects empty, malformed and unknown items', () => {
    expect(validateFormDefinition(null)).not.toEqual([]);
    expect(validateFormDefinition({ items: [] })).not.toEqual([]);
    expect(validateFormDefinition({ items: [{ id: 'x', type: 'banana' }] })).not.toEqual([]);
  });

  it('requires labels and text', () => {
    expect(validateFormDefinition({ items: [{ id: 'q', type: 'date', label: ' ', required: true }] })).not.toEqual([]);
    expect(validateFormDefinition({ items: [{ id: 'h', type: 'heading', text: '' }] })).not.toEqual([]);
  });

  it('requires at least two distinct, non-empty options', () => {
    const one = { items: [{ id: 'c', type: 'multi_choice', label: 'x', required: true, options: ['A'] }] };
    const blank = { items: [{ id: 'c', type: 'multi_choice', label: 'x', required: true, options: ['A', ''] }] };
    const dup = { items: [{ id: 'c', type: 'multi_choice', label: 'x', required: true, options: ['A', 'a'] }] };
    expect(validateFormDefinition(one)).not.toEqual([]);
    expect(validateFormDefinition(blank)).not.toEqual([]);
    expect(validateFormDefinition(dup)).not.toEqual([]);
  });

  it('rejects duplicate ids and a second agree box', () => {
    const dupIds = { items: [
      { id: 'q', type: 'write_in', label: 'a', required: true },
      { id: 'q', type: 'write_in', label: 'b', required: true },
    ] };
    expect(validateFormDefinition(dupIds)).not.toEqual([]);
    const two = { items: [
      { id: 'a1', type: 'agree', label: 'a' }, { id: 'a2', type: 'agree', label: 'b' },
      { id: 's', type: 'signature', label: 's' },
    ] };
    expect(validateFormDefinition(two)).not.toEqual([]);
  });
});

describe('validateFormAnswers', () => {
  it('passes a complete answer set', () => {
    expect(validateFormAnswers(signed, { q1: 'Sam 555', q2: 'New', a: true })).toEqual([]);
  });

  it('flags a missing required answer and an unticked agree box', () => {
    const ids = validateFormAnswers(signed, { q1: ' ', a: false }).map((i) => i.itemId);
    expect(ids).toEqual(expect.arrayContaining(['q1', 'a']));
  });

  it('flags choices outside the options and bad dates', () => {
    expect(validateFormAnswers(signed, { q1: 'x', q2: 'Expert', a: true }).map((i) => i.itemId)).toEqual(['q2']);
    const dateForm: FormDefinition = { items: [{ id: 'd', type: 'date', label: 'DOB', required: true }] };
    expect(validateFormAnswers(dateForm, { d: '01/02/2000' })).not.toEqual([]);
    expect(validateFormAnswers(dateForm, { d: '2000-02-01' })).toEqual([]);
  });

  it('allows optional questions to be blank', () => {
    expect(validateFormAnswers(signed, { q1: 'x', a: true })).toEqual([]);
  });
});

describe('checkbox table (multi_choice with columns)', () => {
  const table = (extra: Record<string, unknown>) => ({
    items: [{ id: 't', type: 'multi_choice', label: 'Conditions', required: false, options: ['A', 'B', 'C', 'D', 'E'], ...extra }],
  });

  it('accepts 1 to 4 columns, or none given', () => {
    expect(validateFormDefinition(table({}))).toEqual([]);
    expect(validateFormDefinition(table({ columns: 1 }))).toEqual([]);
    expect(validateFormDefinition(table({ columns: 4 }))).toEqual([]);
  });

  it('rejects 0, 5, fractions and non-numbers', () => {
    for (const columns of [0, 5, 2.5, '2']) expect(validateFormDefinition(table({ columns }))).not.toEqual([]);
  });

  it('answers: nothing ticked is fine when optional, and only listed entries may be ticked', () => {
    const def = table({ columns: 2 }) as unknown as FormDefinition;
    expect(validateFormAnswers(def, {})).toEqual([]);
    expect(validateFormAnswers(def, { t: ['A', 'E'] })).toEqual([]);
    expect(validateFormAnswers(def, { t: ['Z'] })).not.toEqual([]);
  });

  it('entriesByColumn fills down each column first', () => {
    expect(entriesByColumn(['A', 'B', 'C', 'D', 'E', 'F', 'G'], 3)).toEqual([['A', 'B', 'C'], ['D', 'E', 'F'], ['G']]);
    expect(entriesByColumn(['A', 'B', 'C', 'D'], 2)).toEqual([['A', 'B'], ['C', 'D']]);
    expect(entriesByColumn(['A', 'B'], 1)).toEqual([['A', 'B']]);
    expect(entriesByColumn(['A', 'B'], 4)).toEqual([['A'], ['B']]);
    expect(entriesByColumn([], 3)).toEqual([]);
  });
});

describe('write-in answer', () => {
  it('is one type, required or optional', () => {
    const def: FormDefinition = { items: [{ id: 'w', type: 'write_in', label: 'Notes', required: true }] };
    expect(validateFormAnswers(def, {}).map((i) => i.itemId)).toEqual(['w']);
    expect(validateFormAnswers(def, { w: 'some text' })).toEqual([]);
  });
});
