import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import { apiClient } from '../api/client';
import * as servicesApi from '../api/services';
import type { Service, ServiceCategory } from '../api/services';
import { formatCurrency } from '../utils/currency';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success', draft: 'neutral', paused: 'warning', archived: 'error', inactive: 'neutral',
};

export function Services() {
  const [activeTab, setActiveTab] = useState<'services' | 'products' | 'memberships' | 'packages' | 'promotions'>('services');

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Offerings</h1>
      </div>
      <div style={styles.tabBar}>
        <button onClick={() => setActiveTab('services')} style={{ ...styles.tab, ...(activeTab === 'services' ? styles.tabActive : {}) }}>Services</button>
        <button onClick={() => setActiveTab('products')} style={{ ...styles.tab, ...(activeTab === 'products' ? styles.tabActive : {}) }}>Products</button>
        <button onClick={() => setActiveTab('memberships')} style={{ ...styles.tab, ...(activeTab === 'memberships' ? styles.tabActive : {}) }}>Memberships</button>
        <button onClick={() => setActiveTab('packages')} style={{ ...styles.tab, ...(activeTab === 'packages' ? styles.tabActive : {}) }}>Packages</button>
        <button onClick={() => setActiveTab('promotions')} style={{ ...styles.tab, ...(activeTab === 'promotions' ? styles.tabActive : {}) }}>Promotions</button>
      </div>
      {activeTab === 'services' && <ServicesTab />}
      {activeTab === 'products' && <ProductsTab />}
      {activeTab === 'memberships' && <MembershipsTab />}
      {activeTab === 'packages' && <PackagesTab />}
      {activeTab === 'promotions' && <PromotionsTab />}
    </div>
  );
}

// --- Services Tab ---

function ServicesTab() {
  const navigate = useNavigate();
  const [services, setServices] = useState<any[]>([]);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  const businessId = localStorage.getItem('business_id') || '';

  const fetchServices = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await servicesApi.getServices(businessId, {
        search: search || undefined,
        status: statusFilter || undefined,
        category_id: categoryFilter || undefined,
        page,
      });
      setServices(result.data);
      setTotalPages(result.meta?.totalPages || 1);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId, search, statusFilter, categoryFilter, page]);

  useEffect(() => { fetchServices(); }, [fetchServices]);
  useEffect(() => { if (businessId) servicesApi.getCategories(businessId).then(setCategories).catch(() => {}); }, [businessId]);
  useEffect(() => { const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300); return () => clearTimeout(t); }, [searchInput]);

  const handleQuickAction = async (action: string, svc: any) => {
    try {
      if (action === 'archive') await servicesApi.archiveService(svc.id, businessId);
      else if (action === 'pause') await servicesApi.pauseService(svc.id, businessId);
      else if (action === 'activate') await servicesApi.activateService(svc.id, businessId);
      else if (action === 'restore') await servicesApi.restoreService(svc.id, businessId);
      fetchServices();
    } catch { /* silent */ }
  };

  const columns = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'category_name', header: 'Category', render: (val: string) => val || '—' },
    { key: 'status', header: 'Status', render: (val: string) => <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>{val}</Badge> },
    { key: 'default_duration', header: 'Duration', render: (val: number) => val ? `${val} min` : '—' },
    {
      key: 'actions', header: '',
      render: (_: any, row: any) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          {row.status === 'draft' && <ActionBtn label="Activate" onClick={() => handleQuickAction('activate', row)} />}
          {row.status === 'active' && <ActionBtn label="Pause" onClick={() => handleQuickAction('pause', row)} />}
          {row.status === 'paused' && <ActionBtn label="Activate" onClick={() => handleQuickAction('activate', row)} />}
          {row.status !== 'archived' && <ActionBtn label="Archive" onClick={() => handleQuickAction('archive', row)} />}
          {row.status === 'archived' && <ActionBtn label="Restore" onClick={() => handleQuickAction('restore', row)} />}
        </div>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
        <Button variant="secondary" onClick={() => navigate('/offers/categories')}>Categories</Button>
        <Button variant="secondary" onClick={() => setShowCreate(true)}>Add Service</Button>
      </div>
      <div style={styles.toolbar}>
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Search services..." />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={styles.select}>
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="archived">Archived</option>
        </select>
        <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }} style={styles.select}>
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <Table columns={columns} data={services} loading={loading} onRowClick={(row) => navigate(`/offers/services/${row.id}`)} page={page} totalPages={totalPages} onPageChange={setPage} emptyMessage="No services found" mobileCardMode />
      {showCreate && <CreateServiceModal businessId={businessId} categories={categories} onClose={() => setShowCreate(false)} onCreated={(svc) => { setShowCreate(false); navigate(`/offers/services/${svc.id}`); }} />}
    </>
  );
}

