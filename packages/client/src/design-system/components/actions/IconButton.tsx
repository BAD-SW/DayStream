import { ButtonHTMLAttributes } from 'react';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  icon: React.ReactNode;
  'aria-label': string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'outline' | 'primary';
}

const sizeMap = { sm: '32px', md: '40px', lg: '48px' };

export function IconButton({ icon, 'aria-label': ariaLabel, size = 'md', variant = 'ghost', ...props }: IconButtonProps) {
  return (
    <button
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: sizeMap[size],
        height: sizeMap[size],
        borderRadius: 'var(--radius-md)',
        border: variant === 'outline' ? '1px solid var(--color-border)' : 'none',
        background: variant === 'primary' ? 'var(--color-primary)' : 'transparent',
        color: variant === 'primary' ? 'var(--color-primary-contrast)' : 'var(--color-text-secondary)',
        cursor: 'pointer',
        transition: 'background var(--duration-fast) var(--ease-default)',
      }}
      {...props}
    >
      {icon}
    </button>
  );
}
