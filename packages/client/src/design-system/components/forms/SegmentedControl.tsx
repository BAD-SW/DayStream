interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label'?: string;
}

/**
 * A small set of mutually exclusive choices shown side by side (e.g. Quick Setup / Advanced).
 * Pill-shaped with the active segment filled under Navy; follows the control tokens (THE-8).
 */
export function SegmentedControl<T extends string>({ options, value, onChange, 'aria-label': ariaLabel }: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={styles.group}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            style={{ ...styles.option, ...(active ? styles.optionActive : {}) }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  group: {
    display: 'inline-flex',
    gap: '4px',
    padding: '4px',
    minHeight: 'var(--control-height)',
    boxSizing: 'border-box',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--button-radius)',
    background: 'var(--control-bg)',
  },
  option: {
    border: 'none',
    background: 'transparent',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--button-font-weight)' as any,
    padding: '0 var(--space-md)',
    borderRadius: 'var(--button-radius)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  optionActive: { background: 'var(--color-primary)', color: 'var(--color-primary-contrast)' },
};
