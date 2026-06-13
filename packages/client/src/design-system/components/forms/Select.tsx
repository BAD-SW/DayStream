import { FormField } from './FormField';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label: string;
  name: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
  helperText?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export function Select({ label, name, options, value, onChange, error, helperText, required, disabled, placeholder }: SelectProps) {
  return (
    <FormField label={label} name={name} error={error} helperText={helperText} required={required}>
      <select
        id={name}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled}
        aria-invalid={!!error}
        style={{
          ...selectStyle,
          borderColor: error ? 'var(--color-error)' : 'var(--color-border)',
        }}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </FormField>
  );
}

const selectStyle: React.CSSProperties = {
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
  cursor: 'pointer',
};
