import { ReactNode } from 'react';

interface FormFieldProps {
  label: string;
  name: string;
  error?: string;
  helperText?: string;
  required?: boolean;
  children: ReactNode;
}

export function FormField({ label, name, error, helperText, required, children }: FormFieldProps) {
  return (
    <div style={styles.field}>
      <label htmlFor={name} style={styles.label}>
        {label}
        {required && <span style={styles.required} aria-hidden="true"> *</span>}
      </label>
      {children}
      {error && <p style={styles.error} role="alert">{error}</p>}
      {!error && helperText && <p style={styles.helper}>{helperText}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  field: { display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text)' },
  required: { color: 'var(--color-error)' },
  error: { fontSize: 'var(--font-size-xs)', color: 'var(--color-error)', margin: 0 },
  helper: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', margin: 0 },
};
