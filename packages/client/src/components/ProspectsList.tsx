import { useState, useEffect, useCallback, useMemo } from 'react';
import { Table, applyTableFilters } from '../design-system/components/data/Table';
import type { TableFilters } from '../design-system/components/data/Table';
import { apiClient } from '../api/client';
import { Button } from '../design-system/components/actions/Button';

/**
 * ProspectsList — the reusable prospect list/manage UI (filters, sortable table,
 * status/notes editing, dismiss, manual add). Parameterized by `apiBase` so it
 * serves BOTH the tenant's own page (`/v1/prospects`) and the system admin viewing
 * a specific tenant (`/v1/prospects/:tenantId`). It contains NO generation UI —
 * generation is system-admin-only and lives in TenantProspectsPanel.
 */

interface Prospect {
  id: string;
  name: string;
  address: string;
  city?: string;
  phone?: string;
  website?: string;
  category: string;
  rating?: number;
  status: string;
  notes?: string;
}


const STATUS_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'demo_scheduled', label: 'Demo Scheduled' },
  { value: 'signed', label: 'Signed' },
  { value: 'declined', label: 'Declined' },
  { value: 'dismissed', label: 'Dismissed' },
];

interface Props {
  /** API base for this list's data, e.g. '/v1/prospects' (own tenant) or
   *  '/v1/prospects/<tenantId>' (system admin viewing a tenant). The /prospects
   *  suffix for list/add is appended as needed per the route shapes. */
  apiBase: string;
  /** When true (tenant's own page), list is GET `${apiBase}` and item routes are
   *  `${apiBase}/:id`. When false (admin per-tenant), list is `${apiBase}/prospects`
   *  and item routes are `${apiBase}/prospects/:id`. */
  ownTenant: boolean;
  /** Show the manual Add Prospect form (default true). */
  allowAdd?: boolean;
  onCountChange?: (n: number) => void;
}

// Columns the list filters on screen (same keys as the table).
const FILTER_COLUMNS = (['name', 'address', 'city', 'category', 'rating', 'status', 'notes'] as const).map((key) => ({
  key, kind: 'values' as const, value: (p: Prospect) => (p as any)[key],
}));

