import { useNavigate, useParams } from 'react-router-dom';
import { PlatformBillingActivity } from '../../components/PlatformBillingActivity';
import { SYSTEM_REPORT_CATALOG } from './systemReportCatalog';

/**
 * SystemReportRunner — detail view for a single system-level report, reached from
 * the SystemReports hub at /admin/system-reports/run/:reportId. Unlike the business
 * ReportRunner (which is a generic server-definition-driven table), platform reports
 * are bespoke components, so each report id maps to its own component here. Adding a
 * report is: add a catalog entry + register its component in REPORT_COMPONENTS.
 */
const REPORT_COMPONENTS: Record<string, () => JSX.Element> = {
  'billing-activity': PlatformBillingActivity,
};

export function SystemReportRunner() {
  const { reportId } = useParams<{ reportId: string }>();
  const navigate = useNavigate();

  const entry = SYSTEM_REPORT_CATALOG.flatMap((c) => c.reports).find((r) => r.id === reportId);
  const ReportComponent = reportId ? REPORT_COMPONENTS[reportId] : undefined;

  return (
    <div style={styles.page}>
      <button type="button" style={styles.back} onClick={() => navigate('/admin/system-reports')}>
        ← Back to Reports
      </button>

      {entry && ReportComponent ? (
        <>
          <h1 style={styles.pageTitle}>{entry.title}</h1>
          <p style={styles.pageSubtitle}>{entry.description}</p>
          <section style={styles.section}>
            <ReportComponent />
          </section>
        </>
      ) : (
        <>
          <h1 style={styles.pageTitle}>Report not found</h1>
          <p style={styles.pageSubtitle}>
            No report is registered for &ldquo;{reportId}&rdquo;.
          </p>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)' },
  back: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    marginBottom: 'var(--space-md)',
    padding: 0,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--font-size-sm)',
    fontFamily: 'var(--font-family)',
  },
  pageTitle: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', margin: 0 },
  pageSubtitle: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: '4px 0 var(--space-lg)' },
  section: { marginBottom: 'var(--space-xl)' },
};
