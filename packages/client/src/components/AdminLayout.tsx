import { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { LanguageSwitcher } from './LanguageSwitcher';

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
          <a href="/admin" style={styles.navLink}>Admin Dashboard</a>
          <a href="/admin/tenants" style={styles.navLink}>Tenants</a>
          <a href="/admin/config" style={styles.navLink}>Configuration</a>
          <a href="/admin/feature-flags" style={styles.navLink}>Feature Flags</a>
          <a href="/admin/audit-log" style={styles.navLink}>Audit Log</a>
          <div style={styles.divider} />
          <a href="/dashboard" style={styles.navLink}>← Back to App</a>
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
    backgroundColor: '#1A1A1A',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: '#F5F5F3',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 24px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
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
    color: '#C9A96E',
  },
  adminBadge: {
    fontSize: '11px',
    fontWeight: 500,
    color: '#8A8A8A',
    border: '1px solid #333',
    borderRadius: '4px',
    padding: '2px 6px',
    marginLeft: '8px',
    verticalAlign: 'middle',
  },
  userName: {
    fontSize: '13px',
    color: '#B0B0B0',
  },
  logoutBtn: {
    background: 'none',
    border: '1px solid #333',
    borderRadius: '6px',
    color: '#B0B0B0',
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
    borderRight: '1px solid rgba(255, 255, 255, 0.08)',
    padding: '24px 16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  navLink: {
    color: '#B0B0B0',
    textDecoration: 'none',
    fontSize: '14px',
    padding: '8px 12px',
    borderRadius: '6px',
  },
  divider: {
    height: '1px',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    margin: '12px 0',
  },
  content: {
    flex: 1,
    padding: '32px',
    maxWidth: '1024px',
  },
};