// --- Products Tab ---

function ProductsTab() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  const businessId = localStorage.getItem('business_id') || '';

  const fetchProducts = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ business_id: businessId });
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (categoryFilter) params.set('category_id', categoryFilter);
      params.set('page', String(page));
      const res = await apiClient.get(`/v1/merchandise?${params}`);
      setProducts(res.data.data || []);
      setTotalPages(res.data.meta?.totalPages || 1);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId, search, statusFilter, categoryFilter, page]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);
  useEffect(() => { if (businessId) servicesApi.getCategories(businessId).then(setCategories).catch(() => {}); }, [businessId]);
  useEffect(() => { const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300); return () => clearTimeout(t); }, [searchInput]);

  const handleQuickAction = async (action: string, item: any) => {
    try {
      if (action === 'archive') await apiClient.put(`/v1/merchandise/${item.id}/archive?business_id=${businessId}`);
      else if (action === 'pause') await apiClient.put(`/v1/merchandise/${item.id}/pause?business_id=${businessId}`);
      else if (action === 'activate') await apiClient.put(`/v1/merchandise/${item.id}/activate?business_id=${businessId}`);
      else if (action === 'restore') await apiClient.put(`/v1/merchandise/${item.id}/restore?business_id=${businessId}`);
      fetchProducts();
    } catch { /* silent */ }
  };

  const columns = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'category_name', header: 'Category', render: (val: string) => val || '—' },
    { key: 'status', header: 'Status', render: (val: string) => <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>{val}</Badge> },
    { key: 'price', header: 'Price', render: (val: number) => val != null ? formatCurrency(val) : '—' },
    { key: 'sku', header: 'SKU', render: (val: string) => val || '—' },
    {
      key: 'actions', header: '',
      render: (_: any, row: any) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          {row.status === 'active' && <ActionBtn label="Pause" onClick={() => handleQuickAction('pause', row)} />}
          {row.status === 'paused' && <ActionBtn label="Activate" onClick={() => handleQuickAction('activate', row)} />}
          {row.status !== 'archived' && <ActionBtn label="Archive" onClick={() => handleQuickAction('archive', row)} />}
          {row.status === 'archived' && <ActionBtn label="Restore" onClick={() => handleQuickAction('restore', row)} />}
        </div>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
        <Button variant="secondary" onClick={() => navigate('/offers/categories')}>Categories</Button>
        <Button variant="secondary" onClick={() => setShowCreate(true)}>Add Product</Button>
      </div>
      <div style={styles.toolbar}>
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Search products..." />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={styles.select}>
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="archived">Archived</option>
        </select>
        <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }} style={styles.select}>
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <Table columns={columns} data={products} loading={loading} onRowClick={(row) => navigate(`/offers/merchandise/${row.id}`)} page={page} totalPages={totalPages} onPageChange={setPage} emptyMessage="No products found" mobileCardMode />
      {showCreate && <CreateProductModal businessId={businessId} categories={categories} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); fetchProducts(); }} />}
    </>
  );
}
// --- Memberships Tab ---
// --- Memberships Tab ---

// --- Create Service Modal ---

