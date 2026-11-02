import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Staff } from './Staff';
import { Resources } from './Resources';
import { Locations } from './Locations';
import { DocumentTemplatesSettings } from './settings/DocumentTemplatesSettings';
import { DataMigration } from './settings/DataMigration';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { Table } from '../design-system/components/data/Table';
import { TabBar } from '../design-system/components/navigation/TabBar';
import { StickyPageTop } from '../design-system/components/layout/StickyPageTop';
import { DraftSectionsProvider, DraftTab, useDraftSections, useDraftList, fieldMark, draftBox, UnsavedTag, RowTag } from '../components/unsaved/DraftSections';
import type { DraftRow } from '../components/unsaved/DraftSections';
import { LeaveGuard } from '../components/unsaved/LeaveGuard';
import { SaveChanges } from '../components/unsaved/SaveChanges';
import { apiClient } from '../api/client';
import * as servicesApi from '../api/services';

const VALID_TABS = ['staff', 'resources', 'locations', 'categories', 'taxes', 'templates', 'migration'] as const;
type Tab = typeof VALID_TABS[number];

// One Save for Business Setup (David, 2026-11-02, as in Settings): categories and tax rates wait
// for Save changes. Staff, resources and locations are lists that open their own pages. Templates
// and Data Migration keep their own buttons, after a separator (decision 9).
export function Business() {
  return (
    <DraftSectionsProvider>
      <BusinessPage />
    </DraftSectionsProvider>
  );
}

function BusinessPage() {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as Tab | null;
  const [activeTab, setActiveTab] = useState<Tab>(tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'staff');
  const { dirtySections } = useDraftSections();
  // An open template with changes (Templates keep their own Save): leaving asks first too.
  const [templateDirty, setTemplateDirty] = useState(false);
  const labels: Record<Tab, string> = { staff: 'Staff', resources: 'Resources', locations: 'Locations', categories: 'Categories', taxes: 'Taxes', templates: 'Templates', migration: 'Data Migration' };

  return (
    <div style={styles.page}>
      <LeaveGuard when={dirtySections.length > 0 || templateDirty} />
      <StickyPageTop>
        <div style={styles.header}>
          <h1 style={styles.title}>Business Setup</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}><SaveChanges /></div>
        </div>
        <TabBar aria-label="Business Setup sections" active={activeTab} onChange={setActiveTab}
          tabs={VALID_TABS.map((key) => ({ key, label: labels[key], changed: key === 'templates' ? templateDirty : dirtySections.some((s) => s.tab === key),
            // Templates and Data Migration keep their own buttons, set apart (decision 9, as Processes and Appearance in Settings).
            separatorBefore: key === 'templates' }))} />
      </StickyPageTop>
      <div style={{ marginTop: 'var(--space-md)' }}>
        {activeTab === 'staff' && <Staff />}
        {activeTab === 'resources' && <Resources />}
        {activeTab === 'locations' && <Locations />}
        {/* Tabs with drafts stay mounted, so their edits survive switching tabs. */}
        <div hidden={activeTab !== 'categories'}><DraftTab tab="categories"><CategoriesTab /></DraftTab></div>
        <div hidden={activeTab !== 'taxes'}><DraftTab tab="taxes"><TaxesTab /></DraftTab></div>
        {activeTab === 'templates' && <DocumentTemplatesSettings onDirtyChange={setTemplateDirty} />}
        {activeTab === 'migration' && <DataMigration businessId={localStorage.getItem('business_id') || ''} />}
      </div>
    </div>
  );
}

/** A draft row as the table gets it: the item's fields, for sorting and filters, and the row itself. */
type TableRow = Record<string, any> & { __row: DraftRow<any> };
const tableRows = (rows: DraftRow<any>[]): TableRow[] => rows.map((r) => ({ ...r.item, __row: r }));

