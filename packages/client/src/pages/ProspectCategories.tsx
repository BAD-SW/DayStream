import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { Button } from '../design-system/components/actions/Button';

interface Category {
  id: string;
  google_type: string;
  label: string;
  active: boolean;
  created_at: string;
}

export function ProspectCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ google_type: '', label: '' });

  const fetchCategories = async () => {
    try {
      const res = await apiClient.get('/v1/prospects/categories');
      setCategories(res.data.data || []);
    } catch { setCategories([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchCategories(); }, []);

  const handleAdd = async () => {
    if (!form.google_type.trim() || !form.label.trim()) { alert('Both fields are required'); return; }
    try {
      await apiClient.post('/v1/prospects/categories', form);
      setForm({ google_type: '', label: '' });
      setShowAdd(false);
      fetchCategories();
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to add category'); }
  };

  const handleRemove = async (id: string) => {
    if (!confirm('Remove this category? It will no longer be used in prospect searches.')) return;
    try {
      await apiClient.delete(`/v1/prospects/categories/${id}`);
      fetchCategories();
    } catch { alert('Failed to remove category'); }
  };

  if (loading) return <div style={styles.page}><p style={styles.muted}>Loading...</p></div>;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Prospect Categories</h1>
          <p style={styles.description}>Google Places business types used when generating prospect lists. Only active categories are searched.</p>
        </div>
        <Button onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'Cancel' : 'Add Category'}</Button>
      </div>

      {showAdd && (
        <div style={styles.addForm}>
          <input
            style={styles.input}
            type="text"
            placeholder="Google type (e.g., yoga_studio)"
            value={form.google_type}
            onChange={(e) => setForm({ ...form, google_type: e.target.value })}
          />
          <input
            style={styles.input}
            type="text"
            placeholder="Display label (e.g., Yoga Studio)"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
          <Button size="sm" onClick={handleAdd}>Save</Button>
        </div>
      )}

      <div style={styles.list}>
        {categories.length === 0 ? (
          <p style={styles.muted}>No categories configured.</p>
        ) : (
          categories.map((cat) => (
            <div key={cat.id} style={{ ...styles.row, opacity: cat.active ? 1 : 0.5 }}>
              <div style={styles.rowInfo}>
                <span style={styles.rowLabel}>{cat.label}</span>
                <span style={styles.rowType}>{cat.google_type}</span>
              </div>
              <div style={styles.rowActions}>
                {cat.active ? (
                  <button style={styles.removeBtn} onClick={() => handleRemove(cat.id)}>Remove</button>
                ) : (
                  <span style={styles.inactiveTag}>Inactive</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: '800px', margin: '0 auto', padding: 'var(--space-lg)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 300, margin: '0 0 4px', color: 'var(--color-text)' },
  description: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 },
  muted: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
  addForm: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', marginBottom: 'var(--space-lg)', padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)' },
  input: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', background: 'var(--color-background)', flex: 1 },
  list: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' },
  rowInfo: { display: 'flex', flexDirection: 'column' as const, gap: '2px' },
  rowLabel: { fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' },
  rowType: { fontSize: '12px', color: 'var(--color-text-secondary)', fontFamily: 'monospace' },
  rowActions: { display: 'flex', gap: '8px', alignItems: 'center' },
  removeBtn: { background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontSize: '12px', padding: '4px 8px' },
  inactiveTag: { fontSize: '11px', color: 'var(--color-text-secondary)', fontStyle: 'italic' as const },
};
