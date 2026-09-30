import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  /** Optional bold heading rendered at the top of the card. */
  title?: ReactNode;
  /** Optional content on the right of the heading row (e.g. actions). */
  actions?: ReactNode;
  variant?: 'default' | 'elevated' | 'outlined' | 'interactive';
  padding?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  className?: string;
}

const paddingMap = { sm: 'var(--space-sm)', md: 'var(--space-md)', lg: 'var(--space-lg)' };

export function Card({ children, title, actions, variant = 'default', padding = 'md', onClick, className }: CardProps) {
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
        border: variant === 'outlined' ? '1px solid var(--color-border)' : '1px solid var(--card-border-color)',
        borderRadius: 'var(--card-radius)',
        padding: paddingMap[padding],
        boxShadow: variant === 'elevated' ? 'var(--shadow-md)' : undefined,
        cursor: isInteractive ? 'pointer' : undefined,
        transition: 'transform var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default)',
      }}
    >
      {(title || actions) && (
        <div style={headStyle}>
          {title && <h3 style={titleStyle}>{title}</h3>}
          {actions && <div style={actionsStyle}>{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

const headStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' };
const titleStyle: React.CSSProperties = { margin: 0, fontSize: 'var(--card-title-size)', fontWeight: 'var(--card-title-weight)' as any, color: 'var(--color-text-title)', lineHeight: 'var(--line-height-tight)' };
const actionsStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' };
