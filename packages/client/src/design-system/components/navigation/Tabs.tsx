import { useState, ReactNode, useRef, KeyboardEvent } from 'react';

interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

interface TabsProps {
  items: TabItem[];
  defaultTab?: string;
  orientation?: 'horizontal' | 'vertical';
}

export function Tabs({ items, defaultTab, orientation = 'horizontal' }: TabsProps) {
  const [active, setActive] = useState(defaultTab || items[0]?.id);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(e: KeyboardEvent, index: number) {
    const isVertical = orientation === 'vertical';
    const prevKey = isVertical ? 'ArrowUp' : 'ArrowLeft';
    const nextKey = isVertical ? 'ArrowDown' : 'ArrowRight';

    let newIndex = index;
    if (e.key === nextKey) {
      newIndex = (index + 1) % items.length;
    } else if (e.key === prevKey) {
      newIndex = (index - 1 + items.length) % items.length;
    } else if (e.key === 'Home') {
      newIndex = 0;
    } else if (e.key === 'End') {
      newIndex = items.length - 1;
    } else {
      return;
    }

    e.preventDefault();
    setActive(items[newIndex].id);
    tabRefs.current[newIndex]?.focus();
  }

  const isVertical = orientation === 'vertical';

  return (
    <div style={isVertical ? styles.containerVertical : undefined}>
      <div role="tablist" aria-orientation={orientation} style={isVertical ? styles.tabListVertical : styles.tabList}>
        {items.map((item, index) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              ref={(el) => { tabRefs.current[index] = el; }}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${item.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(item.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              style={{
                background: 'none', border: 'none', outline: 'none',
                borderBottom: isVertical ? 'none' : (isActive ? '3px solid var(--color-primary)' : '3px solid transparent'),
                borderLeft: isVertical ? (isActive ? '3px solid var(--color-primary)' : '3px solid transparent') : 'none',
                padding: isVertical ? 'var(--space-sm) var(--space-md)' : 'var(--space-sm) var(--space-md)',
                paddingLeft: isVertical ? 'var(--space-md)' : undefined,
                fontSize: 'var(--font-size-sm)',
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                cursor: 'pointer',
                fontFamily: 'var(--font-family)',
                fontWeight: isActive ? 600 : 500,
                textAlign: 'left' as const,
                marginBottom: isVertical ? undefined : '-1px',
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div style={isVertical ? styles.panelVertical : undefined}>
        {items.map((item) => (
          <div
            key={item.id}
            id={`tabpanel-${item.id}`}
            role="tabpanel"
            hidden={active !== item.id}
            style={styles.panel}
          >
            {item.content}
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  tabList: { display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--space-md)', justifyContent: 'space-evenly', width: '80%' },
  tabListVertical: { display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', borderRight: '1px solid var(--color-border)', paddingRight: 'var(--space-md)', minWidth: '150px' },
  containerVertical: { display: 'flex', gap: 'var(--space-md)' },
  tab: {
    background: 'none', border: 'none', borderBottom: '2px solid transparent',
    padding: 'var(--space-sm) var(--space-md)', fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)',
    fontWeight: 'var(--font-weight-medium)' as any, textAlign: 'left' as const,
  },
  tabActive: { color: 'var(--color-primary)', borderBottomColor: 'var(--color-primary)' },
  tabVertical: { borderBottom: 'none', borderLeft: '2px solid transparent', paddingLeft: 'var(--space-md)' },
  tabActiveVertical: { borderLeftColor: 'var(--color-primary)', borderBottomColor: 'transparent' },
  panel: { padding: 'var(--space-sm) 0' },
  panelVertical: { flex: 1 },
};
