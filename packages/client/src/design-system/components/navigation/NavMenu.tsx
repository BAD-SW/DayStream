import { useState } from 'react';
import { useLocation } from 'react-router-dom';

interface NavMenuItem {
  id: string;
  label: string;
  path?: string;
  icon?: string;
  children?: NavMenuItem[];
}

interface NavMenuProps {
  items: NavMenuItem[];
}

export function NavMenu({ items }: NavMenuProps) {
  const location = useLocation();

  return (
    <nav aria-label="Navigation menu" style={styles.nav}>
      {items.map((item) => (
        <NavMenuItemComponent key={item.id} item={item} currentPath={location.pathname} />
      ))}
    </nav>
  );
}

function NavMenuItemComponent({ item, currentPath }: { item: NavMenuItem; currentPath: string }) {
  const [expanded, setExpanded] = useState(false);
  const isActive = item.path === currentPath || currentPath.startsWith((item.path || '') + '/');
  const hasChildren = item.children && item.children.length > 0;

  return (
    <div>
      <a
        href={item.path || '#'}
        onClick={hasChildren ? (e) => { e.preventDefault(); setExpanded(!expanded); } : undefined}
        style={{ ...styles.link, ...(isActive ? styles.linkActive : {}) }}
        aria-current={isActive && !hasChildren ? 'page' : undefined}
        aria-expanded={hasChildren ? expanded : undefined}
      >
        {item.icon && <span style={styles.icon}>{item.icon}</span>}
        <span style={styles.label}>{item.label}</span>
        {hasChildren && <span style={styles.chevron}>{expanded ? '▾' : '▸'}</span>}
      </a>
      {hasChildren && expanded && (
        <div style={styles.children}>
          {item.children!.map((child) => (
            <NavMenuItemComponent key={child.id} item={child} currentPath={currentPath} />
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  nav: { display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' },
  link: {
    display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
    padding: 'var(--space-sm) var(--space-md)', borderRadius: 'var(--radius-md)',
    color: 'var(--color-text-secondary)', textDecoration: 'none',
    fontSize: 'var(--font-size-sm)', transition: 'background var(--duration-fast) var(--ease-default)',
  },
  linkActive: { background: 'var(--color-surface-hover)', color: 'var(--color-primary)', fontWeight: 600 },
  icon: { width: '20px', textAlign: 'center', fontSize: '14px' },
  label: { flex: 1 },
  chevron: { fontSize: '12px', color: 'var(--color-text-disabled)' },
  children: { paddingLeft: 'var(--space-lg)', marginTop: 'var(--space-xs)' },
};
