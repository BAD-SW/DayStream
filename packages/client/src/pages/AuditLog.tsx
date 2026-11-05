import { useState, useEffect, useCallback } from 'react';
import { Table } from '../design-system/components/data/Table';
import type { TableFilters } from '../design-system/components/data/Table';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { apiClient } from '../api/client';

interface AuditEntry {
  id: string;
  tenant_id: string;
  user_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: any;
  created_at: string;
  user_email?: string;
  user_first_name?: string;
  user_last_name?: string;
  tenant_name?: string;
}

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 25;

  // Filters
  // Column filters from the icon beside each sort icon (David, 2026-11-02).
  const [tableFilters, setTableFilters] = useState<TableFilters>({});
  const [loadingMore, setLoadingMore] = useState(false);

  // Detail modal
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);

  const listParams = (p: number, size: number) => {
    const params: Record<string, any> = { page: p, limit: size };
    if (Object.keys(tableFilters).length) params.cf = JSON.stringify(tableFilters);
    return params;
  };
  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/v1/admin/audit-log', { params: listParams(1, limit) });
      setEntries(res.data.data || []);
      setPage(1);
      setTotal(res.data.meta?.total || 0);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [tableFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // No pages: more entries load as the list scrolls.
  const loadMore = useCallback(async () => {
    if (loadingMore || entries.length >= total) return;
    setLoadingMore(true);
    try {
      const res = await apiClient.get('/v1/admin/audit-log', { params: listParams(page + 1, limit) });
      setEntries((rows) => [...rows, ...(res.data.data || [])]);
      setPage(page + 1);
      setTotal(res.data.meta?.total || 0);
    } catch { /* Show more stays to try again */ }
    finally { setLoadingMore(false); }
  }, [tableFilters, page, loadingMore, entries.length, total]); // eslint-disable-line react-hooks/exhaustive-deps

  const filterOptions = useCallback(async (key: string) => {
    const params: Record<string, any> = { column: key };
    if (Object.keys(tableFilters).length) params.cf = JSON.stringify(tableFilters);
    const res = await apiClient.get('/v1/admin/audit-log/column-values', { params });
    return (res.data.data as Array<{ value: string; label: string; count: number }>).map((v) => ({
      value: v.value, count: v.count, label: v.label || v.value,
    }));
  }, [tableFilters]);

  const handleExportCSV = async () => {
    try {
      const res = await apiClient.get('/v1/admin/audit-log', { params: listParams(1, 10000) });
      const data = res.data.data || [];
      const headers = ['Date/Time', 'Action', 'Resource Type', 'Resource ID', 'User ID', 'Details'];
      const rows = data.map((e: AuditEntry) => [
        new Date(e.created_at).toISOString(),
        e.action, e.resource_type || '', e.resource_id || '',
        e.user_id || '', JSON.stringify(e.details || {}),
      ]);
      const csv = [headers.join(','), ...rows.map((r: string[]) => r.map(c => `"${c}"`).join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } catch { alert('Export failed'); }
  };

  const columns = [
    {
      key: 'created_at', header: 'Date/Time', sortable: true,
      render: (val: string) => <span style={{ whiteSpace: 'nowrap' }}>{new Date(val).toLocaleString()}</span>,
    },
    {
      key: 'action', header: 'Action', sortable: true,
      render: (val: string) => <Badge variant="info">{val}</Badge>,
    },
    {
      key: 'resource_type', header: 'Resource', sortable: true,
      render: (val: string) => val || '—',
    },
    {
      key: 'user_email', header: 'User', sortable: true,
      render: (val: string, row: AuditEntry) => val || (row.user_first_name ? `${row.user_first_name} ${row.user_last_name}` : '—'),
    },
    {
      key: 'tenant_name', header: 'Tenant', sortable: true,
      render: (val: string) => val || '—',
    },
    {
      key: 'id', header: '', sortable: false, filter: false as const,
      render: (_val: string, row: AuditEntry) => (
        <Button variant="ghost" size="sm" onClick={() => setSelectedEntry(row)}>Details</Button>
      ),
    },
  ];

  return (
    <div>
      <div style={styles.header}>
        <div>
          <h2 style={styles.heading}>Audit Log</h2>
          <p style={styles.subtext}>Track all actions performed in the system.</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExportCSV}>Export CSV</Button>
      </div>

      <Table
        columns={columns}
        data={entries}
        loading={loading}
        emptyMessage="No audit entries found."
        clientSort
        filters={tableFilters}
        onFiltersChange={setTableFilters}
        filterOptions={filterOptions}
        onLoadMore={loadMore}
        hasMore={entries.length < total}
        loadingMore={loadingMore}
      />

      {/* Detail Modal */}
      {selectedEntry && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Audit Log Detail</h3>
              <button style={styles.closeBtn} onClick={() => setSelectedEntry(null)}>&times;</button>
            </div>
            <div style={styles.detailBody}>
              <DetailRow label="Date/Time" value={new Date(selectedEntry.created_at).toLocaleString()} />
              <DetailRow label="Action" value={selectedEntry.action} />
              <DetailRow label="Resource Type" value={selectedEntry.resource_type || '—'} />
              <DetailRow label="Resource ID" value={selectedEntry.resource_id || '—'} />
              <DetailRow label="User" value={selectedEntry.user_email || (selectedEntry.user_first_name ? `${selectedEntry.user_first_name} ${selectedEntry.user_last_name}` : '—')} />
              <DetailRow label="Tenant" value={selectedEntry.tenant_name || '—'} />
              {selectedEntry.details && (
                <div style={{ marginTop: '12px' }}>
                  <span style={styles.detailLabel}>Details</span>
                  <pre style={styles.jsonBlock}>{JSON.stringify(selectedEntry.details, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.detailRow}>
      <span style={styles.detailLabel}>{label}</span>
      <span style={styles.detailValue}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' },
  heading: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, margin: '0 0 4px 0', color: 'var(--color-text)' },
  subtext: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)', margin: 0 },
  filterRow: { display: 'flex', gap: '8px', flexWrap: 'wrap' as const, marginBottom: '16px' },
  input: { backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '8px 12px', color: 'var(--color-text)', fontSize: 'var(--font-size-sm)', width: '180px', boxSizing: 'border-box' as const },
  dateInput: { backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '8px 12px', color: 'var(--color-text)', fontSize: 'var(--font-size-sm)', width: '150px', boxSizing: 'border-box' as const },
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '560px', maxHeight: '80vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)', margin: 0 },
  closeBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-2xl)', cursor: 'pointer', padding: '4px 8px', lineHeight: 1 },
  detailBody: { display: 'flex', flexDirection: 'column' as const, gap: '8px' },
  detailRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--color-border)' },
  detailLabel: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', fontWeight: 500 },
  detailValue: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', fontFamily: 'monospace' },
  jsonBlock: { background: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '12px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', overflow: 'auto', maxHeight: '200px', fontFamily: 'monospace', margin: '4px 0 0 0' },
};
