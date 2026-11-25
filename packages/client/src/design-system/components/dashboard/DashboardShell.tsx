import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './DashboardShell.module.css';

interface DashboardShellProps {
  kpis: ReactNode;
  tiles: ReactNode;
}

/**
 * Dashboard shell — split layout with KPI cards on top and module tiles below.
 */
export function DashboardShell({ kpis, tiles }: DashboardShellProps) {
  const { t } = useTranslation('nav');
  return (
    <div className={styles.shell}>
      <section className={styles.kpiSection} aria-label={t('dashboard.key_metrics')}>
        {kpis}
      </section>
      <section className={styles.tilesSection} aria-label={t('dashboard.modules')}>
        {tiles}
      </section>
    </div>
  );
}
