import { FormField } from './FormField';

interface RadioOption {
  value: string;
  label: string;
}

interface RadioGroupProps {
  label: string;
  name: string;
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

export function RadioGroup({ label, name, options, value, onChange, error, required, disabled }: RadioGroupProps) {
  return (
    <FormField label={label} name={name} error={error} required={required}>
      <div role="radiogroup" aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        {options.map((opt) => (
          <label key={opt.value} style={styles.option}>
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              disabled={disabled}
              style={styles.radio}
            />
            <span style={styles.label}>{opt.label}</span>
          </label>
        ))}
      </div>
    </FormField>
  );
}

const styles: Record<string, React.CSSProperties> = {
  option: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' },
  radio: { width: '18px', height: '18px', accentColor: 'var(--color-primary)', cursor: 'pointer' },
  label: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
};
