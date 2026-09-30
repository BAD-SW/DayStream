interface BadgeProps {
  children: string;
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  /** Escape hatch for palettes beyond the 5 fixed variants above (e.g. per-stage pill colors). */
  bg?: string;
  fg?: string;
}

const variantColors: Record<string, { bg: string; color: string }> = {
  success: { bg: 'var(--color-success-bg)', color: 'var(--badge-success-fg)' },
  warning: { bg: 'var(--color-warning-bg)', color: 'var(--badge-warning-fg)' },
  error: { bg: 'var(--color-error-bg)', color: 'var(--badge-error-fg)' },
  info: { bg: 'var(--color-info-bg)', color: 'var(--badge-info-fg)' },
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
        padding: 'var(--badge-padding)',
        borderRadius: 'var(--radius-full)',
        fontSize: 'var(--badge-font-size)',
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
