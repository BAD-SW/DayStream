import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeModeToggle } from '../design-system/themes/ThemeModeToggle';

interface AdminLayoutProps {
  children: ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const { user, logout } = useAuth();

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.logo}>DayStream <span style={styles.adminBadge}>Admin</span></h1>
        <div style={styles.headerRight}>
          <LanguageSwitcher />
          <ThemeModeToggle />
          {user && (
            <span style={styles.userName}>
              {user.first_name ? `${user.first_name} ${user.last_name}` : user.email}
            </span>
          )}
          <button onClick={logout} style={styles.logoutBtn}>Sign Out</button>
        </div>
      </header>

      <div style={styles.body}>
        <nav style={styles.sidebar}>
          <Link to="/dashboard" style={styles.navLink}>Admin Dashboard</Link>
          <Link to="/admin/tenants" style={styles.navLink}>Tenants</Link>
          <Link to="/admin/config" style={styles.navLink}>Configuration</Link>
          <Link to="/admin/audit-log" style={styles.navLink}>Audit Log</Link>
        </nav>

        <main style={styles.content}>
          {children}
        </main>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: 'var(--color-background)',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: 'var(--color-text)',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 24px',
    borderBottom: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-header-bg)',
    height: '56px',
    boxSizing: 'border-box' as const,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  logo: {
    fontSize: '18px',
    fontWeight: 600,
    margin: 0,
    color: 'var(--color-primary)',
  },
  adminBadge: {
    fontSize: '11px',
    fontWeight: 500,
    color: 'var(--color-text-secondary)',
    border: '1px solid var(--color-border)',
    borderRadius: '4px',
    padding: '2px 6px',
    marginLeft: '8px',
    verticalAlign: 'middle',
  },
  userName: {
    fontSize: '13px',
    color: 'var(--color-text-secondary)',
  },
  logoutBtn: {
    background: 'none',
    border: '1px solid var(--color-border)',
    borderRadius: '6px',
    color: 'var(--color-text-secondary)',
    padding: '6px 12px',
    fontSize: '13px',
    cursor: 'pointer',
  },
  body: {
    display: 'flex',
    flex: 1,
  },
  sidebar: {
    width: '220px',
    backgroundColor: 'var(--color-sidebar-bg)',
    borderRight: '1px solid var(--color-sidebar-border)',
    padding: '24px 16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  navLink: {
    color: 'var(--color-text-secondary)',
    textDecoration: 'none',
    fontSize: '14px',
    padding: '8px 12px',
    borderRadius: '6px',
  },
  content: {
    flex: 1,
    padding: '32px',
    maxWidth: '1024px',
  },
};