export function ProspectsList({ apiBase, ownTenant, allowAdd = true, onCountChange }: Props) {
  // URL helpers derived from apiBase + mode.
  const listUrl = ownTenant ? apiBase : `${apiBase}/prospects`;
  const addUrl = listUrl;
  const itemUrl = (id: string) => (ownTenant ? `${apiBase}/${id}` : `${apiBase}/prospects/${id}`);
  const exportUrl = ownTenant ? `${apiBase}/export` : `${apiBase}/prospects/export`;

  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showDismissed, setShowDismissed] = useState(false);
  // Column filters beside the sort icon (David, 2026-11-02); Export CSV follows them.
  const [tableFilters, setTableFilters] = useState<TableFilters>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', address: '', phone: '', website: '', category: '', notes: '' });
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});

  const fetchProspects = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (showDismissed) params.append('show_dismissed', 'true');
      const res = await apiClient.get(`${listUrl}?${params.toString()}`);
      const data: Prospect[] = res.data.data || res.data || [];
      setProspects(data);
      onCountChange?.(data.length);
    } catch {
      setProspects([]);
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listUrl, search, showDismissed]);

  useEffect(() => { fetchProspects(); }, [fetchProspects]);

  const visibleProspects = useMemo(() => applyTableFilters(prospects, FILTER_COLUMNS, tableFilters), [prospects, tableFilters]);

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await apiClient.put(itemUrl(id), { status });
      setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)));
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to update status'); }
  };

  const handleNotesBlur = async (id: string) => {
    const notes = editingNotes[id];
    if (notes === undefined) return;
    try {
      await apiClient.put(itemUrl(id), { notes });
      setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, notes } : p)));
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to update notes'); }
    setEditingNotes((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };

  const handleDismiss = async (id: string) => {
    try {
      await apiClient.put(`${itemUrl(id)}/dismiss`);
      setProspects((prev) => prev.filter((p) => p.id !== id));
      onCountChange?.(prospects.length - 1);
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to dismiss prospect'); }
  };

  const handleAddSubmit = async () => {
    if (!formData.name.trim()) { alert('Name is required'); return; }
    try {
      await apiClient.post(addUrl, formData);
      setFormData({ name: '', address: '', phone: '', website: '', category: '', notes: '' });
      setShowAddForm(false);
      fetchProspects();
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to add prospect'); }
  };

  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    // Fetch via apiClient so the Bearer token is attached (a plain window.open to
    // the API would not carry it), then download the returned CSV as a blob.
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (Object.values(tableFilters).some((f) => f.values?.length || f.contains || f.from || f.to)) params.append('ids', visibleProspects.map((p) => p.id).join(','));
      const url = `${exportUrl}?${params.toString()}`;
      const res = await apiClient.get(url, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'text/csv' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'prospects.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } catch {
      alert('Failed to export prospects.');
    } finally { setExporting(false); }
  };

  return (
    <div>
      {/* Filters */}
      <div style={styles.filters}>
        <input type="text" placeholder="Search by name..." value={search} onChange={(e) => setSearch(e.target.value)} style={styles.searchInput} />
        <label style={styles.checkboxLabel}>
          <input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} style={styles.checkbox} />
          Show Dismissed
        </label>
        <button style={styles.exportLink} onClick={handleExport} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {allowAdd && (
        <>
          <div style={styles.addFormToggle}>
            <button style={styles.toggleButton} onClick={() => setShowAddForm(!showAddForm)}>
              {showAddForm ? '− Cancel' : '+ Add Prospect'}
            </button>
          </div>
          {showAddForm && (
            <div style={styles.addForm}>
              <div style={styles.formGrid}>
                <input type="text" placeholder="Name *" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} style={styles.formInput} />
                <input type="text" placeholder="Address" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} style={styles.formInput} />
                <input type="text" placeholder="Phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} style={styles.formInput} />
                <input type="text" placeholder="Website" value={formData.website} onChange={(e) => setFormData({ ...formData, website: e.target.value })} style={styles.formInput} />
                <input type="text" placeholder="Category" value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} style={styles.formInput} />
                <input type="text" placeholder="Notes" value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} style={styles.formInput} />
              </div>
              <div style={styles.formActions}>
                <Button onClick={handleAddSubmit}>Save</Button>
                <button style={styles.cancelButton} onClick={() => { setShowAddForm(false); setFormData({ name: '', address: '', phone: '', website: '', category: '', notes: '' }); }}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Table */}
      <Table
        rowId={(p: Prospect) => p.id}
        data={visibleProspects}
        filterSource={prospects}
        filters={tableFilters}
        onFiltersChange={setTableFilters}
        loading={loading}
        emptyMessage="No prospects found."
        clientSort
        columns={[
          { key: 'name', header: 'Name', sortable: true, render: (_: any, p: Prospect) => (
            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ' ' + (p.address || ''))}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-text)', textDecoration: 'underline' }}>{p.name}</a>
          ) },
          { key: 'address', header: 'Address', sortable: true },
          { key: 'city', header: 'City', sortable: true, render: (v: string) => v || '—' },
          { key: 'category', header: 'Category', sortable: true },
          { key: 'rating', header: 'Rating', sortable: true, render: (v: number) => v ?? '—' },
          { key: 'status', header: 'Status', sortable: true, filterLabel: (v: string) => STATUS_OPTIONS.find((s) => s.value === v)?.label || v, render: (_: any, p: Prospect) => (
            <select value={p.status} onChange={(e) => handleStatusChange(p.id, e.target.value)} onClick={(e) => e.stopPropagation()} style={styles.statusSelect} aria-label={`Status for ${p.name}`}>
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          ) },
          { key: 'notes', header: 'Notes', sortable: true, render: (_: any, p: Prospect) => (
            <input type="text" value={editingNotes[p.id] ?? p.notes ?? ''} onChange={(e) => setEditingNotes({ ...editingNotes, [p.id]: e.target.value })} onBlur={() => handleNotesBlur(p.id)} style={styles.notesInput} placeholder="Add notes..." aria-label={`Notes for ${p.name}`} />
          ) },
          { key: 'actions', header: '', filter: false as const, render: (_: any, p: Prospect) => (
            <button style={styles.dismissButton} onClick={() => handleDismiss(p.id)} title="Dismiss prospect">✕</button>
          ) },
        ]}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  filters: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)', flexWrap: 'wrap' as const },
  searchInput: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', background: 'var(--color-background)', minWidth: '200px' },
  select: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', background: 'var(--color-background)' },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', cursor: 'pointer' },
  checkbox: { width: '16px', height: '16px', cursor: 'pointer' },
  exportLink: { marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', textDecoration: 'underline', padding: 0 },
  addFormToggle: { marginBottom: 'var(--space-md)' },
  toggleButton: { background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontWeight: 500, padding: 0 },
  addForm: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', marginBottom: 'var(--space-lg)', background: 'var(--color-background)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' },
  formInput: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', background: 'var(--color-background)' },
  formActions: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' },
  cancelButton: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--button-radius)', padding: '8px 16px', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', minHeight: 'var(--button-height-sm)' },
  tableWrapper: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 'var(--font-size-sm)' },
  th: { textAlign: 'left' as const, padding: '12px 16px', borderBottom: '2px solid var(--color-border)', color: 'var(--color-text-secondary)', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const, userSelect: 'none' as const },
  td: { padding: '10px 16px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)', verticalAlign: 'middle' as const },
  rowEven: { background: 'transparent' },
  rowOdd: { background: 'rgba(0,0,0,0.02)' },
  statusSelect: { padding: '4px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', background: 'var(--color-background)' },
  notesInput: { padding: '4px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', background: 'var(--color-background)', width: '100%', minWidth: '120px' },
  dismissButton: { background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontSize: 'var(--font-size-base)', fontWeight: 700, padding: '4px 8px', borderRadius: 'var(--radius-md)' },
  empty: { textAlign: 'center' as const, padding: 'var(--space-lg)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
};