function CreateServiceModal({ businessId, categories, onClose, onCreated }: { businessId: string; categories: ServiceCategory[]; onClose: () => void; onCreated: (s: Service) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    description: '',
    short_description: '',
    booking_type: 'individual',
    default_duration: 60,
    buffer_before: 0,
    buffer_after: 0,
    max_capacity: 1,
    category_id: '',
    online_booking_enabled: true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.category_id) { setError('Name and category are required'); return; }
    setLoading(true);
    setError('');
    try {
      const service = await servicesApi.createService({ ...form, business_id: businessId });
      onCreated(service);
    } catch (err: any) { setError(err.response?.data?.error || 'Failed to create service'); }
    finally { setLoading(false); }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>Add Service</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        {error && <p style={styles.error}>{error}</p>}
        <form onSubmit={handleSubmit} style={styles.formGrid}>
          <div style={styles.formGroup}><label style={styles.label}>Name *</label><input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div style={styles.formGroup}><label style={styles.label}>Category *</label><select style={styles.input} value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} required><option value="">Select...</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div style={styles.formGroup}><label style={styles.label}>Booking Type</label><select style={styles.input} value={form.booking_type} onChange={(e) => setForm({ ...form, booking_type: e.target.value })}><option value="individual">Individual</option><option value="shared">Shared</option><option value="group">Group</option><option value="resource">Resource</option></select></div>
          <div style={styles.formGroup}><label style={styles.label}>Duration (min)</label><input style={styles.input} type="number" min={5} value={form.default_duration} onChange={(e) => setForm({ ...form, default_duration: Number(e.target.value) })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>Buffer Before (min)</label><input style={styles.input} type="number" min={0} value={form.buffer_before} onChange={(e) => setForm({ ...form, buffer_before: Number(e.target.value) })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>Buffer After (min)</label><input style={styles.input} type="number" min={0} value={form.buffer_after} onChange={(e) => setForm({ ...form, buffer_after: Number(e.target.value) })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>Max Capacity</label><input style={styles.input} type="number" min={1} value={form.max_capacity} onChange={(e) => setForm({ ...form, max_capacity: Number(e.target.value) })} /></div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}><label style={styles.label}>Short Description</label><input style={styles.input} value={form.short_description} onChange={(e) => setForm({ ...form, short_description: e.target.value })} /></div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}><label style={styles.label}>Description</label><textarea style={{ ...styles.input, minHeight: '60px' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--color-text)', gridColumn: '1 / -1' }}><input type="checkbox" checked={form.online_booking_enabled} onChange={(e) => setForm({ ...form, online_booking_enabled: e.target.checked })} style={{ width: '16px', height: '16px' }} />Enable online booking</label>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit" loading={loading}>Create Service</Button></div>
        </form>
      </div>
    </div>
  );
}

// --- Create Product Modal ---

function CreateProductModal({ businessId, categories, onClose, onCreated }: { businessId: string; categories: ServiceCategory[]; onClose: () => void; onCreated: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [priceDisplay, setPriceDisplay] = useState('0.00');
  const [form, setForm] = useState({ name: '', description: '', short_description: '', category_id: '', sku: '', price: 0 });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) { setError('Name is required'); return; }
    setLoading(true);
    setError('');
    try {
      await apiClient.post('/v1/merchandise', { business_id: businessId, name: form.name, description: form.description || undefined, short_description: form.short_description || undefined, category_id: form.category_id || undefined, sku: form.sku || undefined, price: form.price });
      onCreated();
    } catch (err: any) { setError(err.response?.data?.error || 'Failed to create product'); }
    finally { setLoading(false); }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>Add Product</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        {error && <p style={styles.error}>{error}</p>}
        <form onSubmit={handleSubmit} style={styles.formGrid}>
          <div style={styles.formGroup}><label style={styles.label}>Name *</label><input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div style={styles.formGroup}><label style={styles.label}>Category</label><select style={styles.input} value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}><option value="">None</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div style={styles.formGroup}><label style={styles.label}>Price *</label><input style={styles.input} type="number" step="0.01" min="0" value={priceDisplay} onChange={(e) => setPriceDisplay(e.target.value)} onBlur={() => { const cents = Math.round(parseFloat(priceDisplay || '0') * 100); setForm({ ...form, price: cents }); setPriceDisplay((cents / 100).toFixed(2)); }} /></div>
          <div style={styles.formGroup}><label style={styles.label}>SKU</label><input style={styles.input} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="Optional" /></div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}><label style={styles.label}>Short Description</label><input style={styles.input} value={form.short_description} onChange={(e) => setForm({ ...form, short_description: e.target.value })} /></div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}><label style={styles.label}>Description</label><textarea style={{ ...styles.input, minHeight: '60px' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit" loading={loading}>Create Product</Button></div>
        </form>
      </div>
    </div>
  );
}

