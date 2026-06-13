import { FormField } from './FormField';

interface TimePickerProps {
  label: string;
  name: string;
  value: string; // HH:MM format
  onChange: (value: string) => void;
  error?: string;
  helperText?: string;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
  step?: number; // interval in seconds (e.g., 900 = 15 minutes)
}

export function TimePicker({ label, name, value, onChange, error, helperText, required, disabled, min, max, step }: TimePickerProps) {
  return (
    <FormField label={label} name={name} error={error} helperText={helperText} required={required}>
      <input
        id={name}
        name={name}
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        aria-invalid={!!error}
        style={{
          ...inputStyle,
          borderColor: error ? 'var(--color-error)' : 'var(--color-border)',
        }}
      />
    </FormField>
  );
}

const inputStyle: React.CSSProperties = {
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
  colorScheme: 'dark',
};
