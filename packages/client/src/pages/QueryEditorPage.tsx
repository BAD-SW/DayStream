import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../api/client';
import {
  CodeEditor,
  EditorTabs,
  loadPersistedTabs,
  ResultsPanel,
  SchemaPanel,
  HistoryPanel,
  SavedQueriesPanel,
  ExportControls,
} from '../components/query-editor';
import type { EditorTab } from '../components/query-editor';
import type {
  SchemaTable,
  QueryHistoryDTO,
  SavedQueryDTO,
  QueryExecuteResponse,
} from '@daystream/shared';

type SidebarTab = 'schema' | 'history' | 'saved';

function createDefaultTab(): EditorTab {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `tab-${Date.now()}`,
    title: 'Query 1',
    content: '',
  };
}

/**
 * QueryEditorPage orchestrates the full Query Editor layout:
 * - Left (70%): Editor tabs + CodeMirror editor (top), Results panel (bottom)
 * - Right (30%): Sidebar with Schema, History, and Saved queries (tabbed)
 */
export function QueryEditorPage() {
  // --- Tab state ---
  const [tabs, setTabs] = useState<EditorTab[]>(() => {
    return loadPersistedTabs() || [createDefaultTab()];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0]?.id || '');

  // --- Query execution state ---
  const [results, setResults] = useState<QueryExecuteResponse | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);

  // --- Schema state ---
  const [schema, setSchema] = useState<SchemaTable[]>([]);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  // --- History state ---
  const [history, setHistory] = useState<QueryHistoryDTO[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // --- Saved queries state ---
  const [savedQueries, setSavedQueries] = useState<SavedQueryDTO[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);

  // --- Sidebar tab state ---
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>('schema');

  // --- Refs for cancellation ---
  const abortControllerRef = useRef<AbortController | null>(null);

  // --- Active tab content ---
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeContent = activeTab?.content || '';

  // --- Fetch schema on mount ---
  const fetchSchema = useCallback(async () => {
    setSchemaLoading(true);
    setSchemaError(null);
    try {
      const res = await apiClient.get('/v1/query-editor/schema');
      const responseData = res.data.data || res.data;
      setSchema(responseData.tables || responseData || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load schema';
      setSchemaError(message);
    } finally {
      setSchemaLoading(false);
    }
  }, []);

  // --- Fetch history on mount ---
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await apiClient.get('/v1/query-editor/history');
      const responseData = res.data.data || res.data;
      setHistory(responseData.entries || responseData || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Query history is temporarily unavailable';
      setHistoryError(message);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // --- Fetch saved queries on mount ---
  const fetchSaved = useCallback(async () => {
    setSavedLoading(true);
    setSavedError(null);
    try {
      const res = await apiClient.get('/v1/query-editor/saved');
      const responseData = res.data.data || res.data;
      setSavedQueries(responseData.queries || responseData || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load saved queries';
      setSavedError(message);
    } finally {
      setSavedLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSchema();
    fetchHistory();
    fetchSaved();
  }, [fetchSchema, fetchHistory, fetchSaved]);

  // --- Tab handlers ---
  const handleTabChange = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  const handleTabClose = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId && next.length > 0) {
          setActiveTabId(next[0].id);
        }
        return next;
      });
    },
    [activeTabId]
  );

  const handleTabAdd = useCallback(() => {
    const newTab: EditorTab = {
      id: crypto.randomUUID ? crypto.randomUUID() : `tab-${Date.now()}`,
      title: `Query ${tabs.length + 1}`,
      content: '',
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [tabs.length]);

  // --- Editor content change ---
  const handleEditorChange = useCallback(
    (value: string) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, content: value } : t))
      );
    },
    [activeTabId]
  );

  // --- Execute query ---
  const handleExecute = useCallback(async () => {
    if (!activeContent.trim() || isExecuting) return;

    setIsExecuting(true);
    setExecuteError(null);
    setResults(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await apiClient.post(
        '/v1/query-editor/execute',
        { sql: activeContent },
        { signal: controller.signal }
      );
      const data: QueryExecuteResponse = res.data.data || res.data;
      setResults(data);
      if (data.status === 'error' && data.error) {
        setExecuteError(data.error);
      }
      // Refresh history after execution
      fetchHistory();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'CanceledError') {
        // User cancelled — don't show error
        return;
      }
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      const message =
        axiosErr?.response?.data?.error?.message ||
        (err instanceof Error ? err.message : 'Query execution failed');
      setExecuteError(message);
    } finally {
      setIsExecuting(false);
      abortControllerRef.current = null;
    }
  }, [activeContent, isExecuting, fetchHistory]);

  // --- Cancel query ---
  const handleCancel = useCallback(async () => {
    // Abort the HTTP request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // Also notify the server
    try {
      await apiClient.post('/v1/query-editor/cancel');
    } catch {
      // Best-effort cancel
    }
    setIsExecuting(false);
  }, []);

  // --- Schema insert handler ---
  const handleSchemaInsert = useCallback(
    (identifier: string) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id === activeTabId) {
            // Append at end (cursor position would need CodeMirror integration)
            const newContent = t.content
              ? `${t.content} ${identifier}`
              : identifier;
            return { ...t, content: newContent };
          }
          return t;
        })
      );
    },
    [activeTabId]
  );

  // --- History select handler ---
  const handleHistorySelect = useCallback(
    (queryText: string) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, content: queryText } : t))
      );
    },
    [activeTabId]
  );

  // --- Saved queries handlers ---
  const handleSavedSelect = useCallback(
    (queryText: string) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, content: queryText } : t))
      );
    },
    [activeTabId]
  );

  const handleSaveQuery = useCallback(
    async (name: string, description: string, _queryText: string) => {
      try {
        await apiClient.post('/v1/query-editor/saved', {
          name,
          description: description || undefined,
          queryText: activeContent,
        });
        fetchSaved();
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
        const message =
          axiosErr?.response?.data?.error?.message || 'Failed to save query';
        setSavedError(message);
      }
    },
    [activeContent, fetchSaved]
  );

  const handleUpdateSaved = useCallback(
    async (id: string, name: string, description: string) => {
      try {
        await apiClient.put(`/v1/query-editor/saved/${id}`, {
          name,
          description: description || undefined,
        });
        fetchSaved();
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
        const message =
          axiosErr?.response?.data?.error?.message || 'Failed to update query';
        setSavedError(message);
      }
    },
    [fetchSaved]
  );

  const handleDeleteSaved = useCallback(
    async (id: string) => {
      try {
        await apiClient.delete(`/v1/query-editor/saved/${id}`);
        fetchSaved();
      } catch {
        setSavedError('Failed to delete query');
      }
    },
    [fetchSaved]
  );

  // --- Derived values for results ---
  const hasResults = results !== null && results.columns.length > 0;

  return (
    <div style={styles.page}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <div style={styles.toolbarLeft}>
          <button
            style={{
              ...styles.executeButton,
              ...(isExecuting || !activeContent.trim() ? styles.disabledButton : {}),
            }}
            onClick={handleExecute}
            disabled={isExecuting || !activeContent.trim()}
          >
            ▶ Execute
          </button>
          {isExecuting && (
            <button style={styles.cancelButton} onClick={handleCancel}>
              ✕ Cancel
            </button>
          )}
        </div>
        <div style={styles.toolbarRight}>
          <ExportControls
            columns={results?.columns || []}
            rows={results?.rows || []}
            hasResults={hasResults}
            rowCount={results?.rowCount || 0}
          />
        </div>
      </div>

      {/* Main content area */}
      <div style={styles.mainContent}>
        {/* Left panel (70%) */}
        <div style={styles.leftPanel}>
          {/* Editor area (top) */}
          <div style={styles.editorArea}>
            <EditorTabs
              tabs={tabs}
              activeTabId={activeTabId}
              onTabChange={handleTabChange}
              onTabClose={handleTabClose}
              onTabAdd={handleTabAdd}
            />
            <div style={styles.codeEditorWrapper}>
              <CodeEditor
                value={activeContent}
                onChange={handleEditorChange}
                onExecute={handleExecute}
                schema={schema}
                disabled={isExecuting}
              />
            </div>
          </div>

          {/* Results area (bottom) */}
          <div style={styles.resultsArea}>
            <ResultsPanel
              columns={results?.columns || []}
              rows={results?.rows || []}
              executionTimeMs={results?.executionTimeMs}
              rowCount={results?.rowCount}
              truncated={results?.truncated}
              maxRows={10000}
              error={executeError || undefined}
              loading={isExecuting}
            />
          </div>
        </div>

        {/* Right panel (30%) — Sidebar */}
        <div style={styles.rightPanel}>
          {/* Sidebar tabs */}
          <div style={styles.sidebarTabs}>
            <button
              style={{
                ...styles.sidebarTabButton,
                ...(activeSidebarTab === 'schema' ? styles.activeSidebarTab : {}),
              }}
              onClick={() => setActiveSidebarTab('schema')}
            >
              Schema
            </button>
            <button
              style={{
                ...styles.sidebarTabButton,
                ...(activeSidebarTab === 'history' ? styles.activeSidebarTab : {}),
              }}
              onClick={() => setActiveSidebarTab('history')}
            >
              History
            </button>
            <button
              style={{
                ...styles.sidebarTabButton,
                ...(activeSidebarTab === 'saved' ? styles.activeSidebarTab : {}),
              }}
              onClick={() => setActiveSidebarTab('saved')}
            >
              Saved
            </button>
          </div>

          {/* Sidebar content */}
          <div style={styles.sidebarContent}>
            {activeSidebarTab === 'schema' && (
              <SchemaPanel
                tables={schema}
                loading={schemaLoading}
                error={schemaError || undefined}
                onRefresh={fetchSchema}
                onInsert={handleSchemaInsert}
              />
            )}
            {activeSidebarTab === 'history' && (
              <HistoryPanel
                entries={history}
                loading={historyLoading}
                error={historyError || undefined}
                onSelect={handleHistorySelect}
                onRetry={fetchHistory}
              />
            )}
            {activeSidebarTab === 'saved' && (
              <SavedQueriesPanel
                queries={savedQueries}
                loading={savedLoading}
                error={savedError || undefined}
                onSelect={handleSavedSelect}
                onSave={handleSaveQuery}
                onUpdate={handleUpdateSaved}
                onDelete={handleDeleteSaved}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: 'calc(100vh - 56px)',
    overflow: 'hidden',
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 16px',
    borderBottom: '1px solid var(--color-border, #333)',
    backgroundColor: 'var(--color-surface-elevated, #2a2a2a)',
    flexShrink: 0,
  },
  toolbarLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  toolbarRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  executeButton: {
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#fff',
    backgroundColor: 'var(--color-primary, #C9A96E)',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  cancelButton: {
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--color-error, #dc2626)',
    backgroundColor: 'transparent',
    border: '1px solid var(--color-error, #dc2626)',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  disabledButton: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  mainContent: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  leftPanel: {
    display: 'flex',
    flexDirection: 'column',
    width: '70%',
    borderRight: '1px solid var(--color-border, #333)',
    overflow: 'hidden',
  },
  editorArea: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: '200px',
    overflow: 'hidden',
  },
  codeEditorWrapper: {
    flex: 1,
    overflow: 'hidden',
  },
  resultsArea: {
    height: '40%',
    minHeight: '150px',
    borderTop: '1px solid var(--color-border, #333)',
    overflow: 'hidden',
  },
  rightPanel: {
    display: 'flex',
    flexDirection: 'column',
    width: '30%',
    overflow: 'hidden',
  },
  sidebarTabs: {
    display: 'flex',
    borderBottom: '1px solid var(--color-border, #333)',
    flexShrink: 0,
  },
  sidebarTabButton: {
    flex: 1,
    padding: '8px 12px',
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--color-text-secondary, #999)',
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    cursor: 'pointer',
  },
  activeSidebarTab: {
    color: 'var(--color-text, #fff)',
    borderBottomColor: 'var(--color-primary, #C9A96E)',
  },
  sidebarContent: {
    flex: 1,
    overflow: 'hidden',
  },
};
