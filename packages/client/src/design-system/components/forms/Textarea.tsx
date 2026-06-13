import { TextareaHTMLAttributes } from 'react';
import { FormField } from './FormField';

interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  label: string;
  name: string;
  error?: string;
  helperText?: string;
  onChange: (value: string) => void;
  value: string;
}

export function Textarea({ label, name, error, helperText, required, onChange, value, ...props }: TextareaProps) {
  return (
    <FormField label={label} name={name} error={error} helperText={helperText} required={required}>
      <textarea
        id={name}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        aria-invalid={!!error}
        rows={4}
        style={{
          ...textareaStyle,
          borderColor: error ? 'var(--color-error)' : 'var(--color-border)',
        }}
        {...props}
      />
    </FormField>
  );
}

const textareaStyle: React.CSSProperties = {
  background: 'var(--color-background)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '10px 12px',
  fontSize: 'var(--font-size-base)',
  color: 'var(--color-text)',
  fontFamily: 'var(--font-family)',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  resize: 'vertical',
  minHeight: '100px',
};