/** Name cell of a row kept as a draft: its labels, crossed out when it goes on save. */
function DraftName<T>({ row, edited, children }: { row: DraftRow<T>; edited?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', opacity: row.deleted ? 0.6 : 1 }}>
      <span style={{ textDecoration: row.deleted ? 'line-through' : 'none', display: 'inline-flex', gap: '8px', alignItems: 'center' }}>{children}</span>
      {row.isNew && <RowTag>New</RowTag>}
      {edited && <RowTag>Changed</RowTag>}
      {row.deleted && <RowTag>Deleted when you save</RowTag>}
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

// --- Product Categories (saved with the page's Save changes) ---

function ProductCategoriesSection({ businessId }: { businessId: string }) {
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const list = useDraftList<any>('product-categories', 'Product & service categories', {
    create: (c) => servicesApi.createCategory({ business_id: businessId, name: c.name }),
    remove: (c) => servicesApi.deleteCategory(c.id, businessId).then(() => undefined),
  });

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    servicesApi.getCategories(businessId).then(list.load).catch(() => list.load([])).finally(() => setLoading(false));
  }, [businessId, list.load]);

  const handleAdd = () => {
    if (!addName.trim()) return;
    list.add({ name: addName.trim() });
    setAddName('');
    setShowAdd(false);
  };

  const columns = [
    { key: 'name', header: 'Name', sortable: true, filterValue: (t: any) => t.name,
      render: (_: any, { __row: r }: TableRow) => <DraftName row={r}>{r.item.name}</DraftName> },
    {
      key: 'actions', header: '', filter: false as const,
      render: (_: any, { __row: r }: TableRow) => (
        <div style={{ textAlign: 'right' }}>
          {r.deleted ? <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); list.undo(r.key); }}>Undo</Button>
            : <button onClick={(e) => { e.stopPropagation(); list.remove(r.key); }} style={catStyles.deleteBtn} title="Delete">🗑️</button>}
        </div>
      ),
    },
  ];

  return (
    <div style={draftBox(list.dirty)}>
      <div style={catStyles.toolbar}>
        <h3 style={catStyles.sectionTitle}>Product & Service Categories<UnsavedTag dirty={list.dirty} /></h3>
        <div style={{ flex: 1 }} />
        {showAdd ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input style={catStyles.input} value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Category name" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }} />
            <Button size="sm" onClick={handleAdd}>Add</Button>
            <Button size="sm" variant="secondary" onClick={() => { setShowAdd(false); setAddName(''); }}>Cancel</Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}>Add Category</Button>
        )}
      </div>
      <Table columns={columns} data={tableRows(list.rows)} rowId={(r) => r.__row.key} loading={loading} emptyMessage="No product/service categories defined" clientSort />
    </div>
  );
}

// --- Note Categories (saved with the page's Save changes) ---

function NoteCategoriesSection({ businessId }: { businessId: string }) {
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', is_sensitive: false, customer_visible: false });
  const list = useDraftList<any>('note-categories', 'Customer note categories', {
    create: (c) => apiClient.post(`/v1/customers/note-categories?business_id=${businessId}`, { name: c.name, is_sensitive: c.is_sensitive, customer_visible: c.customer_visible }).then((res) => res.data.data),
    remove: (c) => apiClient.delete(`/v1/customers/note-categories/${c.id}?business_id=${businessId}`).then(() => undefined),
  });

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    apiClient.get(`/v1/customers/note-categories/list?business_id=${businessId}`)
      .then((res) => list.load(res.data.data || []))
      .catch(() => list.load([]))
      .finally(() => setLoading(false));
  }, [businessId, list.load]);

  const handleAdd = () => {
    if (!addForm.name.trim()) return;
    list.add({ ...addForm, name: addForm.name.trim() });
    setAddForm({ name: '', is_sensitive: false, customer_visible: false });
    setShowAdd(false);
  };

  const columns = [
    {
      key: 'name', header: 'Name', sortable: true, filterValue: (t: any) => t.name,
      render: (_: any, { __row: r }: TableRow) => (
        <DraftName row={r}>
          <span>{r.item.name}</span>
          {r.item.is_sensitive && <Badge variant="error">Sensitive</Badge>}
          {r.item.customer_visible && <Badge variant="info">Customer Visible</Badge>}
        </DraftName>
      ),
    },
    {
      key: 'actions', header: '', filter: false as const,
      render: (_: any, { __row: r }: TableRow) => (
        <div style={{ textAlign: 'right' }}>
          {r.deleted ? <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); list.undo(r.key); }}>Undo</Button>
            : <button onClick={(e) => { e.stopPropagation(); list.remove(r.key); }} style={catStyles.deleteBtn} title="Delete">🗑️</button>}
        </div>
      ),
    },
  ];

  return (
    <div style={draftBox(list.dirty)}>
      <div style={catStyles.toolbar}>
        <h3 style={catStyles.sectionTitle}>Customer Note Categories<UnsavedTag dirty={list.dirty} /></h3>
        <div style={{ flex: 1 }} />
        {showAdd ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input style={catStyles.input} value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="Category name" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={addForm.is_sensitive} onChange={(e) => setAddForm({ ...addForm, is_sensitive: e.target.checked })} style={{ width: '14px', height: '14px' }} /> Sensitive
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={addForm.customer_visible} onChange={(e) => setAddForm({ ...addForm, customer_visible: e.target.checked })} style={{ width: '14px', height: '14px' }} /> Customer Visible
            </label>
            <Button size="sm" onClick={handleAdd}>Add</Button>
            <Button size="sm" variant="secondary" onClick={() => { setShowAdd(false); setAddForm({ name: '', is_sensitive: false, customer_visible: false }); }}>Cancel</Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}>Add Category</Button>
        )}
      </div>
      <Table columns={columns} data={tableRows(list.rows)} rowId={(r) => r.__row.key} loading={loading} emptyMessage="No note categories defined" clientSort />
    </div>
  );
}

// --- Taxes Tab (saved with the page's Save changes) ---

const taxData = (t: any) => ({ name: t.name, rate: t.rate, is_default: !!t.is_default });

