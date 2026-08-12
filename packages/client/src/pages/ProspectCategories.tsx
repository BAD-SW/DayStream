import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Button } from '../design-system/components/actions/Button';

interface CategoryMapping {
  id: string;
  ui_category_name: string;
  google_search_strings: string[];
  api_exclusion_types: string[];
  active: boolean;
  display_order: number;
}

export function ProspectCategories() {
  const [categories, setCategories] = useState<CategoryMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ ui_category_name: '', google_search_strings: '', api_exclusion_types: '' });
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ ui_category_name: '', google_search_strings: '', api_exclusion_types: '' });

  const fetchCategories = async () => {
    try {
      // Admin page shows all categories (including inactive) for management
      const res = await apiClient.get('/v1/prospects/categories?include_inactive=true');
      setCategories(res.data.data || []);
    } catch { setCategories([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchCategories(); }, []);

  const handleAdd = async () => {
    if (!addForm.ui_category_name.trim() || !addForm.google_search_strings.trim()) {
      alert('Category name and at least one search string required');
      return;
    }
    try {
      await apiClient.post('/v1/prospects/categories', {
        ui_category_name: addForm.ui_category_name.trim(),
        google_search_strings: addForm.google_search_strings.split('\n').map(s => s.trim()).filter(Boolean),
        api_exclusion_types: addForm.api_exclusion_types.split(',').map(s => s.trim()).filter(Boolean),
      });
      setAddForm({ ui_category_name: '', google_search_strings: '', api_exclusion_types: '' });
      setShowAdd(false);
      fetchCategories();
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to add category'); }
  };

  const handleEdit = (cat: CategoryMapping) => {
    setEditingId(cat.id);
    setEditForm({
      ui_category_name: cat.ui_category_name,
      google_search_strings: cat.google_search_strings.join('\n'),
      api_exclusion_types: cat.api_exclusion_types.join(', '),
    });
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    try {
      await apiClient.put(`/v1/prospects/categories/${editingId}`, {
        ui_category_name: editForm.ui_category_name.trim(),
        google_search_strings: editForm.google_search_strings.split('\n').map(s => s.trim()).filter(Boolean),
        api_exclusion_types: editForm.api_exclusion_types.split(',').map(s => s.trim()).filter(Boolean),
      });
      setEditingId(null);
      fetchCategories();
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to update'); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this category?')) return;
    try {
      await apiClient.delete(`/v1/prospects/categories/${id}`);
      fetchCategories();
    } catch { alert('Failed to delete'); }
  };

  const handleToggleActive = async (id: string, active: boolean) => {
    try {
      await apiClient.put(`/v1/prospects/categories/${id}`, { active });
      setCategories(cats => cats.map(c => c.id === id ? { ...c, active } : c));
    } catch { alert('Failed to update'); }
  };

  if (loading) return <div style={styles.page}><p style={styles.muted}>Loading...</p></div>;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Prospect Categories</h1>
          <p style={styles.description}>Each category defines a set of natural language search terms sent to Google, plus types to exclude from results.</p>
        </div>
        <Button onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'Cancel' : 'Add Category'}</Button>
      </div>

      {showAdd && (
        <div style={styles.form}>
          <div style={styles.formField}>
            <label style={styles.label}>Category Name</label>
            <input style={styles.input} type="text" placeholder="e.g., Spas & Recovery Centers" value={addForm.ui_category_name} onChange={(e) => setAddForm({ ...addForm, ui_category_name: e.target.value })} />
          </div>
          <div style={styles.formField}>
            <label style={styles.label}>Search Strings (one per line)</label>
            <textarea style={styles.textarea} rows={5} placeholder={"Day spa\nMedical spa\nFloat spa\nWellness center"} value={addForm.google_search_strings} onChange={(e) => setAddForm({ ...addForm, google_search_strings: e.target.value })} />
          </div>
          <div style={styles.formField}>
            <label style={styles.label}>Exclusion Types (comma-separated, optional)</label>
            <input style={styles.input} type="text" placeholder="e.g., hospital, doctor, car_wash" value={addForm.api_exclusion_types} onChange={(e) => setAddForm({ ...addForm, api_exclusion_types: e.target.value })} />
          </div>
          <Button size="sm" onClick={handleAdd}>Save</Button>
        </div>
      )}

      <div style={styles.list}>
        {categories.length === 0 ? (
          <p style={styles.muted}>No categories configured.</p>
        ) : (
          categories.map((cat) => (
            <div key={cat.id} style={styles.card}>
              {editingId === cat.id ? (
                <div>
                  <div style={styles.formField}>
                    <label style={styles.label}>Category Name</label>
                    <input style={styles.input} type="text" value={editForm.ui_category_name} onChange={(e) => setEditForm({ ...editForm, ui_category_name: e.target.value })} />
                  </div>
                  <div style={styles.formField}>
                    <label style={styles.label}>Search Strings (one per line)</label>
                    <textarea style={styles.textarea} rows={5} value={editForm.google_search_strings} onChange={(e) => setEditForm({ ...editForm, google_search_strings: e.target.value })} />
                  </div>
                  <div style={styles.formField}>
                    <label style={styles.label}>Exclusion Types (comma-separated)</label>
                    <input style={styles.input} type="text" value={editForm.api_exclusion_types} onChange={(e) => setEditForm({ ...editForm, api_exclusion_types: e.target.value })} />
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <Button size="sm" onClick={handleSaveEdit}>Save</Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={styles.cardHeader}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <strong style={{ ...styles.cardName, opacity: cat.active ? 1 : 0.5 }}>{cat.ui_category_name}</strong>
                      {!cat.active && <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>inactive</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button style={{ ...styles.actionBtn, color: cat.active ? 'var(--color-success)' : 'var(--color-text-secondary)' }} onClick={() => handleToggleActive(cat.id, !cat.active)}>
                        {cat.active ? '● Active' : '○ Inactive'}
                      </button>
                      <button style={styles.actionBtn} onClick={() => handleEdit(cat)}>Edit</button>
                      <button style={{ ...styles.actionBtn, color: 'var(--color-error)' }} onClick={() => handleDelete(cat.id)}>Delete</button>
                    </div>
                  </div>
                  <div style={styles.cardBody}>
                    <div style={styles.chipRow}>
                      {cat.google_search_strings.map((s, i) => (
                        <span key={i} style={styles.chip}>{s}</span>
                      ))}
                    </div>
                    {cat.api_exclusion_types.length > 0 && (
                      <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                        Excludes: {cat.api_exclusion_types.join(', ')}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: '900px', margin: '0 auto', padding: 'var(--space-lg)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 300, margin: '0 0 4px', color: 'var(--color-text)' },
  description: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 },
  muted: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
  form: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', marginBottom: 'var(--space-lg)', background: 'var(--color-background)' },
  formField: { marginBottom: 'var(--space-sm)' },
  label: { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px' },
  input: { width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', background: 'var(--color-background)', boxSizing: 'border-box' as const },
  textarea: { width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', background: 'var(--color-background)', fontFamily: 'inherit', resize: 'vertical' as const, boxSizing: 'border-box' as const },
  list: { display: 'flex', flexDirection: 'column' as const, gap: '8px' },
  card: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  cardName: { fontSize: '14px', color: 'var(--color-text)' },
  cardBody: {},
  chipRow: { display: 'flex', flexWrap: 'wrap' as const, gap: '4px' },
  chip: { padding: '2px 8px', borderRadius: '12px', fontSize: '11px', background: 'var(--color-border)', color: 'var(--color-text)' },
  actionBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--color-primary)', padding: '2px 4px' },
};
