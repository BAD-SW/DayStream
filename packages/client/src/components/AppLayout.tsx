import { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeModeToggle } from '../design-system/themes/ThemeModeToggle';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} style={styles.menuBtn} aria-label="Toggle sidebar">
            ☰
          </button>
          <h1 style={styles.logo}>DayStream</h1>
        </div>
        <div style={styles.headerRight}>
          <LanguageSwitcher />
          {user && <ThemeModeToggle />}
          {user && (
            <span style={styles.userName}>
              {user.first_name ? `${user.first_name} ${user.last_name}` : user.email}
            </span>
          )}
          <button onClick={logout} style={styles.logoutBtn}>Sign Out</button>
        </div>
      </header>

      <div style={styles.body}>
        <nav style={{ ...styles.sidebar, ...(sidebarOpen ? {} : styles.sidebarCollapsed) }}>
          {sidebarOpen ? (
            <>
              <Link to="/dashboard" style={styles.navLink}>Dashboard</Link>
              <Link to="/profile" style={styles.navLink}>Profile</Link>
              {user?.role === 'Super Admin' && (
                <Link to="/query-editor" style={styles.navLink}>Query Editor</Link>
              )}
            </>
          ) : (
            <>
              <Link to="/dashboard" style={styles.navIcon} title="Dashboard">🏠</Link>
              <Link to="/profile" style={styles.navIcon} title="Profile">👤</Link>
              {user?.role === 'Super Admin' && (
                <Link to="/query-editor" style={styles.navIcon} title="Query Editor">⚡</Link>
              )}
            </>
          )}
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
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  menuBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--color-text-secondary)',
    fontSize: '20px',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '4px',
  },
  logo: {
    fontSize: '18px',
    fontWeight: 600,
    margin: 0,
    color: 'var(--color-primary)',
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
    width: '200px',
    backgroundColor: 'var(--color-sidebar-bg)',
    borderRight: '1px solid var(--color-sidebar-border)',
    padding: '24px 16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    transition: 'width 0.2s ease',
  },
  sidebarCollapsed: {
    width: '56px',
    padding: '24px 8px',
    alignItems: 'center' as const,
  },
  navLink: {
    color: 'var(--color-text-secondary)',
    textDecoration: 'none',
    fontSize: '14px',
    padding: '8px 12px',
    borderRadius: '6px',
  },
  navIcon: {
    color: 'var(--color-text-secondary)',
    textDecoration: 'none',
    fontSize: '18px',
    padding: '8px',
    borderRadius: '6px',
    textAlign: 'center' as const,
  },
  content: {
    flex: 1,
    padding: '32px',
  },
};
