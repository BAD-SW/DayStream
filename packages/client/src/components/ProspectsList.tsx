import { useState, useEffect, useCallback } from 'react';
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

type SortField = 'name' | 'address' | 'city' | 'category' | 'rating' | 'status' | 'notes';
type SortDir = 'asc' | 'desc';

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

export function ProspectsList({ apiBase, ownTenant, allowAdd = true, onCountChange }: Props) {
  // URL helpers derived from apiBase + mode.
  const listUrl = ownTenant ? apiBase : `${apiBase}/prospects`;
  const addUrl = listUrl;
  const itemUrl = (id: string) => (ownTenant ? `${apiBase}/${id}` : `${apiBase}/prospects/${id}`);
  const exportUrl = ownTenant ? `${apiBase}/export` : `${apiBase}/prospects/export`;

  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showDismissed, setShowDismissed] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', address: '', phone: '', website: '', category: '', notes: '' });
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});

  const fetchProspects = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (categoryFilter) params.append('category', categoryFilter);
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
  }, [listUrl, statusFilter, categoryFilter, search, showDismissed]);

  useEffect(() => { fetchProspects(); }, [fetchProspects]);

  useEffect(() => {
    apiClient.get('/v1/prospects/categories').then((res) => {
      const cats = res.data.data || [];
      setCategories(cats.map((c: any) => c.ui_category_name));
    }).catch(() => {});
  }, []);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const sortedProspects = [...prospects].sort((a, b) => {
    const aRaw = (a as any)[sortField] ?? '';
    const bRaw = (b as any)[sortField] ?? '';
    let cmp: number;
    if (sortField === 'rating') cmp = (Number(aRaw) || 0) - (Number(bRaw) || 0);
    else cmp = String(aRaw).localeCompare(String(bRaw));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const renderSortIndicator = (field: SortField) => (sortField !== field ? null : sortDir === 'asc' ? ' ▲' : ' ▼');

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
      if (statusFilter) params.append('status', statusFilter);
      if (categoryFilter) params.append('category', categoryFilter);
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
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={styles.select}>
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.filter((s) => s.value !== 'dismissed').map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={styles.select}>
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
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
      {loading ? (
        <div style={styles.empty}>Loading...</div>
      ) : sortedProspects.length === 0 ? (
        <div style={styles.empty}><p>No prospects found.</p></div>
      ) : (
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr>
                {(['name', 'address', 'city', 'category', 'rating', 'status', 'notes'] as SortField[]).map((field) => (
                  <th key={field} style={styles.th} onClick={() => handleSort(field)}>
                    {field.charAt(0).toUpperCase() + field.slice(1)}{renderSortIndicator(field)}
                  </th>
                ))}
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedProspects.map((p, idx) => (
                <tr key={p.id} style={idx % 2 === 0 ? styles.rowEven : styles.rowOdd}>
                  <td style={styles.td}>
                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ' ' + (p.address || ''))}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-text)', textDecoration: 'underline' }}>{p.name}</a>
                  </td>
                  <td style={styles.td}>{p.address}</td>
                  <td style={styles.td}>{p.city || '—'}</td>
                  <td style={styles.td}>{p.category}</td>
                  <td style={styles.td}>{p.rating ?? '—'}</td>
                  <td style={styles.td}>
                    <select value={p.status} onChange={(e) => handleStatusChange(p.id, e.target.value)} style={styles.statusSelect}>
                      {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td style={styles.td}>
                    <input type="text" value={editingNotes[p.id] ?? p.notes ?? ''} onChange={(e) => setEditingNotes({ ...editingNotes, [p.id]: e.target.value })} onBlur={() => handleNotesBlur(p.id)} style={styles.notesInput} placeholder="Add notes..." />
                  </td>
                  <td style={styles.td}>
                    <button style={styles.dismissButton} onClick={() => handleDismiss(p.id)} title="Dismiss prospect">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
