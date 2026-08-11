import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Staff } from './Staff';
import { Resources } from './Resources';
import { Locations } from './Locations';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { Table } from '../design-system/components/data/Table';
import { apiClient } from '../api/client';
import * as servicesApi from '../api/services';

const VALID_TABS = ['staff', 'resources', 'locations', 'categories', 'taxes'] as const;
type Tab = typeof VALID_TABS[number];

export function Business() {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as Tab | null;
  const [activeTab, setActiveTab] = useState<Tab>(tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'staff');

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Business Setup</h1>
      </div>
      <div style={styles.tabBar}>
        {(['staff', 'resources', 'locations', 'categories', 'taxes'] as const).map((tab) => {
          const isActive = activeTab === tab;
          const labels: Record<string, string> = { staff: 'Staff', resources: 'Resources', locations: 'Locations', categories: 'Categories', taxes: 'Taxes' };
          return (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{
                background: 'none', border: 'none', outline: 'none',
                borderBottom: isActive ? '3px solid var(--color-primary)' : '3px solid transparent',
                padding: '10px 20px', fontSize: '14px',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                cursor: 'pointer', fontFamily: 'var(--font-family)', marginBottom: '-1px',
              }}>
              {labels[tab]}
            </button>
          );
        })}
      </div>
      {activeTab === 'staff' && <Staff />}
      {activeTab === 'resources' && <Resources />}
      {activeTab === 'locations' && <Locations />}
      {activeTab === 'categories' && <CategoriesTab />}
      {activeTab === 'taxes' && <TaxesTab />}
    </div>
  );
}

// --- Categories Tab ---

