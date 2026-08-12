import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client';
import { Button } from '../design-system/components/actions/Button';

interface Prospect {
  id: string;
  name: string;
  address: string;
  phone?: string;
  website?: string;
  category: string;
  rating?: number;
  status: string;
  notes?: string;
  dismissed_at?: string;
}

type SortField = 'name' | 'address' | 'category' | 'rating' | 'status' | 'notes';
type SortDir = 'asc' | 'desc';

const STATUS_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'demo_scheduled', label: 'Demo Scheduled' },
  { value: 'signed', label: 'Signed' },
  { value: 'declined', label: 'Declined' },
  { value: 'dismissed', label: 'Dismissed' },
];

export function Prospects() {
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
  const [territory, setTerritory] = useState<{ location: string } | null>(null);

  const fetchProspects = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (categoryFilter) params.append('category', categoryFilter);
      if (search) params.append('search', search);
      if (showDismissed) params.append('show_dismissed', 'true');

      const res = await apiClient.get(`/v1/prospects?${params.toString()}`);
      const data: Prospect[] = res.data.data || res.data || [];
      setProspects(data);

      const uniqueCategories = Array.from(new Set(data.map((p) => p.category).filter(Boolean)));
      setCategories(uniqueCategories);
    } catch {
      setProspects([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter, search, showDismissed]);

  useEffect(() => {
    fetchProspects();
    // Load territory info
    apiClient.get('/v1/prospects/territory-info').then((res) => {
      const data = res.data.data;
      if (data) {
        setTerritory({ location: data.territory_address || '' });
      }
    }).catch((err) => { console.error('Failed to load territory info:', err.message); });
  }, [fetchProspects]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortedProspects = [...prospects].sort((a, b) => {
    const numericFields = ['rating'];
    const aRaw = a[sortField] ?? '';
    const bRaw = b[sortField] ?? '';
    let cmp: number;
    if (numericFields.includes(sortField)) {
      const aNum = Number(aRaw) || 0;
      const bNum = Number(bRaw) || 0;
      cmp = aNum - bNum;
    } else {
      cmp = String(aRaw).localeCompare(String(bRaw));
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await apiClient.put(`/v1/prospects/${id}`, { status });
      setProspects((prev) => prev.map((p) => p.id === id ? { ...p, status } : p));
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update status');
    }
  };

  const handleNotesBlur = async (id: string) => {
    const notes = editingNotes[id];
    if (notes === undefined) return;
    try {
      await apiClient.put(`/v1/prospects/${id}`, { notes });
      setProspects((prev) => prev.map((p) => p.id === id ? { ...p, notes } : p));
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update notes');
    }
    setEditingNotes((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleDismiss = async (id: string) => {
    try {
      await apiClient.put(`/v1/prospects/${id}/dismiss`);
      setProspects((prev) => prev.filter((p) => p.id !== id));
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to dismiss prospect');
    }
  };

  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    // Fetch preview first to show the search plan
    try {
      const preview = await apiClient.get('/v1/prospects/generate/preview');
      const plan = preview.data.data;
      const msg = `Search Plan:\n\n` +
        `• ${plan.search_centers} search areas × ${plan.categories} categories = ${plan.estimated_api_calls} API calls\n` +
        `• Estimated cost: $${plan.estimated_cost_usd}\n` +
        `• Dense areas may trigger additional drill-down searches\n\n` +
        `Proceed?`;
      if (!window.confirm(msg)) return;
    } catch {
      if (!window.confirm('Generate new prospects? Could not load preview.')) return;
    }
    setGenerating(true);
    // Start polling the prospect list to show results as they come in
    const pollInterval = setInterval(() => { fetchProspects(); }, 4000);
    try {
      const res = await apiClient.post('/v1/prospects/generate');
      const result = res.data.data || res.data;
      clearInterval(pollInterval);
      setGenerating(false);
      fetchProspects();
      alert(`${result.new_added ?? result.added ?? 0} new prospects added, ${result.total_returned ?? 0} total found, ${result.inactive_marked ?? 0} marked inactive`);
    } catch (err: any) {
      clearInterval(pollInterval);
      setGenerating(false);
      alert(err.response?.data?.error || 'Failed to generate prospects');
    }
  };

  const handleExport = () => {
    const params = new URLSearchParams();
    if (statusFilter) params.append('status', statusFilter);
    if (categoryFilter) params.append('category', categoryFilter);
    window.open(`/api/v1/prospects/export?${params.toString()}`, '_blank');
  };

  const handleAddSubmit = async () => {
    if (!formData.name.trim()) {
      alert('Name is required');
      return;
    }
    try {
      await apiClient.post('/v1/prospects', formData);
      setFormData({ name: '', address: '', phone: '', website: '', category: '', notes: '' });
      setShowAddForm(false);
      fetchProspects();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to add prospect');
    }
  };

  const renderSortIndicator = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Prospects</h1>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{sortedProspects.length} prospect{sortedProspects.length !== 1 ? 's' : ''}</span>
        </div>
        <div style={styles.headerActions}>
          {territory && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>Location: <strong style={{ color: 'var(--color-text)' }}>{territory.location}</strong></span>
            </div>
          )}
          <Button onClick={handleGenerate} loading={generating} disabled={generating}>{generating ? 'Generating...' : 'Generate Prospects'}</Button>
          <button style={styles.exportLink} onClick={handleExport}>Export CSV</button>
        </div>
      </div>

      {/* Filters */}
      <div style={styles.filters}>
        <input
          type="text"
          placeholder="Search by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={styles.searchInput}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={styles.select}
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.filter((s) => s.value !== 'dismissed').map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={styles.select}
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label style={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={(e) => setShowDismissed(e.target.checked)}
            style={styles.checkbox}
          />
          Show Dismissed
        </label>
      </div>

      {/* Add Form Toggle */}
      <div style={styles.addFormToggle}>
        <button
          style={styles.toggleButton}
          onClick={() => setShowAddForm(!showAddForm)}
        >
          {showAddForm ? '− Cancel' : '+ Add Prospect'}
        </button>
      </div>

      {/* Add Prospect Form */}
      {showAddForm && (
        <div style={styles.addForm}>
          <div style={styles.formGrid}>
            <input
              type="text"
              placeholder="Name *"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              style={styles.formInput}
            />
            <input
              type="text"
              placeholder="Address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              style={styles.formInput}
            />
            <input
              type="text"
              placeholder="Phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              style={styles.formInput}
            />
            <input
              type="text"
              placeholder="Website"
              value={formData.website}
              onChange={(e) => setFormData({ ...formData, website: e.target.value })}
              style={styles.formInput}
            />
            <input
              type="text"
              placeholder="Category"
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              style={styles.formInput}
            />
            <input
              type="text"
              placeholder="Notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              style={styles.formInput}
            />
          </div>
          <div style={styles.formActions}>
            <Button onClick={handleAddSubmit}>Save</Button>
            <button
              style={styles.cancelButton}
              onClick={() => { setShowAddForm(false); setFormData({ name: '', address: '', phone: '', website: '', category: '', notes: '' }); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={styles.empty}>Loading...</div>
      ) : sortedProspects.length === 0 ? (
        <div style={styles.empty}>
          <p>No prospects found.</p>
          <p style={styles.emptyHint}>Try generating prospects to discover businesses in your area.</p>
        </div>
      ) : (
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr>
                {(['name', 'address', 'category', 'rating', 'status', 'notes'] as SortField[]).map((field) => (
                  <th
                    key={field}
                    style={styles.th}
                    onClick={() => handleSort(field)}
                  >
                    {field.charAt(0).toUpperCase() + field.slice(1)}{renderSortIndicator(field)}
                  </th>
                ))}
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedProspects.map((prospect, idx) => (
                <tr key={prospect.id} style={idx % 2 === 0 ? styles.rowEven : styles.rowOdd}>
                  <td style={styles.td}>
                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(prospect.name + ' ' + (prospect.address || ''))}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-text)', textDecoration: 'underline' }}>{prospect.name}</a>
                  </td>
                  <td style={styles.td}>{prospect.address}</td>
                  <td style={styles.td}>{prospect.category}</td>
                  <td style={styles.td}>{prospect.rating ?? '—'}</td>
                  <td style={styles.td}>
                    <select
                      value={prospect.status}
                      onChange={(e) => handleStatusChange(prospect.id, e.target.value)}
                      style={styles.statusSelect}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </td>
                  <td style={styles.td}>
                    <input
                      type="text"
                      value={editingNotes[prospect.id] ?? prospect.notes ?? ''}
                      onChange={(e) => setEditingNotes({ ...editingNotes, [prospect.id]: e.target.value })}
                      onBlur={() => handleNotesBlur(prospect.id)}
                      style={styles.notesInput}
                      placeholder="Add notes..."
                    />
                  </td>
                  <td style={styles.td}>
                    <button
                      style={styles.dismissButton}
                      onClick={() => handleDismiss(prospect.id)}
                      title="Dismiss prospect"
                    >
                      ✕
                    </button>
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
  page: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: 'var(--space-lg)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 'var(--space-lg)',
  },
  title: {
    fontSize: 'var(--font-size-2xl)',
    fontWeight: 300,
    margin: 0,
    color: 'var(--color-text)',
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-md)',
  },
  exportLink: {
    background: 'none',
    border: 'none',
    color: 'var(--color-primary)',
    cursor: 'pointer',
    fontSize: 'var(--font-size-sm)',
    textDecoration: 'underline',
    padding: 0,
  },
  filters: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-md)',
    marginBottom: 'var(--space-lg)',
    flexWrap: 'wrap' as const,
  },
  searchInput: {
    padding: '8px 12px',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text)',
    background: 'var(--color-background)',
    minWidth: '200px',
  },
  select: {
    padding: '8px 12px',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text)',
    background: 'var(--color-background)',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
  },
  checkbox: {
    width: '16px',
    height: '16px',
    cursor: 'pointer',
  },
  addFormToggle: {
    marginBottom: 'var(--space-md)',
  },
  toggleButton: {
    background: 'none',
    border: 'none',
    color: 'var(--color-primary)',
    cursor: 'pointer',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 500,
    padding: 0,
  },
  addForm: {
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-md)',
    marginBottom: 'var(--space-lg)',
    background: 'var(--color-background)',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 'var(--space-sm)',
    marginBottom: 'var(--space-md)',
  },
  formInput: {
    padding: '8px 12px',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text)',
    background: 'var(--color-background)',
  },
  formActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
  },
  cancelButton: {
    background: 'none',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '8px 16px',
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
    fontSize: 'var(--font-size-sm)',
  },
  tableWrapper: {
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    overflow: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 'var(--font-size-sm)',
  },
  th: {
    textAlign: 'left' as const,
    padding: '12px 16px',
    borderBottom: '2px solid var(--color-border)',
    color: 'var(--color-text-secondary)',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    userSelect: 'none' as const,
  },
  td: {
    padding: '10px 16px',
    borderBottom: '1px solid var(--color-border)',
    color: 'var(--color-text)',
    verticalAlign: 'middle' as const,
  },
  rowEven: {
    background: 'transparent',
  },
  rowOdd: {
    background: 'rgba(0,0,0,0.02)',
  },
  statusSelect: {
    padding: '4px 8px',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text)',
    background: 'var(--color-background)',
  },
  notesInput: {
    padding: '4px 8px',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text)',
    background: 'var(--color-background)',
    width: '100%',
    minWidth: '120px',
  },
  dismissButton: {
    background: 'none',
    border: 'none',
    color: 'var(--color-error)',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 700,
    padding: '4px 8px',
    borderRadius: 'var(--radius-md)',
  },
  empty: {
    textAlign: 'center' as const,
    padding: 'var(--space-lg)',
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--font-size-sm)',
  },
  emptyHint: {
    marginTop: 'var(--space-sm)',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text-secondary)',
  },
};
