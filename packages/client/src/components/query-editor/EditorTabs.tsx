import { useEffect, useCallback } from 'react';

export interface EditorTab {
  id: string;
  title: string;
  content: string;
}

export interface EditorTabsProps {
  tabs: EditorTab[];
  activeTabId: string;
  onTabChange: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabAdd: () => void;
}

const STORAGE_KEY = 'query-editor-tabs';
const MAX_TABS = 10;

/**
 * EditorTabs manages up to 10 independent query tabs with sessionStorage persistence.
 */
export function EditorTabs({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
  onTabAdd,
}: EditorTabsProps) {
  // Persist tabs to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
    } catch {
      // Silently fail if storage is unavailable
    }
  }, [tabs]);

  const handleClose = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.stopPropagation();
      // Cannot close the last remaining tab
      if (tabs.length <= 1) return;
      onTabClose(tabId);
    },
    [tabs.length, onTabClose]
  );

  const canAddTab = tabs.length < MAX_TABS;

  return (
    <div style={styles.container} data-testid="editor-tabs">
      <div style={styles.tabList} role="tablist">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTabId}
            style={{
              ...styles.tab,
              ...(tab.id === activeTabId ? styles.activeTab : {}),
            }}
            onClick={() => onTabChange(tab.id)}
            data-testid={`tab-${tab.id}`}
          >
            <span style={styles.tabTitle}>{tab.title}</span>
            {tabs.length > 1 && (
              <button
                style={styles.closeButton}
                onClick={(e) => handleClose(e, tab.id)}
                aria-label={`Close ${tab.title}`}
                title="Close tab"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {canAddTab && (
          <button
            style={styles.addButton}
            onClick={onTabAdd}
            aria-label="Add new tab"
            title="New query tab"
            data-testid="add-tab-button"
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Loads persisted tabs from sessionStorage, or returns null if not available.
 */
export function loadPersistedTabs(): EditorTab[] | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    borderBottom: '1px solid var(--color-border, #333)',
  },
  tabList: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    padding: '4px 8px 0',
    overflowX: 'auto',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    borderRadius: '4px 4px 0 0',
    cursor: 'pointer',
    fontSize: '13px',
    color: 'var(--color-text-secondary, #999)',
    backgroundColor: 'transparent',
    border: '1px solid transparent',
    borderBottom: 'none',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  },
  activeTab: {
    color: 'var(--color-text, #fff)',
    backgroundColor: 'var(--color-surface, #1e1e1e)',
    borderColor: 'var(--color-border, #333)',
  },
  tabTitle: {
    maxWidth: '120px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: '16px',
    lineHeight: 1,
    padding: '0 2px',
    opacity: 0.6,
  },
  addButton: {
    background: 'none',
    border: 'none',
    color: 'var(--color-text-secondary, #999)',
    cursor: 'pointer',
    fontSize: '18px',
    lineHeight: 1,
    padding: '4px 8px',
  },
};
