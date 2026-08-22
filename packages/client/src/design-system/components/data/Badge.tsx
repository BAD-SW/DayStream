interface BadgeProps {
  children: string;
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  /** Escape hatch for palettes beyond the 5 fixed variants above (e.g. per-stage pill colors). */
  bg?: string;
  fg?: string;
}

const variantColors: Record<string, { bg: string; color: string }> = {
  success: { bg: 'var(--color-success-bg)', color: 'var(--color-success-light)' },
  warning: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)' },
  error: { bg: 'var(--color-error-bg)', color: 'var(--color-error-light)' },
  info: { bg: 'var(--color-info-bg)', color: 'var(--color-info-light)' },
  neutral: { bg: 'var(--color-surface)', color: 'var(--color-text-secondary)' },
};

export function Badge({ children, variant = 'neutral', bg, fg }: BadgeProps) {
  const colors = variantColors[variant];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '5px 13px',
        borderRadius: 'var(--radius-full)',
        fontSize: '12.5px',
        fontWeight: 'var(--font-weight-bold)' as any,
        background: bg ?? colors.bg,
        color: fg ?? colors.color,
        minWidth: '60px',
      }}
    >
      {children}
    </span>
  );
}
