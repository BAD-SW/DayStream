import { ReactNode } from 'react';
import styles from './DashboardShell.module.css';

interface DashboardShellProps {
  kpis: ReactNode;
  tiles: ReactNode;
}

/**
 * Dashboard shell — split layout with KPI cards on top and module tiles below.
 */
export function DashboardShell({ kpis, tiles }: DashboardShellProps) {
  return (
    <div className={styles.shell}>
      <section className={styles.kpiSection} aria-label="Key metrics">
        {kpis}
      </section>
      <section className={styles.tilesSection} aria-label="Modules">
        {tiles}
      </section>
    </div>
  );
}
