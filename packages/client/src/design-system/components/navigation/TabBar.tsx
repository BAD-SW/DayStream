import { Fragment, KeyboardEvent, useRef } from 'react';

interface TabBarItem<T extends string> {
  key: T;
  label: string;
  /** The section behind this tab has unsaved changes: the tab is marked. */
  changed?: boolean;
  /** Draws a separator before this tab, to set a group of tabs apart. */
  separatorBefore?: boolean;
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
          <Fragment key={tab.key}>
          {tab.separatorBefore && <span aria-hidden="true" style={styles.separator} />}
          <button
            ref={(el) => { refs.current[index] = el; }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            style={{ ...styles.tab, ...(isActive ? styles.tabActive : {}), ...(tab.changed ? styles.tabChanged : {}) }}
          >
            {tab.label}
            {tab.changed && <span aria-label="unsaved changes" title="Unsaved changes" style={styles.changedDot} />}
          </button>
          </Fragment>
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
  tabChanged: { background: 'var(--color-warning-bg)', borderTopLeftRadius: 'var(--radius-md)', borderTopRightRadius: 'var(--radius-md)' },
  separator: { alignSelf: 'stretch', width: '1px', margin: '6px 4px', background: 'var(--color-border-strong, var(--color-text-muted))' },
  changedDot: { display: 'inline-block', width: '8px', height: '8px', marginLeft: '6px', borderRadius: '50%', background: 'var(--color-warning)', verticalAlign: 'middle' },
  tabActive: {
    color: 'var(--color-primary)',
    // Full shorthand, not borderBottomColor: React drops a removed longhand, which would
    // leave a previously active tab with a default-coloured (black) underline.
    borderBottom: '3px solid var(--color-primary)',
    fontWeight: 'var(--tab-active-font-weight)' as any,
  },
};
