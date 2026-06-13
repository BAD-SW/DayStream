import { useState, useCallback } from 'react';
import Joi from 'joi';

interface UseFormOptions<T> {
  schema: Joi.ObjectSchema;
  initialValues: T;
  onSubmit?: (values: T) => void | Promise<void>;
}

interface FieldProps {
  name: string;
  label: string;
  value: any;
  error?: string;
  required?: boolean;
  onChange: (value: any) => void;
  onBlur?: () => void;
}

export function useForm<T extends Record<string, any>>({ schema, initialValues, onSubmit }: UseFormOptions<T>) {
  const [values, setValues] = useState<T>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setField = useCallback((name: string, value: any) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    // Clear error on change
    if (errors[name]) {
      setErrors((prev) => { const next = { ...prev }; delete next[name]; return next; });
    }
  }, [errors]);

  const validateField = useCallback((name: string) => {
    const fieldSchema = schema.extract(name);
    if (!fieldSchema) return;

    const { error } = fieldSchema.validate(values[name]);
    if (error) {
      setErrors((prev) => ({ ...prev, [name]: error.details[0].message }));
    } else {
      setErrors((prev) => { const next = { ...prev }; delete next[name]; return next; });
    }
  }, [schema, values]);

  const validateAll = useCallback((): boolean => {
    const { error } = schema.validate(values, { abortEarly: false });
    if (error) {
      const newErrors: Record<string, string> = {};
      for (const detail of error.details) {
        const field = detail.path.join('.');
        if (!newErrors[field]) newErrors[field] = detail.message;
      }
      setErrors(newErrors);
      return false;
    }
    setErrors({});
    return true;
  }, [schema, values]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!validateAll()) return;
    if (!onSubmit) return;

    setIsSubmitting(true);
    try {
      await onSubmit(values);
    } finally {
      setIsSubmitting(false);
    }
  }, [validateAll, onSubmit, values]);

  const getFieldProps = useCallback((name: string, label: string): FieldProps => ({
    name,
    label,
    value: values[name] ?? '',
    error: touched[name] ? errors[name] : undefined,
    required: schema.describe().keys?.[name]?.flags?.presence === 'required',
    onChange: (value: any) => setField(name, value),
    onBlur: () => {
      setTouched((prev) => ({ ...prev, [name]: true }));
      validateField(name);
    },
  }), [values, errors, touched, schema, setField, validateField]);

  const reset = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setTouched({});
  }, [initialValues]);

  return {
    values,
    errors,
    touched,
    isSubmitting,
    setField,
    validateField,
    validateAll,
    handleSubmit,
    getFieldProps,
    reset,
  };
}
