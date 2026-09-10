import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getPermissionsFromRole } from '../context/ContextManager';
import { REPORT_CATALOG, ReportCatalogEntry } from './reports/reportCatalog';

function matchPermission(userPerm: string, required: string): boolean {
  if (userPerm === '*:*') return true;
  if (userPerm === required) return true;
  const [ur, ua] = userPerm.split(':');
  const [rr] = required.split(':');
  return ur === rr && ua === '*';
}

export function Reports() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const permissions = getPermissionsFromRole(user?.role || '');

  function canView(entry: ReportCatalogEntry): boolean {
    const required = entry.permission || 'reports:read';
    return permissions.some((p) => matchPermission(p, required));
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.pageTitle}>Reports &amp; Analytics</h1>
      <p style={styles.pageSubtitle}>Run detailed reports over any date range, filter on screen, and save as PDF or CSV.</p>

      <div style={styles.categories}>
        {REPORT_CATALOG.map((category) => {
          const visibleReports = category.reports.filter(canView);
          if (visibleReports.length === 0) return null;

          return (
            <section
              key={category.id}
              style={{ ...styles.category, ['--group-accent' as any]: category.accentColor }}
            >
              <div style={styles.categoryHeader}>
                <span style={{ ...styles.accentBar, background: category.accentColor }} aria-hidden="true" />
                <h2 style={styles.categoryLabel}>{category.label}</h2>
              </div>
              <div style={styles.tileGrid}>
                {visibleReports.map((report) => (
                  <button
                    key={report.id}
                    type="button"
                    disabled={report.comingSoon}
                    aria-disabled={report.comingSoon}
                    style={{ ...styles.tile, ...(report.comingSoon ? styles.tileDisabled : {}) }}
                    onClick={report.comingSoon ? undefined : () => navigate(`/reports/run/${report.id}`)}
                  >
                    <span style={styles.tileIcon} aria-hidden="true">{report.icon}</span>
                    <span style={styles.tileTitle}>{report.title}</span>
                    <span style={styles.tileDescription}>{report.description}</span>
                    {report.comingSoon && <span style={styles.comingSoonBadge}>Coming soon</span>}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)' },
  pageTitle: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  pageSubtitle: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: '4px 0 var(--space-lg)' },
  categories: { display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' },
  category: {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderLeft: '4px solid var(--group-accent, var(--color-primary))',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-md)',
  },
  categoryHeader: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' },
  accentBar: { width: '10px', height: '10px', borderRadius: '3px', display: 'inline-block' },
  categoryLabel: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  tileGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--space-md)' },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    textAlign: 'left',
    padding: 'var(--space-md)',
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    fontFamily: 'var(--font-family)',
    transition: 'border-color var(--duration-fast) var(--ease-default)',
  },
  tileDisabled: {
    cursor: 'default',
    opacity: 0.55,
    background: 'var(--color-surface-hover)',
    borderStyle: 'dashed',
  },
  tileIcon: { fontSize: '24px' },
  tileTitle: { fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)' },
  tileDescription: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  comingSoonBadge: {
    marginTop: '6px',
    alignSelf: 'flex-start',
    fontSize: '10px',
    fontWeight: 'var(--font-weight-bold)' as any,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--color-text-secondary)',
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '2px 6px',
  },
};
