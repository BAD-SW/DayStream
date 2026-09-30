import { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned actions (e.g. primary button). */
  actions?: ReactNode;
}

/** Page title row: large bold title, optional subtitle, actions on the right (THE-8). */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div style={styles.row}>
      <div style={styles.text}>
        <h1 style={styles.title}>{title}</h1>
        {subtitle && <p style={styles.subtitle}>{subtitle}</p>}
      </div>
      {actions && <div style={styles.actions}>{actions}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  row: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-md)', flexWrap: 'wrap', marginBottom: 'var(--space-lg)' },
  text: { minWidth: 0 },
  title: {
    margin: 0,
    fontSize: 'var(--page-title-size)',
    fontWeight: 'var(--page-title-weight)' as any,
    color: 'var(--color-text-title)',
    lineHeight: 'var(--line-height-tight)',
    letterSpacing: 'var(--letter-spacing-tight)',
  },
  subtitle: { margin: 'var(--space-xs) 0 0', fontSize: 'var(--page-subtitle-size)', color: 'var(--color-text-secondary)' },
  actions: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexShrink: 0 },
};