function TaxesTab() {
  const businessId = localStorage.getItem('business_id') || '';
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', rate: '', is_default: false });
  const list = useDraftList<any>('tax-rates', 'Tax rates', {
    create: (t) => servicesApi.createTaxCategory(businessId, taxData(t)),
    update: (t) => servicesApi.updateTaxCategory(t.id, businessId, taxData(t)),
    remove: (t) => servicesApi.deleteTaxCategory(t.id, businessId).then(() => undefined),
  });

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    servicesApi.getTaxCategories(businessId).then(list.load).catch(() => list.load([])).finally(() => setLoading(false));
  }, [businessId, list.load]);

  const openAdd = () => {
    setEditingKey(null);
    setForm({ name: '', rate: '0', is_default: false });
    setShowAdd(true);
  };

  const openEdit = (key: string, tax: any) => {
    setEditingKey(key);
    setForm({ name: tax.name, rate: String(tax.rate / 100), is_default: tax.is_default });
    setShowAdd(true);
  };

  const handleDone = () => {
    if (!form.name.trim() || !form.rate) return;
    const data = { name: form.name.trim(), rate: Math.round(parseFloat(form.rate) * 100), is_default: form.is_default };
    if (editingKey) list.edit(editingKey, data);
    else list.add(data);
    setShowAdd(false);
  };

  if (loading) return <div style={{ padding: 'var(--space-lg)', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading...</div>;

  return (
    <div style={draftBox(list.dirty)}>
      <div style={catStyles.toolbar}>
        <h3 style={catStyles.sectionTitle}>Tax Rates<UnsavedTag dirty={list.dirty} /></h3>
        <div style={{ flex: 1 }} />
        <Button size="sm" variant="secondary" onClick={openAdd}>Add Tax Rate</Button>
      </div>

      {showAdd && (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', marginBottom: 'var(--space-md)', background: 'var(--color-surface)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px auto', gap: 'var(--space-md)', alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>Name</label>
              <input style={catStyles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. IVA Standard" />
            </div>
            <div>
              <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>Rate (%)</label>
              <input type="number" step="0.01" min="0" max="100" style={catStyles.input} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="21" />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', cursor: 'pointer', paddingBottom: '4px' }}>
              <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} style={{ width: '14px', height: '14px' }} /> Default
            </label>
          </div>
          <p style={{ margin: 'var(--space-sm) 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>Saved with the page's Save changes.</p>
          <div style={{ display: 'flex', gap: '8px', marginTop: 'var(--space-md)' }}>
            <Button size="sm" onClick={handleDone}>{editingKey ? 'Done' : 'Add'}</Button>
            <Button size="sm" variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {list.rows.length === 0 && !showAdd && (
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>No tax rates defined. Add tax rates that can be assigned to services and products.</p>
      )}

      {list.rows.length > 0 && (
        <Table
          columns={[
            { key: 'name', header: 'Name', sortable: true, filterValue: (t: any) => t.name,
              render: (_: any, { __row: r }: TableRow) => <DraftName row={r} edited={!r.isNew && !r.deleted && list.changed(r, taxData)}>{r.item.name}</DraftName> },
            { key: 'rate', header: 'Rate', sortable: true, filter: 'number' as const, filterUnit: '%', filterScale: 100, filterValue: (t: any) => t.rate, filterLabel: (v: string) => `${(Number(v) / 100).toFixed(2)}%`,
              render: (_: any, { __row: r }: TableRow) => <span style={fieldMark(!r.isNew && list.changed(r, (t) => t.rate))}>{(r.item.rate / 100).toFixed(2)}%</span> },
            { key: 'is_default', header: 'Default', filterValue: (t: any) => (t.is_default ? 'Default' : ''),
              render: (_: any, { __row: r }: TableRow) => r.item.is_default ? <Badge variant="info">Default</Badge> : null },
            {
              key: 'actions', header: '', filter: false as const,
              render: (_: any, { __row: r }: TableRow) => (
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  {r.deleted ? <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); list.undo(r.key); }}>Undo</Button> : <>
                    <button onClick={(e) => { e.stopPropagation(); openEdit(r.key, r.item); }} style={catStyles.deleteBtn} title="Edit">✏️</button>
                    <button onClick={(e) => { e.stopPropagation(); list.remove(r.key); }} style={catStyles.deleteBtn} title="Delete">🗑️</button>
                  </>}
                </div>
              ),
            },
          ]}
          data={tableRows(list.rows)}
          rowId={(r) => r.__row.key}
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
  deleteBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-base)', padding: '0', borderRadius: 'var(--button-radius)', minHeight: 'var(--button-height-sm)' },
};

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', margin: 0 },
  tabBar: { display: 'flex', gap: '0', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--space-md)' },
  tab: { background: 'none', border: 'none', borderBottom: '3px solid transparent', padding: '10px 20px', fontSize: 'var(--font-size-base)', fontWeight: 500, color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)', marginBottom: '-1px' },
  tabActive: { color: 'var(--color-primary)', borderBottomColor: 'var(--color-primary)', fontWeight: 600 },
};
