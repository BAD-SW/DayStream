import { useState, useEffect, useCallback } from 'react';
import { Table } from '../design-system/components/data/Table';
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
  const [actionFilter, setActionFilter] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Detail modal
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, limit };
      if (actionFilter) params.action = actionFilter;
      if (resourceFilter) params.resource_type = resourceFilter;
      if (userFilter) params.user_id = userFilter;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      const res = await apiClient.get('/v1/admin/audit-log', { params });
      setEntries(res.data.data || []);
      setTotal(res.data.meta?.total || 0);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, resourceFilter, userFilter, startDate, endDate]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const totalPages = Math.ceil(total / limit);

  const handleExportCSV = async () => {
    try {
      const params: Record<string, any> = { limit: 10000 };
      if (actionFilter) params.action = actionFilter;
      if (resourceFilter) params.resource_type = resourceFilter;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      const res = await apiClient.get('/v1/admin/audit-log', { params });
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
      key: 'id', header: '', sortable: false,
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

      {/* Filters */}
      <div style={styles.filterRow}>
        <input style={styles.input} placeholder="Action (e.g. tenant.created)" value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }} />
        <input style={styles.input} placeholder="Resource type" value={resourceFilter}
          onChange={(e) => { setResourceFilter(e.target.value); setPage(1); }} />
        <input style={styles.input} placeholder="User ID" value={userFilter}
          onChange={(e) => { setUserFilter(e.target.value); setPage(1); }} />
        <input style={styles.dateInput} type="date" value={startDate}
          onChange={(e) => { setStartDate(e.target.value); setPage(1); }} />
        <input style={styles.dateInput} type="date" value={endDate}
          onChange={(e) => { setEndDate(e.target.value); setPage(1); }} />
      </div>

      <Table
        columns={columns}
        data={entries}
        loading={loading}
        emptyMessage="No audit entries found."
        clientSort
        page={totalPages > 1 ? page : undefined}
        totalPages={totalPages > 1 ? totalPages : undefined}
        onPageChange={totalPages > 1 ? setPage : undefined}
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
  heading: { fontSize: '24px', fontWeight: 300, margin: '0 0 4px 0', color: 'var(--color-text)' },
  subtext: { color: 'var(--color-text-secondary)', fontSize: '14px', margin: 0 },
  filterRow: { display: 'flex', gap: '8px', flexWrap: 'wrap' as const, marginBottom: '16px' },
  input: { backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '8px 12px', color: 'var(--color-text)', fontSize: '13px', width: '180px', boxSizing: 'border-box' as const },
  dateInput: { backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '8px 12px', color: 'var(--color-text)', fontSize: '13px', width: '150px', boxSizing: 'border-box' as const },
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '560px', maxHeight: '80vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { fontSize: '18px', fontWeight: 600, color: 'var(--color-text)', margin: 0 },
  closeBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: '24px', cursor: 'pointer', padding: '4px 8px', lineHeight: 1 },
  detailBody: { display: 'flex', flexDirection: 'column' as const, gap: '8px' },
  detailRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--color-border)' },
  detailLabel: { fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 },
  detailValue: { fontSize: '13px', color: 'var(--color-text)', fontFamily: 'monospace' },
  jsonBlock: { background: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '12px', fontSize: '12px', color: 'var(--color-text)', overflow: 'auto', maxHeight: '200px', fontFamily: 'monospace', margin: '4px 0 0 0' },
};
