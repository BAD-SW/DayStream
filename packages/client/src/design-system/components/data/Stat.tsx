interface StatProps {
  label: string;
  value: string | number;
  trend?: {
    direction: 'up' | 'down' | 'flat';
    percentage: number;
  };
}

export function Stat({ label, value, trend }: StatProps) {
  return (
    <div style={styles.stat}>
      <span style={styles.label}>{label}</span>
      <span style={styles.value}>{value}</span>
      {trend && (
        <span style={{ ...styles.trend, color: trendColor(trend.direction) }}>
          {trend.direction === 'up' && '↑'}
          {trend.direction === 'down' && '↓'}
          {trend.direction === 'flat' && '→'}
          {' '}{trend.percentage}%
        </span>
      )}
    </div>
  );
}

function trendColor(dir: string): string {
  if (dir === 'up') return 'var(--color-success-light)';
  if (dir === 'down') return 'var(--color-error-light)';
  return 'var(--color-text-secondary)';
}

const styles: Record<string, React.CSSProperties> = {
  stat: { display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' },
  label: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wider)' },
  value: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-text)' },
  trend: { fontSize: 'var(--font-size-xs)' },
};
