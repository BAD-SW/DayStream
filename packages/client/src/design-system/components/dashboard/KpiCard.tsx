import styles from './KpiCard.module.css';

interface KpiCardProps {
  icon: string;
  label: string;
  value: string | number;
  trend?: {
    direction: 'up' | 'down' | 'flat';
    percentage: number;
    period: string;
  };
  prior?: string;
  color?: string;
  onClick?: () => void;
}

export function KpiCard({ icon, label, value, trend, prior, color, onClick }: KpiCardProps) {
  return (
    <div className={styles.card} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className={styles.iconWrapper} style={color ? { color } : undefined}>
        <span className={styles.icon}>{icon}</span>
      </div>
      <div className={styles.content}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{value}</span>
        {prior !== undefined && (
          <span className={styles.prior}>Prior year: {prior}</span>
        )}
        {trend && (
          <span className={`${styles.trend} ${styles[`trend-${trend.direction}`]}`}>
            {trend.direction === 'up' && '↑'}
            {trend.direction === 'down' && '↓'}
            {trend.direction === 'flat' && '→'}
            {' '}{trend.percentage}% {trend.period}
          </span>
        )}
        {onClick && <span className={styles.clickHint}>Click for details</span>}
      </div>
    </div>
  );
}
