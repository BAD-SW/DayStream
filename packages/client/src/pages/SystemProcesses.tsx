import { PlatformBillingScheduleCard } from '../components/PlatformBillingScheduleCard';

/**
 * SystemProcesses — platform-level scheduled jobs / processes for DayStream
 * (system persona). Separated from Configuration (which is settings only); this
 * page is for jobs. First process: the platform billing run schedule + run-now.
 * The tenant layer gets an equivalent Processes area when tenant billing is built.
 */
export function SystemProcesses() {
  return (
    <div>
      <h2 style={styles.heading}>Processes</h2>
      <p style={styles.subtext}>Scheduled jobs and background processes for the platform.</p>

      <section style={styles.section}>
        <PlatformBillingScheduleCard />
      </section>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: '0 0 var(--space-xs)' },
  subtext: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-lg)' },
  section: { marginBottom: 'var(--space-xl)' },
};
