import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import Joi from 'joi';
import { useForm } from '../src/design-system/hooks/useForm';

const schema = Joi.object({
  name: Joi.string().min(2).required(),
  email: Joi.string().email({ tlds: false }).required(),
  age: Joi.number().min(18).optional(),
});

const initialValues = { name: '', email: '', age: undefined as number | undefined };

describe('useForm', () => {
  it('initializes with provided values', () => {
    const { result } = renderHook(() => useForm({ schema, initialValues }));
    expect(result.current.values.name).toBe('');
    expect(result.current.values.email).toBe('');
    expect(result.current.errors).toEqual({});
  });

  it('setField updates values', () => {
    const { result } = renderHook(() => useForm({ schema, initialValues }));
    act(() => { result.current.setField('name', 'Bill'); });
    expect(result.current.values.name).toBe('Bill');
  });

  it('validateAll returns false with errors for invalid form', () => {
    const { result } = renderHook(() => useForm({ schema, initialValues }));
    let isValid: boolean;
    act(() => { isValid = result.current.validateAll(); });
    expect(isValid!).toBe(false);
    expect(result.current.errors.name).toBeDefined();
    expect(result.current.errors.email).toBeDefined();
  });

  it('validateAll returns true for valid form', () => {
    const { result } = renderHook(() => useForm({ schema, initialValues }));
    act(() => {
      result.current.setField('name', 'Bill');
      result.current.setField('email', 'bill@example.com');
    });
    let isValid: boolean;
    act(() => { isValid = result.current.validateAll(); });
    expect(isValid!).toBe(true);
    expect(result.current.errors).toEqual({});
  });

  it('validates field on blur (via getFieldProps onBlur)', () => {
    const { result } = renderHook(() => useForm({ schema, initialValues }));
    const props = result.current.getFieldProps('name', 'Name');
    // Simulate blur with empty value
    act(() => { props.onBlur?.(); });
    // After touch + blur, error should appear
    expect(result.current.touched.name).toBe(true);
  });

  it('clears field error when value changes', () => {
    const { result } = renderHook(() => useForm({ schema, initialValues }));
    // Force validation to produce errors
    act(() => { result.current.validateAll(); });
    expect(result.current.errors.name).toBeDefined();
    // Update the field
    act(() => { result.current.setField('name', 'Valid Name'); });
    expect(result.current.errors.name).toBeUndefined();
  });

  it('reset returns to initial values', () => {
    const { result } = renderHook(() => useForm({ schema, initialValues }));
    act(() => {
      result.current.setField('name', 'Changed');
      result.current.validateAll();
    });
    act(() => { result.current.reset(); });
    expect(result.current.values.name).toBe('');
    expect(result.current.errors).toEqual({});
    expect(result.current.touched).toEqual({});
  });

  it('getFieldProps returns correct structure', () => {
    const { result } = renderHook(() => useForm({ schema, initialValues }));
    const props = result.current.getFieldProps('email', 'Email');
    expect(props.name).toBe('email');
    expect(props.label).toBe('Email');
    expect(props.value).toBe('');
    expect(props.required).toBe(true);
    expect(typeof props.onChange).toBe('function');
    expect(typeof props.onBlur).toBe('function');
  });
});
