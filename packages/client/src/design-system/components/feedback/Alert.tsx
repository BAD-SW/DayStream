import { ReactNode } from 'react';

interface AlertProps {
  children: ReactNode;
  variant?: 'success' | 'warning' | 'error' | 'info';
  title?: string;
}

const variantStyles: Record<string, { bg: string; border: string; color: string }> = {
  success: { bg: 'var(--color-success-bg)', border: 'var(--color-success)', color: 'var(--color-success-light)' },
  warning: { bg: 'var(--color-warning-bg)', border: 'var(--color-warning)', color: 'var(--color-warning)' },
  error: { bg: 'var(--color-error-bg)', border: 'var(--color-error)', color: 'var(--color-error-light)' },
  info: { bg: 'var(--color-info-bg)', border: 'var(--color-info)', color: 'var(--color-info-light)' },
};

export function Alert({ children, variant = 'info', title }: AlertProps) {
  const vs = variantStyles[variant];
  return (
    <div
      role="alert"
      style={{
        background: vs.bg,
        borderLeft: `3px solid ${vs.border}`,
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-md)',
        color: vs.color,
      }}
    >
      {title && <strong style={{ display: 'block', marginBottom: 'var(--space-xs)', fontSize: 'var(--font-size-sm)' }}>{title}</strong>}
      <span style={{ fontSize: 'var(--font-size-sm)' }}>{children}</span>
    </div>
  );
}
