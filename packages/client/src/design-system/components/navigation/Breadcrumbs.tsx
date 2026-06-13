import { useLocation } from 'react-router-dom';

interface BreadcrumbItem {
  label: string;
  path?: string;
}

interface BreadcrumbsProps {
  items?: BreadcrumbItem[];
  autoGenerate?: boolean;
}

export function Breadcrumbs({ items, autoGenerate = false }: BreadcrumbsProps) {
  const location = useLocation();

  const breadcrumbs = items || (autoGenerate ? generateFromPath(location.pathname) : []);

  if (breadcrumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" style={styles.nav}>
      <ol style={styles.list}>
        {breadcrumbs.map((item, index) => (
          <li key={index} style={styles.item}>
            {index > 0 && <span style={styles.separator}>/</span>}
            {item.path && index < breadcrumbs.length - 1 ? (
              <a href={item.path} style={styles.link}>{item.label}</a>
            ) : (
              <span style={styles.current} aria-current="page">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function generateFromPath(pathname: string): BreadcrumbItem[] {
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: BreadcrumbItem[] = [{ label: 'Home', path: '/' }];

  let currentPath = '';
  for (const segment of segments) {
    currentPath += `/${segment}`;
    const label = segment
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    crumbs.push({ label, path: currentPath });
  }

  return crumbs;
}

const styles: Record<string, React.CSSProperties> = {
  nav: {},
  list: { display: 'flex', alignItems: 'center', listStyle: 'none', margin: 0, padding: 0, gap: 'var(--space-xs)' },
  item: { display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' },
  separator: { color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-xs)' },
  link: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', textDecoration: 'none' },
  current: { color: 'var(--color-text)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any },
};
