interface CheckboxProps {
  label: string;
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Checkbox({ label, name, checked, onChange, disabled }: CheckboxProps) {
  return (
    <label style={styles.wrapper}>
      <input
        type="checkbox"
        id={name}
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        style={styles.input}
      />
      <span style={styles.label}>{label}</span>
    </label>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' },
  input: { width: '18px', height: '18px', accentColor: 'var(--color-primary)', cursor: 'pointer' },
  label: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
};
