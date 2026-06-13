import { useLocation } from 'react-router-dom';
import { Persona } from '@daystream/shared';

interface NavItem {
  label: string;
  path: string;
  icon: string;
}

interface SidebarNavProps {
  persona: Persona;
}

const navByPersona: Record<Persona, NavItem[]> = {
  system: [
    { label: 'Dashboard', path: '/dashboard', icon: '🏠' },
    { label: 'Tenants', path: '/admin/tenants', icon: '🏢' },
    { label: 'Configuration', path: '/admin/config', icon: '⚙️' },
    { label: 'Feature Flags', path: '/admin/feature-flags', icon: '🚩' },
    { label: 'Audit Log', path: '/admin/audit', icon: '🔍' },
  ],
  tenant: [
    { label: 'Dashboard', path: '/dashboard', icon: '🏠' },
    { label: 'Businesses', path: '/businesses', icon: '🏪' },
    { label: 'Billing', path: '/billing', icon: '🧾' },
    { label: 'Reports', path: '/reports', icon: '📈' },
    { label: 'Settings', path: '/settings', icon: '⚙️' },
  ],
  business: [
    { label: 'Dashboard', path: '/dashboard', icon: '🏠' },
    { label: 'Bookings', path: '/bookings', icon: '📅' },
    { label: 'Customers', path: '/customers', icon: '👥' },
    { label: 'Services', path: '/services', icon: '💼' },
    { label: 'Staff', path: '/staff', icon: '👔' },
    { label: 'Reports', path: '/reports', icon: '📈' },
    { label: 'Settings', path: '/settings', icon: '⚙️' },
  ],
  customer: [
    { label: 'Dashboard', path: '/dashboard', icon: '🏠' },
    { label: 'Book', path: '/book', icon: '📅' },
    { label: 'My Bookings', path: '/my-bookings', icon: '📋' },
    { label: 'Account', path: '/profile', icon: '👤' },
  ],
};

export function SidebarNav({ persona }: SidebarNavProps) {
  const location = useLocation();
  const items = navByPersona[persona] || navByPersona.customer;

  return (
    <nav style={styles.nav} aria-label="Main navigation">
      {items.map((item) => {
        const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
        return (
          <a
            key={item.path}
            href={item.path}
            style={{ ...styles.link, ...(isActive ? styles.linkActive : {}) }}
            aria-current={isActive ? 'page' : undefined}
          >
            <span style={styles.icon}>{item.icon}</span>
            <span>{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

const styles: Record<string, React.CSSProperties> = {
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-xs)',
    padding: 'var(--space-lg) var(--space-sm)',
  },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    padding: 'var(--space-sm) var(--space-md)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--color-text-secondary)',
    textDecoration: 'none',
    fontSize: 'var(--font-size-sm)',
    transition: 'background var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default)',
  },
  linkActive: {
    background: 'var(--color-surface-hover)',
    color: 'var(--color-primary)',
    fontWeight: 600,
  },
  icon: {
    fontSize: '16px',
    width: '20px',
    textAlign: 'center',
  },
};
