import { useCallback, useState } from 'react';
import { downloadCsv, downloadJson } from './utils';

export interface ExportControlsProps {
  columns: { name: string; dataType: string }[];
  rows: Record<string, unknown>[];
  hasResults: boolean;
  rowCount: number;
}

const MAX_EXPORT_ROWS = 100_000;

/**
 * ExportControls provides CSV and JSON export buttons with validation
 * for result size limits.
 */
export function ExportControls({
  columns,
  rows,
  hasResults,
  rowCount,
}: ExportControlsProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const columnNames = columns.map((c) => c.name);

  const handleExportCsv = useCallback(() => {
    if (rowCount > MAX_EXPORT_ROWS) {
      setErrorMessage(
        `Cannot export: result set exceeds ${MAX_EXPORT_ROWS.toLocaleString()} rows`
      );
      return;
    }
    setErrorMessage(null);
    downloadCsv(columnNames, rows);
  }, [columnNames, rows, rowCount]);

  const handleExportJson = useCallback(() => {
    if (rowCount > MAX_EXPORT_ROWS) {
      setErrorMessage(
        `Cannot export: result set exceeds ${MAX_EXPORT_ROWS.toLocaleString()} rows`
      );
      return;
    }
    setErrorMessage(null);
    downloadJson(columnNames, rows);
  }, [columnNames, rows, rowCount]);

  return (
    <div style={styles.container} data-testid="export-controls">
      <button
        style={{
          ...styles.button,
          ...(hasResults ? {} : styles.disabledButton),
        }}
        onClick={handleExportCsv}
        disabled={!hasResults}
        title="Export results as CSV"
      >
        Export CSV
      </button>
      <button
        style={{
          ...styles.button,
          ...(hasResults ? {} : styles.disabledButton),
        }}
        onClick={handleExportJson}
        disabled={!hasResults}
        title="Export results as JSON"
      >
        Export JSON
      </button>
      {errorMessage && (
        <span style={styles.errorMessage} data-testid="export-error">
          {errorMessage}
        </span>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  button: {
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--color-text, #fff)',
    backgroundColor: 'var(--color-surface-elevated, #2a2a2a)',
    border: '1px solid var(--color-border, #444)',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  disabledButton: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  errorMessage: {
    fontSize: '12px',
    color: 'var(--color-error, #dc2626)',
  },
};