// --- Memberships Tab ---

function MembershipsTab() {
  const navigate = useNavigate();
  const businessId = localStorage.getItem('business_id') || '';
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchPlans = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await apiClient.get(`/v1/memberships/plans?business_id=${businessId}`);
      setPlans(res.data.data || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId]);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  const handleQuickAction = async (action: string, plan: any) => {
    try {
      await apiClient.put(`/v1/memberships/plans/${plan.id}/${action}?business_id=${businessId}`);
      fetchPlans();
    } catch { /* silent */ }
  };

  const columns = [
    { key: 'name', header: 'Name', sortable: true },
    {
      key: 'billing_frequency', header: 'Billing',
      render: (val: string) => val ? val.charAt(0).toUpperCase() + val.slice(1) : '—',
    },
    {
      key: 'price', header: 'Price',
      render: (val: number) => formatCurrency(val),
    },
    {
      key: 'status', header: 'Status',
      render: (val: string) => <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>{val}</Badge>,
    },
    {
      key: 'active_enrollments', header: 'Enrolled',
      render: (val: number) => val || 0,
    },
    {
      key: 'actions', header: '',
      render: (_: any, row: any) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          {row.status === 'active' && <ActionBtn label="Pause" onClick={() => handleQuickAction('pause', row)} />}
          {(row.status === 'paused' || row.status === 'draft') && <ActionBtn label="Activate" onClick={() => handleQuickAction('activate', row)} />}
          {row.status !== 'archived' && <ActionBtn label="Archive" onClick={() => handleQuickAction('archive', row)} />}
        </div>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-md)' }}>
        <Button variant="secondary" onClick={() => setShowCreate(true)}>Add Membership</Button>
      </div>

      <Table
        columns={columns}
        data={plans}
        loading={loading}
        onRowClick={(row) => navigate(`/products/memberships/${row.id}`)}
        emptyMessage="No membership plans defined"
        mobileCardMode
      />

      {showCreate && (
        <CreateMembershipModal
          businessId={businessId}
          onClose={() => setShowCreate(false)}
          onCreated={(plan) => { setShowCreate(false); navigate(`/offers/memberships/${plan.id}`); }}
        />
      )}
    </>
  );
}

