import { ReactNode } from 'react';

type ActionVariant = 'default' | 'edit' | 'archive' | 'restore' | 'delete' | 'activate' | 'pause';

interface TableActionButtonProps {
  label: string;
  variant?: ActionVariant;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children?: ReactNode;
}

const VARIANT_STYLES: Record<ActionVariant, { color: string; borderColor: string; background: string }> = {
  default: { color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)', background: 'transparent' },
  edit: { color: '#fff', borderColor: 'var(--color-text-secondary)', background: 'var(--color-text-secondary)' },
  archive: { color: '#fff', borderColor: 'var(--color-success, #2E7D32)', background: 'var(--color-success, #2E7D32)' },
  restore: { color: '#fff', borderColor: 'var(--color-error, #D32F2F)', background: 'var(--color-error, #D32F2F)' },
  delete: { color: '#fff', borderColor: 'var(--color-error, #D32F2F)', background: 'var(--color-error, #D32F2F)' },
  activate: { color: '#fff', borderColor: 'var(--color-success, #2E7D32)', background: 'var(--color-success, #2E7D32)' },
  pause: { color: '#fff', borderColor: 'var(--color-warning-dark, #C49000)', background: 'var(--color-warning-dark, #C49000)' },
};

export function TableActionButton({ label, variant = 'default', onClick, disabled, title }: TableActionButtonProps) {
  const variantStyle = VARIANT_STYLES[variant];

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      title={title || label}
      style={{
        background: variantStyle.background,
        border: `1px solid ${variantStyle.borderColor}`,
        borderRadius: 'var(--radius-sm, 4px)',
        padding: '2px 8px',
        fontSize: 'var(--font-size-xs, 12px)',
        color: variantStyle.color,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--font-family)',
        fontWeight: 500,
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}
