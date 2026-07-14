interface BadgeProps {
  children: string;
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
}

const variantColors: Record<string, { bg: string; color: string }> = {
  success: { bg: 'var(--color-success-bg)', color: 'var(--color-success-light)' },
  warning: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)' },
  error: { bg: 'var(--color-error-bg)', color: 'var(--color-error-light)' },
  info: { bg: 'var(--color-info-bg)', color: 'var(--color-info-light)' },
  neutral: { bg: 'var(--color-surface)', color: 'var(--color-text-secondary)' },
};

export function Badge({ children, variant = 'neutral' }: BadgeProps) {
  const colors = variantColors[variant];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2px 8px',
        borderRadius: 'var(--radius-full)',
        fontSize: 'var(--font-size-xs)',
        fontWeight: 'var(--font-weight-medium)' as any,
        background: colors.bg,
        color: colors.color,
        minWidth: '60px',
      }}
    >
      {children}
    </span>
  );
}
