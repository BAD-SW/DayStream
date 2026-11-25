import { useTranslation } from 'react-i18next';
import styles from './KpiCard.module.css';

interface KpiCardProps {
  icon: string;
  label: string;
  value: string | number;
  subValue?: string;
  trend?: {
    direction: 'up' | 'down' | 'flat';
    percentage: number;
    period: string;
  };
  prior?: string;
  color?: string;
  onClick?: () => void;
}

export function KpiCard({ icon, label, value, subValue, trend, prior, color, onClick }: KpiCardProps) {
  const { t } = useTranslation('nav');
  return (
    <div className={styles.card} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className={styles.iconWrapper} style={color ? { color } : undefined}>
        <span className={styles.icon}>{icon}</span>
      </div>
      <div className={styles.content}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{value}</span>
        {subValue && <span className={styles.subValue}>{subValue}</span>}
        {prior !== undefined && (
          <span className={styles.prior}>{t('dashboard.prior_year', { value: prior })}</span>
        )}
        {trend && (
          <span className={`${styles.trend} ${styles[`trend-${trend.direction}`]}`}>
            {trend.direction === 'up' && '↑'}
            {trend.direction === 'down' && '↓'}
            {trend.direction === 'flat' && '→'}
            {' '}{trend.percentage}% {trend.period}
          </span>
        )}
        {onClick && <span className={styles.clickHint}>{t('dashboard.click_for_details')}</span>}
      </div>
    </div>
  );
}
