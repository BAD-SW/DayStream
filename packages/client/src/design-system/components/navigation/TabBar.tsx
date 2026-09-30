import { KeyboardEvent, useRef } from 'react';

interface TabBarItem<T extends string> {
  key: T;
  label: string;
}

interface TabBarProps<T extends string> {
  tabs: TabBarItem<T>[];
  active: T;
  onChange: (key: T) => void;
  'aria-label'?: string;
}

/**
 * Controlled tab row without panels (THE-9) — for pages that render the active section
 * themselves. Same look as <Tabs>, driven by the --tab-* tokens.
 */
export function TabBar<T extends string>({ tabs, active, onChange, 'aria-label': ariaLabel }: TabBarProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(e: KeyboardEvent, index: number) {
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[next].key);
    refs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label={ariaLabel} style={styles.list}>
      {tabs.map((tab, index) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            ref={(el) => { refs.current[index] = el; }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            style={{ ...styles.tab, ...(isActive ? styles.tabActive : {}) }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  list: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--tabs-gap)',
    borderBottom: '1px solid var(--color-border)',
    marginBottom: 'var(--space-lg)',
  },
  tab: {
    background: 'none',
    border: 'none',
    borderBottom: '3px solid transparent',
    marginBottom: '-1px',
    padding: 'var(--tab-padding)',
    fontFamily: 'var(--font-family)',
    fontSize: 'var(--tab-font-size)',
    fontWeight: 'var(--tab-font-weight)' as any,
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
  },
  tabActive: {
    color: 'var(--color-primary)',
    // Full shorthand, not borderBottomColor: React drops a removed longhand, which would
    // leave a previously active tab with a default-coloured (black) underline.
    borderBottom: '3px solid var(--color-primary)',
    fontWeight: 'var(--tab-active-font-weight)' as any,
  },
};
