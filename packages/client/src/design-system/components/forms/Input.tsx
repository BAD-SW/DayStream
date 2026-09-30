import { InputHTMLAttributes } from 'react';
import { FormField } from './FormField';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'size'> {
  label: string;
  name: string;
  error?: string;
  helperText?: string;
  onChange: (value: string) => void;
  value: string;
}

export function Input({ label, name, error, helperText, required, onChange, value, type = 'text', ...props }: InputProps) {
  return (
    <FormField label={label} name={name} error={error} helperText={helperText} required={required}>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        aria-invalid={!!error}
        aria-describedby={error ? `${name}-error` : undefined}
        style={{
          ...inputStyle,
          borderColor: error ? 'var(--color-error)' : 'var(--color-border)',
        }}
        {...props}
      />
    </FormField>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--control-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--control-radius)',
  padding: '10px var(--control-padding-x)',
  fontSize: 'var(--control-font-size)',
  minHeight: 'var(--control-height)',
  color: 'var(--color-text)',
  fontFamily: 'var(--font-family)',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  transition: 'border-color var(--duration-fast) var(--ease-default)',
};
