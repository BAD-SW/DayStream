import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  variant?: 'default' | 'elevated' | 'outlined' | 'interactive';
  padding?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  className?: string;
}

const paddingMap = { sm: 'var(--space-sm)', md: 'var(--space-md)', lg: 'var(--space-lg)' };

export function Card({ children, variant = 'default', padding = 'md', onClick, className }: CardProps) {
  const isInteractive = variant === 'interactive' || !!onClick;

  return (
    <div
      className={className}
      onClick={onClick}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onKeyDown={isInteractive ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); } : undefined}
      style={{
        background: 'var(--color-surface)',
        border: variant === 'outlined' ? '1px solid var(--color-border)' : '1px solid transparent',
        borderRadius: 'var(--radius-lg)',
        padding: paddingMap[padding],
        boxShadow: variant === 'elevated' ? 'var(--shadow-md)' : undefined,
        cursor: isInteractive ? 'pointer' : undefined,
        transition: 'transform var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default)',
      }}
    >
      {children}
    </div>
  );
}
