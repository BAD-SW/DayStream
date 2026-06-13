import { ReactNode } from 'react';

interface HeaderProps {
  logo?: ReactNode;
  businessLogoUrl?: string | null;
  persona?: 'system' | 'tenant' | 'business' | 'customer';
  children?: ReactNode;  // Center content (nav links, etc.)
  actions?: ReactNode;   // Right side (user menu, toggles)
}

export function Header({ logo, businessLogoUrl, persona, children, actions }: HeaderProps) {
  const showBusinessLogo = (persona === 'business' || persona === 'customer') && businessLogoUrl;

  return (
    <header style={styles.header}>
      <div style={styles.left}>
        {showBusinessLogo ? (
          <img src={businessLogoUrl!} alt="Business logo" style={styles.businessLogo} />
        ) : (
          logo || <span style={styles.defaultLogo}>DayStream</span>
        )}
      </div>
      {children && <div style={styles.center}>{children}</div>}
      {actions && <div style={styles.right}>{actions}</div>}
    </header>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 var(--space-lg)',
    height: '56px',
    borderBottom: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    position: 'sticky',
    top: 0,
    zIndex: 200,
  },
  left: { display: 'flex', alignItems: 'center' },
  center: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)' },
  right: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' },
  defaultLogo: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-primary)' },
  businessLogo: { height: '32px', maxWidth: '140px', objectFit: 'contain' as const },
};
