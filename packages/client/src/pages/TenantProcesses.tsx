import { TenantBillingScheduleCard } from '../components/TenantBillingScheduleCard';

/**
 * TenantProcesses — tenant-level scheduled jobs / processes (tenant persona).
 * Mirror of the system Processes page one level down. Separated from Settings
 * (which is configuration only); this page is for jobs. First process: the
 * tenant's business billing run schedule + run-now.
 */
export function TenantProcesses() {
  return (
    <div>
      <h2 style={styles.heading}>Processes</h2>
      <p style={styles.subtext}>Scheduled jobs and background processes for your businesses.</p>

      <section style={styles.section}>
        <TenantBillingScheduleCard />
      </section>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: '0 0 var(--space-xs)' },
  subtext: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-lg)' },
  section: { marginBottom: 'var(--space-xl)' },
};
