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
  color?: string;
}

export function KpiCard({ icon, label, value, trend, color }: KpiCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.iconWrapper} style={color ? { color } : undefined}>
        <span className={styles.icon}>{icon}</span>
      </div>
      <div className={styles.content}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{value}</span>
        {trend && (
          <span className={`${styles.trend} ${styles[`trend-${trend.direction}`]}`}>
            {trend.direction === 'up' && '↑'}
            {trend.direction === 'down' && '↓'}
            {trend.direction === 'flat' && '→'}
            {' '}{trend.percentage}% {trend.period}
          </span>
        )}
      </div>
    </div>
  );
}