function CreateMembershipModal({ businessId, onClose, onCreated }: { businessId: string; onClose: () => void; onCreated: (plan: any) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [priceDisplay, setPriceDisplay] = useState('0.00');
  const [form, setForm] = useState({
    name: '',
    description: '',
    billing_frequency: 'monthly',
    price: 0,
    trial_days: 0,
    discount_services_pct: 0,
    discount_merchandise_pct: 0,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) { setError('Name is required'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.post('/v1/memberships/plans', { ...form, business_id: businessId });
      onCreated(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create membership plan');
    } finally { setLoading(false); }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>Add Membership Plan</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        {error && <p style={styles.error}>{error}</p>}
        <form onSubmit={handleSubmit} style={styles.formGrid}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Name *</label>
            <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Billing Frequency *</label>
            <select style={styles.input} value={form.billing_frequency} onChange={(e) => setForm({ ...form, billing_frequency: e.target.value })}>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annually">Annually</option>
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Price per Period *</label>
            <input style={styles.input} type="number" step="0.01" min="0" value={priceDisplay}
              onChange={(e) => setPriceDisplay(e.target.value)}
              onBlur={() => { const cents = Math.round(parseFloat(priceDisplay || '0') * 100); setForm({ ...form, price: cents }); setPriceDisplay((cents / 100).toFixed(2)); }}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Trial Days</label>
            <input style={styles.input} type="number" min={0} value={form.trial_days} onChange={(e) => setForm({ ...form, trial_days: Number(e.target.value) })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Discount on Services (%)</label>
            <input style={styles.input} type="number" min={0} max={100} value={form.discount_services_pct} onChange={(e) => setForm({ ...form, discount_services_pct: Number(e.target.value) })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Discount on Products (%)</label>
            <input style={styles.input} type="number" min={0} max={100} value={form.discount_merchandise_pct} onChange={(e) => setForm({ ...form, discount_merchandise_pct: Number(e.target.value) })} />
          </div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
            <label style={styles.label}>Description</label>
            <textarea style={{ ...styles.input, minHeight: '60px', resize: 'vertical', maxWidth: '100%' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading}>Create Plan</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Packages Tab (placeholder) ---

function PackagesTab() {
  return (
    <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--color-text-secondary)' }}>
      <p style={{ fontSize: '16px', marginBottom: '8px' }}>Packages</p>
      <p style={{ fontSize: '14px' }}>Bundled offerings that combine services and products at a fixed price will be managed here.</p>
    </div>
  );
}

// --- Promotions Tab ---

const PROMO_TYPE_LABELS: Record<string, string> = {
  discount_percentage: '% Off',
  discount_fixed: '$ Off',
  price_override: 'Fixed Price',
  premium_percentage: '% Premium',
  premium_fixed: '$ Premium',
};

function PromotionsTab() {
  const navigate = useNavigate();
  const businessId = localStorage.getItem('business_id') || '';
  const [promotions, setPromotions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchPromotions = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await apiClient.get(`/v1/promotions?business_id=${businessId}`);
      setPromotions(res.data.data || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId]);

  useEffect(() => { fetchPromotions(); }, [fetchPromotions]);

  const handleQuickAction = async (action: string, promo: any) => {
    try {
      await apiClient.put(`/v1/promotions/${promo.id}/${action}?business_id=${businessId}`);
      fetchPromotions();
    } catch { /* silent */ }
  };

  const columns = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'type', header: 'Type', render: (val: string) => PROMO_TYPE_LABELS[val] || val },
    {
      key: 'value', header: 'Value',
      render: (_: any, row: any) => {
        if (row.type.includes('percentage')) return `${row.value}%`;
        return formatCurrency(row.value);
      },
    },
    { key: 'promo_code', header: 'Code', render: (val: string) => val || '—' },
    { key: 'status', header: 'Status', render: (val: string) => <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>{val}</Badge> },
    {
      key: 'date_range', header: 'Active Period',
      render: (_: any, row: any) => {
        if (!row.date_from && !row.date_to) return 'Always';
        const from = row.date_from ? new Date(row.date_from).toLocaleDateString() : '';
        const to = row.date_to ? new Date(row.date_to).toLocaleDateString() : '';
        return `${from} – ${to}`;
      },
    },
    {
      key: 'actions', header: '',
      render: (_: any, row: any) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          {row.status === 'active' && <ActionBtn label="Pause" onClick={() => handleQuickAction('pause', row)} />}
          {(row.status === 'paused' || row.status === 'expired') && <ActionBtn label="Activate" onClick={() => handleQuickAction('activate', row)} />}
          {row.status !== 'archived' && <ActionBtn label="Archive" onClick={() => handleQuickAction('archive', row)} />}
        </div>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-md)' }}>
        <Button variant="secondary" onClick={() => setShowCreate(true)}>Add Promotion</Button>
      </div>

      <Table
        columns={columns}
        data={promotions}
        loading={loading}
        onRowClick={(row) => navigate(`/offers/promotions/${row.id}`)}
        emptyMessage="No promotions defined"
        mobileCardMode
      />

      {showCreate && (
        <CreatePromotionModal
          businessId={businessId}
          onClose={() => setShowCreate(false)}
          onCreated={(promo) => { setShowCreate(false); navigate(`/offers/promotions/${promo.id}`); }}
        />
      )}
    </>
  );
}

function CreatePromotionModal({ businessId, onClose, onCreated }: { businessId: string; onClose: () => void; onCreated: (promo: any) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    description: '',
    type: 'discount_percentage',
    value: 0,
    promo_code: '',
    date_from: '',
    date_to: '',
    max_redemptions: '',
    max_per_customer: '',
    stackable: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) { setError('Name is required'); return; }
    if (!form.value) { setError('Value is required'); return; }
    setLoading(true);
    setError('');
    try {
      const data: any = {
        business_id: businessId,
        name: form.name,
        description: form.description || undefined,
        type: form.type,
        value: form.type.includes('percentage') ? form.value : Math.round(form.value * 100),
        promo_code: form.promo_code || undefined,
        date_from: form.date_from || undefined,
        date_to: form.date_to || undefined,
        max_redemptions: form.max_redemptions ? parseInt(form.max_redemptions) : undefined,
        max_per_customer: form.max_per_customer ? parseInt(form.max_per_customer) : undefined,
        stackable: form.stackable,
      };
      const res = await apiClient.post('/v1/promotions', data);
      onCreated(res.data.data);
    } catch (err: any) { setError(err.response?.data?.error || 'Failed to create promotion'); }
    finally { setLoading(false); }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>Add Promotion</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        {error && <p style={styles.error}>{error}</p>}
        <form onSubmit={handleSubmit} style={styles.formGrid}>
          <div style={styles.formGroup}><label style={styles.label}>Name *</label><input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Type *</label>
            <select style={styles.input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="discount_percentage">Percentage Discount</option>
              <option value="discount_fixed">Fixed Amount Discount</option>
              <option value="price_override">Price Override</option>
              <option value="premium_percentage">Percentage Premium</option>
              <option value="premium_fixed">Fixed Amount Premium</option>
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{form.type.includes('percentage') ? 'Percentage *' : 'Amount *'}</label>
            <input style={styles.input} type="number" step={form.type.includes('percentage') ? '1' : '0.01'} min="0" value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} required />
          </div>
          <div style={styles.formGroup}><label style={styles.label}>Promo Code</label><input style={styles.input} value={form.promo_code} onChange={(e) => setForm({ ...form, promo_code: e.target.value.toUpperCase() })} placeholder="Optional" /></div>
          <div style={styles.formGroup}><label style={styles.label}>Start Date</label><input style={styles.input} type="date" value={form.date_from} onChange={(e) => setForm({ ...form, date_from: e.target.value })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>End Date</label><input style={styles.input} type="date" value={form.date_to} onChange={(e) => setForm({ ...form, date_to: e.target.value })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>Max Redemptions</label><input style={styles.input} type="number" min="1" value={form.max_redemptions} onChange={(e) => setForm({ ...form, max_redemptions: e.target.value })} placeholder="Unlimited" /></div>
          <div style={styles.formGroup}><label style={styles.label}>Max per Customer</label><input style={styles.input} type="number" min="1" value={form.max_per_customer} onChange={(e) => setForm({ ...form, max_per_customer: e.target.value })} placeholder="Unlimited" /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--color-text)', gridColumn: '1 / -1' }}>
            <input type="checkbox" checked={form.stackable} onChange={(e) => setForm({ ...form, stackable: e.target.checked })} style={{ width: '16px', height: '16px' }} />
            Stackable (can combine with other promotions)
          </label>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}><label style={styles.label}>Description</label><textarea style={{ ...styles.input, minHeight: '60px', resize: 'vertical', maxWidth: '100%' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit" loading={loading}>Create Promotion</Button></div>
        </form>
      </div>
    </div>
  );
}

// --- Utility ---

function ActionBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} style={styles.actionBtn}>
      {label}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  tabBar: { display: 'flex', gap: '0', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--space-lg)' },
  tab: { background: 'none', border: 'none', borderBottom: '2px solid transparent', padding: '10px 20px', fontSize: '14px', fontWeight: 500, color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  tabActive: { color: 'var(--color-primary)', borderBottomColor: 'var(--color-primary)' },
  toolbar: { display: 'flex', gap: 'var(--space-md)', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap' as const },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  actionBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)', minWidth: '60px', textAlign: 'center' as const },
  overlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-background)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '600px', maxHeight: '85vh', overflow: 'auto', border: '1px solid var(--color-border)', boxShadow: '0 10px 25px rgba(0,0,0,0.3)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--color-text)' },
  closeBtn: { background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--color-text-secondary)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' },
  input: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: '14px', width: '100%', boxSizing: 'border-box' as const, fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)' },
  error: { color: 'var(--color-error)', fontSize: '13px', margin: '0 0 8px 0' },
};