function CategoriesTab() {
  const businessId = localStorage.getItem('business_id') || '';

  return (
    <div>
      <ProductCategoriesSection businessId={businessId} />
      <div style={{ marginTop: 'var(--space-lg)' }}>
        <NoteCategoriesSection businessId={businessId} />
      </div>
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

  const columns = [
    { key: 'name', header: 'Name', sortable: true },
    {
      key: 'id', header: '',
      render: (_: any, row: any) => (
        <div style={{ textAlign: 'right' }}>
          <button onClick={(e) => { e.stopPropagation(); handleDelete(row.id, row.name); }} style={catStyles.deleteBtn} title="Delete">🗑️</button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={catStyles.toolbar}>
        <h3 style={catStyles.sectionTitle}>Product & Service Categories</h3>
        <div style={{ flex: 1 }} />
        {showAdd ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input style={catStyles.input} value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Category name" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }} />
            <Button size="sm" onClick={handleAdd} loading={adding}>Create</Button>
            <Button size="sm" variant="secondary" onClick={() => { setShowAdd(false); setAddName(''); }}>Cancel</Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}>Add Category</Button>
        )}
      </div>
      <Table columns={columns} data={categories} loading={loading} emptyMessage="No product/service categories defined" clientSort />
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

  const columns = [
    {
      key: 'name', header: 'Name', sortable: true,
      render: (_: any, row: any) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>{row.name}</span>
          {row.is_sensitive && <Badge variant="error">Sensitive</Badge>}
          {row.customer_visible && <Badge variant="info">Customer Visible</Badge>}
        </div>
      ),
    },
    {
      key: 'id', header: '',
      render: (_: any, row: any) => (
        <div style={{ textAlign: 'right' }}>
          <button onClick={(e) => { e.stopPropagation(); handleDelete(row.id, row.name); }} style={catStyles.deleteBtn} title="Delete">🗑️</button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={catStyles.toolbar}>
        <h3 style={catStyles.sectionTitle}>Customer Note Categories</h3>
        <div style={{ flex: 1 }} />
        {showAdd ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input style={catStyles.input} value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="Category name" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--color-text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={addForm.is_sensitive} onChange={(e) => setAddForm({ ...addForm, is_sensitive: e.target.checked })} style={{ width: '14px', height: '14px' }} /> Sensitive
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--color-text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={addForm.customer_visible} onChange={(e) => setAddForm({ ...addForm, customer_visible: e.target.checked })} style={{ width: '14px', height: '14px' }} /> Customer Visible
            </label>
            <Button size="sm" onClick={handleAdd} loading={adding}>Create</Button>
            <Button size="sm" variant="secondary" onClick={() => { setShowAdd(false); setAddForm({ name: '', is_sensitive: false, customer_visible: false }); }}>Cancel</Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}>Add Category</Button>
        )}
      </div>
      <Table columns={columns} data={categories} loading={loading} emptyMessage="No note categories defined" clientSort />
    </div>
  );
}

// --- Taxes Tab ---

function TaxesTab() {
  const businessId = localStorage.getItem('business_id') || '';
  const [taxes, setTaxes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', rate: '', is_default: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    servicesApi.getTaxCategories(businessId).then(setTaxes).catch(() => []).finally(() => setLoading(false));
  }, [businessId]);

  const refresh = () => {
    servicesApi.getTaxCategories(businessId).then(setTaxes).catch(() => {});
  };

  const openAdd = () => {
    setEditingId(null);
    setForm({ name: '', rate: '0', is_default: false });
    setShowAdd(true);
  };

  const openEdit = (tax: any) => {
    setEditingId(tax.id);
    setForm({ name: tax.name, rate: String(tax.rate / 100), is_default: tax.is_default });
    setShowAdd(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.rate) return;
    setSaving(true);
    try {
      const rateInBasisPoints = Math.round(parseFloat(form.rate) * 100);
      if (editingId) {
        await servicesApi.updateTaxCategory(editingId, businessId, { name: form.name.trim(), rate: rateInBasisPoints, is_default: form.is_default });
      } else {
        await servicesApi.createTaxCategory(businessId, { name: form.name.trim(), rate: rateInBasisPoints, is_default: form.is_default });
      }
      setShowAdd(false);
      refresh();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to save tax rate');
    } finally { setSaving(false); }
  };

  const handleDelete = async (tax: any) => {
    if (!confirm(`Delete "${tax.name}" tax rate?`)) return;
    try {
      await servicesApi.deleteTaxCategory(tax.id, businessId);
      refresh();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to delete tax rate');
    }
  };

  if (loading) return <div style={{ padding: 'var(--space-lg)', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading...</div>;

  return (
    <div>
      <div style={catStyles.toolbar}>
        <h3 style={catStyles.sectionTitle}>Tax Rates</h3>
        <div style={{ flex: 1 }} />
        <Button size="sm" variant="secondary" onClick={openAdd}>Add Tax Rate</Button>
      </div>

      {showAdd && (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', marginBottom: 'var(--space-md)', background: 'var(--color-surface)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px auto', gap: 'var(--space-md)', alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>Name</label>
              <input style={catStyles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. IVA Standard" />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>Rate (%)</label>
              <input type="number" step="0.01" min="0" max="100" style={catStyles.input} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="21" />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--color-text)', cursor: 'pointer', paddingBottom: '4px' }}>
              <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} style={{ width: '14px', height: '14px' }} /> Default
            </label>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: 'var(--space-md)' }}>
            <Button size="sm" onClick={handleSave} loading={saving}>{editingId ? 'Save' : 'Create'}</Button>
            <Button size="sm" variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {taxes.length === 0 && !showAdd && (
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>No tax rates defined. Add tax rates that can be assigned to services and products.</p>
      )}

      {taxes.length > 0 && (
        <Table
          columns={[
            { key: 'name', header: 'Name', sortable: true },
            { key: 'rate', header: 'Rate', sortable: true, render: (val: number) => `${(val / 100).toFixed(2)}%` },
            { key: 'is_default', header: 'Default', render: (val: boolean) => val ? <Badge variant="info">Default</Badge> : null },
            {
              key: 'id', header: '',
              render: (_: any, row: any) => (
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} style={catStyles.deleteBtn} title="Edit">✏️</button>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(row); }} style={catStyles.deleteBtn} title="Delete">🗑️</button>
                </div>
              ),
            },
          ]}
          data={taxes}
          loading={false}
          emptyMessage="No tax rates defined"
          clientSort
        />
      )}
    </div>
  );
}

const catStyles: Record<string, React.CSSProperties> = {
  toolbar: { display: 'flex', gap: 'var(--space-md)', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap' },
  sectionTitle: { margin: 0, fontSize: 'var(--font-size-md)', fontWeight: 600 as any, color: 'var(--color-text)' },
  input: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)' },
  deleteBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '0' },
};

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  tabBar: { display: 'flex', gap: '0', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--space-md)' },
  tab: { background: 'none', border: 'none', borderBottom: '3px solid transparent', padding: '10px 20px', fontSize: '14px', fontWeight: 500, color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)', marginBottom: '-1px' },
  tabActive: { color: 'var(--color-primary)', borderBottomColor: 'var(--color-primary)', fontWeight: 600 },
};
