import { useState, useEffect } from 'react';
import { Staff } from './Staff';
import { Resources } from './Resources';
import { Locations } from './Locations';
import { Button } from '../design-system/components/actions/Button';
import { apiClient } from '../api/client';
import * as servicesApi from '../api/services';

export function Business() {
  const [activeTab, setActiveTab] = useState<'staff' | 'resources' | 'locations' | 'categories'>('staff');

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Business Setup</h1>
      </div>
      <div style={styles.tabBar}>
        <button onClick={() => setActiveTab('staff')} style={{ ...styles.tab, ...(activeTab === 'staff' ? styles.tabActive : {}) }}>Staff</button>
        <button onClick={() => setActiveTab('resources')} style={{ ...styles.tab, ...(activeTab === 'resources' ? styles.tabActive : {}) }}>Resources</button>
        <button onClick={() => setActiveTab('locations')} style={{ ...styles.tab, ...(activeTab === 'locations' ? styles.tabActive : {}) }}>Locations</button>
        <button onClick={() => setActiveTab('categories')} style={{ ...styles.tab, ...(activeTab === 'categories' ? styles.tabActive : {}) }}>Categories</button>
      </div>
      {activeTab === 'staff' && <Staff />}
      {activeTab === 'resources' && <Resources />}
      {activeTab === 'locations' && <Locations />}
      {activeTab === 'categories' && <CategoriesTab />}
    </div>
  );
}

// --- Categories Tab ---

function CategoriesTab() {
  const businessId = localStorage.getItem('business_id') || '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
      <ProductCategoriesSection businessId={businessId} />
      <NoteCategoriesSection businessId={businessId} />
    </div>
  );
}

// --- Product Categories ---

function ProductCategoriesSection({ businessId }: { businessId: string }) {
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    servicesApi.getCategories(businessId).then(setCategories).catch(() => []).finally(() => setLoading(false));
  }, [businessId]);

  const handleAdd = async () => {
    if (!addName.trim()) return;
    setAdding(true);
    try {
      const created = await servicesApi.createCategory({ business_id: businessId, name: addName.trim() });
      setCategories([...categories, created]);
      setAddName('');
      setShowAdd(false);
    } catch { alert('Failed to create category'); }
    finally { setAdding(false); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}" category?`)) return;
    try {
      await servicesApi.deleteCategory(id, businessId);
      setCategories(categories.filter((c) => c.id !== id));
    } catch { alert('Failed to delete category'); }
  };

  if (loading) return <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>Loading...</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={sectionTitleStyle}>Product & Service Categories</h3>
        <Button size="sm" variant="secondary" onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'Cancel' : 'Add Category'}</Button>
      </div>

      {showAdd && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: 'var(--space-md)' }}>
          <input style={inputStyle} value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Category name" />
          <Button size="sm" onClick={handleAdd} loading={adding}>Create</Button>
        </div>
      )}

      {categories.length === 0 && <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>No product/service categories defined.</p>}
      {categories.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {categories.map((cat) => (
            <div key={cat.id} style={itemRowStyle}>
              <span style={{ fontWeight: 500, color: 'var(--color-text)', fontSize: '14px' }}>{cat.name}</span>
              <button onClick={() => handleDelete(cat.id, cat.name)} style={deleteBtnStyle} title="Delete">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Note Categories ---

function NoteCategoriesSection({ businessId }: { businessId: string }) {
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', is_sensitive: false, customer_visible: false });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    apiClient.get(`/v1/customers/note-categories/list?business_id=${businessId}`)
      .then((res) => setCategories(res.data.data || []))
      .catch(() => setCategories([]))
      .finally(() => setLoading(false));
  }, [businessId]);

  const handleAdd = async () => {
    if (!addForm.name.trim()) return;
    setAdding(true);
    try {
      const res = await apiClient.post(`/v1/customers/note-categories?business_id=${businessId}`, addForm);
      setCategories([...categories, res.data.data]);
      setAddForm({ name: '', is_sensitive: false, customer_visible: false });
      setShowAdd(false);
    } catch { alert('Failed to create category'); }
    finally { setAdding(false); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}" note category?`)) return;
    try {
      await apiClient.delete(`/v1/customers/note-categories/${id}?business_id=${businessId}`);
      setCategories(categories.filter((c) => c.id !== id));
    } catch { alert('Failed to delete category'); }
  };

  if (loading) return <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>Loading...</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={sectionTitleStyle}>Customer Note Categories</h3>
        <Button size="sm" variant="secondary" onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'Cancel' : 'Add Category'}</Button>
      </div>

      {showAdd && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: 'var(--space-md)', flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={inputStyle} value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="Category name" />
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--color-text)', cursor: 'pointer' }}>
            <input type="checkbox" checked={addForm.is_sensitive} onChange={(e) => setAddForm({ ...addForm, is_sensitive: e.target.checked })} style={{ width: '14px', height: '14px' }} /> Sensitive
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--color-text)', cursor: 'pointer' }}>
            <input type="checkbox" checked={addForm.customer_visible} onChange={(e) => setAddForm({ ...addForm, customer_visible: e.target.checked })} style={{ width: '14px', height: '14px' }} /> Customer Visible
          </label>
          <Button size="sm" onClick={handleAdd} loading={adding}>Create</Button>
        </div>
      )}

      {categories.length === 0 && <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>No note categories defined.</p>}
      {categories.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {categories.map((cat) => (
            <div key={cat.id} style={itemRowStyle}>
              <div>
                <span style={{ fontWeight: 500, color: 'var(--color-text)', fontSize: '14px' }}>{cat.name}</span>
                {cat.is_sensitive && <span style={{ marginLeft: '8px', fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'var(--color-error)', color: '#fff' }}>Sensitive</span>}
                {cat.customer_visible && <span style={{ marginLeft: '8px', fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'var(--color-info, #4A90A4)', color: '#fff' }}>Customer Visible</span>}
              </div>
              <button onClick={() => handleDelete(cat.id, cat.name)} style={deleteBtnStyle} title="Delete">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const sectionTitleStyle: React.CSSProperties = { margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.5px' };
const inputStyle: React.CSSProperties = { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 12px', fontSize: '13px', fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)' };
const itemRowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' };
const deleteBtnStyle: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: 'var(--color-error)', padding: '2px 6px', lineHeight: 1 };

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  tabBar: { display: 'flex', gap: '0', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--space-lg)' },
  tab: { background: 'none', border: 'none', borderBottom: '2px solid transparent', padding: '10px 20px', fontSize: '14px', fontWeight: 500, color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  tabActive: { color: 'var(--color-primary)', borderBottomColor: 'var(--color-primary)' },
};
