import { ReactNode, useState } from 'react';
import { useIsMobile } from '../../hooks/useMediaQuery';

interface PageShellProps {
  children: ReactNode;
  sidebar?: ReactNode;
  header?: ReactNode;
}

/**
 * Top-level layout shell — header, optional sidebar, content area.
 * Desktop: sidebar can collapse to icon-only mode.
 * Mobile: sidebar hidden by default, shown as overlay via FAB.
 */
export function PageShell({ children, sidebar, header }: PageShellProps) {
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={styles.shell}>
      {header}

      <div style={styles.body}>
        {sidebar && !isMobile && (
          <aside style={{ ...styles.sidebar, ...(collapsed ? styles.sidebarCollapsed : {}) }}>
            <button
              onClick={() => setCollapsed(!collapsed)}
              style={styles.collapseBtn}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? '→' : '←'}
            </button>
            {!collapsed && sidebar}
            {collapsed && <div style={styles.collapsedPlaceholder} aria-hidden="true" />}
          </aside>
        )}

        {sidebar && isMobile && mobileMenuOpen && (
          <>
            <div style={styles.overlay} onClick={() => setMobileMenuOpen(false)} />
            <aside style={styles.mobileSidebar}>{sidebar}</aside>
          </>
        )}

        <main style={styles.main}>{children}</main>
      </div>

      {sidebar && isMobile && (
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          style={styles.fab}
          aria-label="Toggle menu"
        >
          ☰
        </button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: { display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--color-background)', color: 'var(--color-text)' },
  body: { display: 'flex', flex: 1 },
  sidebar: { width: '240px', borderRight: '1px solid var(--color-border)', flexShrink: 0, position: 'relative', transition: 'width 0.2s ease' },
  sidebarCollapsed: { width: '56px' },
  collapseBtn: { position: 'absolute', top: '12px', right: '-12px', width: '24px', height: '24px', borderRadius: '50%', background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  collapsedPlaceholder: { height: '100%' },
  mobileSidebar: { position: 'fixed', top: 0, left: 0, width: '280px', height: '100vh', background: 'var(--color-surface)', zIndex: 300, overflowY: 'auto', padding: 'var(--space-lg)' },
  overlay: { position: 'fixed', inset: 0, background: 'var(--color-overlay)', zIndex: 299 },
  main: { flex: 1, overflowX: 'hidden' },
  fab: { position: 'fixed', bottom: 'var(--space-lg)', left: 'var(--space-lg)', width: '48px', height: '48px', borderRadius: 'var(--radius-full)', background: 'var(--color-primary)', color: 'var(--color-primary-contrast)', border: 'none', fontSize: '20px', cursor: 'pointer', zIndex: 250, boxShadow: 'var(--shadow-lg)' },
};
