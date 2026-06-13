interface SwitchProps {
  label: string;
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Switch({ label, name, checked, onChange, disabled }: SwitchProps) {
  return (
    <label style={styles.wrapper}>
      <span style={styles.label}>{label}</span>
      <button
        type="button"
        role="switch"
        id={name}
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{
          ...styles.track,
          background: checked ? 'var(--color-primary)' : 'var(--color-border)',
        }}
      >
        <span style={{ ...styles.thumb, transform: checked ? 'translateX(20px)' : 'translateX(2px)' }} />
      </button>
    </label>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-md)', cursor: 'pointer' },
  label: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  track: {
    width: '44px',
    height: '24px',
    borderRadius: 'var(--radius-full)',
    border: 'none',
    cursor: 'pointer',
    position: 'relative',
    transition: 'background var(--duration-fast) var(--ease-default)',
    padding: 0,
  },
  thumb: {
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    background: '#FFFFFF',
    position: 'absolute',
    top: '2px',
    transition: 'transform var(--duration-fast) var(--ease-default)',
  },
};
