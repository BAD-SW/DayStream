import { useState, useMemo, useCallback } from 'react';
import { filterBySubstring } from './utils';
import type { SavedQueryDTO } from '@daystream/shared';

export interface SavedQueriesPanelProps {
  queries: SavedQueryDTO[];
  loading?: boolean;
  error?: string;
  onSelect: (queryText: string) => void;
  onSave: (name: string, description: string, queryText: string) => void;
  onUpdate: (id: string, name: string, description: string) => void;
  onDelete: (id: string) => void;
}

/**
 * SavedQueriesPanel provides a list of saved queries with save/edit/delete
 * functionality, search, and error display.
 */
export function SavedQueriesPanel({
  queries,
  loading,
  error,
  onSelect,
  onSave,
  onUpdate,
  onDelete,
}: SavedQueriesPanelProps) {
  const [search, setSearch] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const filteredQueries = useMemo(
    () =>
      filterBySubstring(
        queries,
        search,
        (q) => `${q.name} ${q.description || ''}`
      ),
    [queries, search]
  );

  const handleSaveSubmit = useCallback(() => {
    if (!formName.trim()) return;
    onSave(formName.trim(), formDescription.trim(), '');
    setFormName('');
    setFormDescription('');
    setShowSaveForm(false);
  }, [formName, formDescription, onSave]);

  const handleEditSubmit = useCallback(() => {
    if (!editingId || !formName.trim()) return;
    onUpdate(editingId, formName.trim(), formDescription.trim());
    setEditingId(null);
    setFormName('');
    setFormDescription('');
  }, [editingId, formName, formDescription, onUpdate]);

  const startEdit = useCallback((query: SavedQueryDTO) => {
    setEditingId(query.id);
    setFormName(query.name);
    setFormDescription(query.description || '');
    setShowSaveForm(false);
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      onDelete(id);
      setDeleteConfirmId(null);
    },
    [onDelete]
  );

  const cancelForm = useCallback(() => {
    setShowSaveForm(false);
    setEditingId(null);
    setFormName('');
    setFormDescription('');
  }, []);

  // Error state
  if (error) {
    return (
      <div style={styles.container} data-testid="saved-queries-panel">
        <div style={styles.errorState}>
          <span style={styles.errorText}>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container} data-testid="saved-queries-panel">
      <div style={styles.header}>
        <span style={styles.title}>Saved Queries</span>
        <button
          style={styles.saveButton}
          onClick={() => {
            setShowSaveForm(true);
            setEditingId(null);
            setFormName('');
            setFormDescription('');
          }}
          title="Save current query"
        >
          Save
        </button>
      </div>

      {/* Search */}
      <div style={styles.searchWrapper}>
        <input
          type="text"
          placeholder="Search saved queries..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={styles.searchInput}
          data-testid="saved-queries-search"
        />
      </div>

      {/* Save/Edit form */}
      {(showSaveForm || editingId) && (
        <div style={styles.form}>
          <input
            type="text"
            placeholder="Name (required)"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            style={styles.formInput}
            maxLength={100}
            data-testid="save-form-name"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            style={styles.formInput}
            maxLength={500}
            data-testid="save-form-description"
          />
          <div style={styles.formActions}>
            <button
              style={styles.formSubmitButton}
              onClick={editingId ? handleEditSubmit : handleSaveSubmit}
              disabled={!formName.trim()}
            >
              {editingId ? 'Update' : 'Save'}
            </button>
            <button style={styles.formCancelButton} onClick={cancelForm}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && <div style={styles.loadingBar}>Loading...</div>}

      {/* Query list */}
      <div style={styles.listContainer}>
        {filteredQueries.length === 0 && !loading ? (
          <div style={styles.emptyState}>
            <span style={styles.emptyText}>
              {search ? 'No matching queries' : 'No saved queries'}
            </span>
          </div>
        ) : (
          filteredQueries.map((query) => (
            <div key={query.id} style={styles.entry} data-testid={`saved-query-${query.id}`}>
              {/* Delete confirmation */}
              {deleteConfirmId === query.id ? (
                <div style={styles.confirmDelete}>
                  <span style={styles.confirmText}>Delete "{query.name}"?</span>
                  <div style={styles.confirmActions}>
                    <button
                      style={styles.confirmYes}
                      onClick={() => handleDelete(query.id)}
                    >
                      Delete
                    </button>
                    <button
                      style={styles.confirmNo}
                      onClick={() => setDeleteConfirmId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    style={styles.entryContent}
                    onClick={() => onSelect(query.queryText)}
                    title={query.queryText}
                  >
                    <div style={styles.entryName}>{query.name}</div>
                    {query.description && (
                      <div style={styles.entryDescription}>
                        {query.description.length > 80
                          ? query.description.slice(0, 80) + '…'
                          : query.description}
                      </div>
                    )}
                    <div style={styles.entryDate}>
                      {formatDate(query.updatedAt)}
                    </div>
                  </div>
                  <div style={styles.entryActions}>
                    <button
                      style={styles.actionButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(query);
                      }}
                      title="Edit"
                    >
                      ✎
                    </button>
                    <button
                      style={styles.actionButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmId(query.id);
                      }}
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    border: '1px solid var(--color-border, #333)',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    borderBottom: '1px solid var(--color-border, #333)',
  },
  title: {
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--color-text, #fff)',
  },
  saveButton: {
    padding: '4px 10px',
    fontSize: '12px',
    color: 'var(--color-text, #fff)',
    backgroundColor: 'var(--color-primary, #C9A96E)',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
  },
  searchWrapper: {
    padding: '8px',
    borderBottom: '1px solid var(--color-border, #333)',
  },
  searchInput: {
    width: '100%',
    padding: '6px 8px',
    fontSize: '12px',
    border: '1px solid var(--color-border, #444)',
    borderRadius: '3px',
    backgroundColor: 'var(--color-surface, #1e1e1e)',
    color: 'var(--color-text, #e0e0e0)',
    outline: 'none',
    boxSizing: 'border-box',
  },
  form: {
    padding: '8px 12px',
    borderBottom: '1px solid var(--color-border, #333)',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  formInput: {
    padding: '6px 8px',
    fontSize: '12px',
    border: '1px solid var(--color-border, #444)',
    borderRadius: '3px',
    backgroundColor: 'var(--color-surface, #1e1e1e)',
    color: 'var(--color-text, #e0e0e0)',
    outline: 'none',
  },
  formActions: {
    display: 'flex',
    gap: '6px',
  },
  formSubmitButton: {
    padding: '5px 10px',
    fontSize: '12px',
    color: 'var(--color-text, #fff)',
    backgroundColor: 'var(--color-primary, #C9A96E)',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
  },
  formCancelButton: {
    padding: '5px 10px',
    fontSize: '12px',
    color: 'var(--color-text-secondary, #999)',
    backgroundColor: 'transparent',
    border: '1px solid var(--color-border, #444)',
    borderRadius: '3px',
    cursor: 'pointer',
  },
  loadingBar: {
    padding: '4px 12px',
    fontSize: '11px',
    color: 'var(--color-text-secondary, #999)',
    textAlign: 'center',
  },
  listContainer: {
    flex: 1,
    overflow: 'auto',
  },
  entry: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '10px 12px',
    borderBottom: '1px solid var(--color-border, #222)',
  },
  entryContent: {
    flex: 1,
    cursor: 'pointer',
    overflow: 'hidden',
  },
  entryName: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--color-text, #e0e0e0)',
    marginBottom: '2px',
  },
  entryDescription: {
    fontSize: '12px',
    color: 'var(--color-text-secondary, #999)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    marginBottom: '2px',
  },
  entryDate: {
    fontSize: '11px',
    color: 'var(--color-text-muted, #666)',
  },
  entryActions: {
    display: 'flex',
    gap: '4px',
    marginLeft: '8px',
    flexShrink: 0,
  },
  actionButton: {
    background: 'none',
    border: 'none',
    color: 'var(--color-text-secondary, #999)',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '2px 6px',
    borderRadius: '3px',
  },
  confirmDelete: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '100%',
  },
  confirmText: {
    fontSize: '12px',
    color: 'var(--color-error, #dc2626)',
  },
  confirmActions: {
    display: 'flex',
    gap: '6px',
  },
  confirmYes: {
    padding: '4px 10px',
    fontSize: '11px',
    color: '#fff',
    backgroundColor: 'var(--color-error, #dc2626)',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
  },
  confirmNo: {
    padding: '4px 10px',
    fontSize: '11px',
    color: 'var(--color-text-secondary, #999)',
    backgroundColor: 'transparent',
    border: '1px solid var(--color-border, #444)',
    borderRadius: '3px',
    cursor: 'pointer',
  },
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },
  emptyText: {
    fontSize: '13px',
    color: 'var(--color-text-secondary, #999)',
  },
  errorState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '24px',
  },
  errorText: {
    fontSize: '13px',
    color: 'var(--color-error, #dc2626)',
    textAlign: 'center',
  },
};
