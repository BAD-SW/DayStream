import { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useBusinessSettings } from '../context/BusinessSettingsContext';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeModeToggle } from '../design-system/themes/ThemeModeToggle';
import { getVisibleModules } from '../design-system/components/dashboard/moduleRegistry';
import { Profile } from '../pages/Profile';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, logout, featureFlags } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showProfile, setShowProfile] = useState(false);

  // Get modules visible to this user for the sidebar
  const persona = user ? resolvePersona(user.role) : 'business';
  const permissions = user ? getPermissionsFromRole(user.role) : [];
  const baseModules = getVisibleModules(persona, permissions, featureFlags);

  // Get scheduling mode from shared context
  const { settings: businessSettings } = useBusinessSettings();

  // Annotate Schedule module title with enabled/disabled status
  const modules = baseModules.map((mod) => {
    if (mod.id === 'schedule') {
      const status = businessSettings.schedulingMode === 'schedule' ? 'Enabled' : 'Disabled';
      return { ...mod, titleKey: `Schedule (${status})`, descriptionKey: `Staff scheduling — ${status}` };
    }
    return mod;
  });

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
          {user && <button onClick={() => setShowProfile(true)} style={styles.gearIcon} title="Profile Settings">⚙️</button>}
          <button onClick={logout} style={styles.logoutBtn}>Sign Out</button>
        </div>
      </header>

      <div style={styles.body}>
        <nav style={{ ...styles.sidebar, ...(sidebarOpen ? {} : styles.sidebarCollapsed) }}>
          {sidebarOpen ? (
            <>
              <Link to="/dashboard" style={styles.navLink}>Dashboard</Link>
              {modules.map((mod) => (
                <Link key={mod.id} to={mod.path} style={styles.navLink}>{mod.titleKey}</Link>
              ))}
            </>
          ) : (
            <>
              <Link to="/dashboard" style={styles.navIcon} title="Dashboard">🏠</Link>
              {modules.map((mod) => (
                <Link key={mod.id} to={mod.path} style={styles.navIcon} title={mod.titleKey}>{mod.icon}</Link>
              ))}
            </>
          )}
        </nav>

        <main style={styles.content}>
          {children}
        </main>
      </div>

      {/* Profile Modal */}
      {showProfile && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Profile</h3>
              <button style={styles.closeBtn} onClick={() => setShowProfile(false)}>×</button>
            </div>
            <Profile />
          </div>
        </div>
      )}
    </div>
  );
}

function resolvePersona(role: string): 'system' | 'tenant' | 'business' | 'customer' {
  if (role === 'system_admin' || role === 'system_support' || role === 'Super Admin') return 'system';
  if (role === 'tenant_owner' || role === 'tenant_manager') return 'tenant';
  if (role === 'customer') return 'customer';
  return 'business';
}

function getPermissionsFromRole(role: string): string[] {
  switch (role) {
    case 'system_admin': case 'system_support': case 'Super Admin': return ['*:*'];
    case 'tenant_owner': return ['*:*'];
    case 'tenant_manager': return ['reports:read', 'settings:*'];
    case 'business_owner': return ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'];
    case 'business_manager': case 'manager': return ['services:read', 'bookings:*', 'staff:read', 'reports:read', 'customers:*'];
    case 'business_staff': return ['bookings:read', 'bookings:update', 'customers:read'];
    case 'customer': return ['bookings:read', 'bookings:create'];
    default: return ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'];
  }
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
    position: 'sticky' as const,
    top: 0,
    zIndex: 100,
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
  gearIcon: {
    textDecoration: 'none',
    fontSize: '16px',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
  },
  overlay: {
    position: 'fixed' as const,
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: 'var(--color-surface-modal, #FFFFFF)',
    borderRadius: '12px',
    padding: '24px',
    width: '100%',
    maxWidth: '500px',
    maxHeight: '80vh',
    overflow: 'auto' as const,
    border: '1px solid var(--color-border)',
    boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  modalTitle: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 600,
    color: 'var(--color-text)',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    color: 'var(--color-text-secondary)',
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
