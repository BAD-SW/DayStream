import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import { apiClient } from '../api/client';
import * as servicesApi from '../api/services';
import type { Service, ServiceCategory } from '../api/services';
import { formatCurrency } from '../utils/currency';
import { formatPercent } from '../utils/format';
import { formatDateOnly } from '../utils/date';
import { useTranslation } from 'react-i18next';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success', draft: 'neutral', paused: 'warning', archived: 'error', inactive: 'neutral',
};

const VALID_TABS = ['services', 'products', 'memberships', 'packages', 'promotions'] as const;
type Tab = typeof VALID_TABS[number];

export function Services() {
  const { t } = useTranslation('offerings');
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as Tab | null;
  const [activeTab, setActiveTab] = useState<Tab>(tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'services');

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>{t('offerings.title')}</h1>
      </div>
      <div style={styles.tabBar}>
        {(['services', 'products', 'memberships', 'packages', 'promotions'] as const).map((tab) => {
          const isActive = activeTab === tab;
          const labels: Record<string, string> = { services: t('offerings.tab.services'), products: t('offerings.tab.products'), memberships: t('offerings.tab.memberships'), packages: t('offerings.tab.packages'), promotions: t('offerings.tab.promotions') };
          return (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{
                background: 'none', border: 'none', outline: 'none',
                borderBottom: isActive ? '3px solid var(--color-primary)' : '3px solid transparent',
                padding: '10px 20px', fontSize: 'var(--font-size-base)',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                cursor: 'pointer', fontFamily: 'var(--font-family)', marginBottom: '-1px',
              }}>
              {labels[tab]}
            </button>
          );
        })}
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
  const { t } = useTranslation('offerings');
  const navigate = useNavigate();
  const [services, setServices] = useState<any[]>([]);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const businessId = localStorage.getItem('business_id') || '';

  // Every service (100 per call until all are in): the column filters work on all of them
  // (David, 2026-11-02). The search box stays — it also looks in the descriptions.
  const fetchServices = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const rows: any[] = [];
      for (let p = 1; ; p++) {
        const result = await servicesApi.getServices(businessId, { search: search || undefined, page: p, limit: 100 });
        rows.push(...result.data);
        if (result.data.length < 100 || p >= (result.meta?.totalPages || 1)) break;
      }
      setServices(rows);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId, search]);

  useEffect(() => { fetchServices(); }, [fetchServices]);
  useEffect(() => { if (businessId) servicesApi.getCategories(businessId).then(setCategories).catch(() => {}); }, [businessId]);
  useEffect(() => { const t = setTimeout(() => setSearch(searchInput), 300); return () => clearTimeout(t); }, [searchInput]);

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
    { key: 'name', header: t('shared.name'), sortable: true },
    { key: 'category_name', header: t('shared.category'), sortable: true, render: (val: string) => val || '—' },
    { key: 'default_duration', header: t('shared.duration'), sortable: true, filter: 'number' as const, filterUnit: t('services.unitMin'), filterLabel: (v: any) => (v ? t('services.minutes', { value: v }) : '—'), render: (val: number) => val ? t('services.minutes', { value: val }) : '—' },
    { key: 'status', header: t('shared.status'), sortable: true, render: (val: string) => <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>{t(`shared.status.${val}`, { defaultValue: val })}</Badge> },
    {
      key: 'actions', header: '', filter: false as const,
      render: (_: any, row: any) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          {row.status === 'draft' && <ActionBtn label={t('shared.activate')} onClick={() => handleQuickAction('activate', row)} />}
          {row.status === 'active' && <ActionBtn label={t('shared.pause')} onClick={() => handleQuickAction('pause', row)} />}
          {row.status === 'paused' && <ActionBtn label={t('shared.activate')} onClick={() => handleQuickAction('activate', row)} />}
          {row.status !== 'archived' && <ActionBtn label={t('shared.archive')} onClick={() => handleQuickAction('archive', row)} />}
          {row.status === 'archived' && <ActionBtn label={t('shared.restore')} onClick={() => handleQuickAction('restore', row)} />}
        </div>
      ),
    },
  ];

  return (
    <>
      <div style={styles.toolbar}>
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder={t('services.search')} />
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={() => setShowCreate(true)}>{t('services.add')}</Button>
      </div>
      <Table columns={columns} data={services} loading={loading} onRowClick={(row) => navigate(`/offers/services/${row.id}`)} emptyMessage={t('services.empty')} mobileCardMode clientSort />
      {showCreate && <CreateServiceModal businessId={businessId} categories={categories} onClose={() => setShowCreate(false)} onCreated={(svc) => { setShowCreate(false); navigate(`/offers/services/${svc.id}`); }} />}
    </>
  );
}

// --- Products Tab ---

function ProductsTab() {
  const { t } = useTranslation('offerings');
  const navigate = useNavigate();
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const businessId = localStorage.getItem('business_id') || '';

  // Every product (100 per call until all are in): the column filters work on all of them
  // (David, 2026-11-02).
  const fetchProducts = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const rows: any[] = [];
      for (let p = 1; ; p++) {
        const params = new URLSearchParams({ business_id: businessId, page: String(p), limit: '100' });
        if (search) params.set('search', search);
        const res = await apiClient.get(`/v1/merchandise?${params}`);
        const data = res.data.data || [];
        rows.push(...data);
        if (data.length < 100 || p >= (res.data.meta?.totalPages || 1)) break;
      }
      setProducts(rows);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId, search]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);
  useEffect(() => { if (businessId) servicesApi.getCategories(businessId).then(setCategories).catch(() => {}); }, [businessId]);
  useEffect(() => { const t = setTimeout(() => setSearch(searchInput), 300); return () => clearTimeout(t); }, [searchInput]);

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
    { key: 'name', header: t('shared.name'), sortable: true },
    { key: 'category_name', header: t('shared.category'), sortable: true, render: (val: string) => val || '—' },
    { key: 'price', header: t('shared.price'), sortable: true, filter: 'amount' as const, filterLabel: (v: any) => (v != null ? formatCurrency(v) : '—'), render: (val: number) => val != null ? formatCurrency(val) : '—' },
    { key: 'sku', header: t('shared.sku'), sortable: true, render: (val: string) => val || '—' },
    { key: 'status', header: t('shared.status'), sortable: true, render: (val: string) => <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>{t(`shared.status.${val}`, { defaultValue: val })}</Badge> },
    {
      key: 'actions', header: '', filter: false as const,
      render: (_: any, row: any) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          {row.status === 'active' && <ActionBtn label={t('shared.pause')} onClick={() => handleQuickAction('pause', row)} />}
          {row.status === 'paused' && <ActionBtn label={t('shared.activate')} onClick={() => handleQuickAction('activate', row)} />}
          {row.status !== 'archived' && <ActionBtn label={t('shared.archive')} onClick={() => handleQuickAction('archive', row)} />}
          {row.status === 'archived' && <ActionBtn label={t('shared.restore')} onClick={() => handleQuickAction('restore', row)} />}
        </div>
      ),
    },
  ];

  return (
    <>
      <div style={styles.toolbar}>
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder={t('products.search')} />
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={() => setShowCreate(true)}>{t('products.add')}</Button>
      </div>
      <Table columns={columns} data={products} loading={loading} onRowClick={(row) => navigate(`/offers/merchandise/${row.id}`)} emptyMessage={t('products.empty')} mobileCardMode clientSort />
      {showCreate && <CreateProductModal businessId={businessId} categories={categories} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); fetchProducts(); }} />}
    </>
  );
}
// --- Memberships Tab ---
// --- Memberships Tab ---

// --- Create Service Modal ---

function CreateServiceModal({ businessId, categories, onClose, onCreated }: { businessId: string; categories: ServiceCategory[]; onClose: () => void; onCreated: (s: Service) => void }) {
  const { t } = useTranslation('offerings');
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
    if (!form.name || !form.category_id) { setError(t('services.nameCategoryRequired')); return; }
    setLoading(true);
    setError('');
    try {
      const service = await servicesApi.createService({ ...form, business_id: businessId });
      onCreated(service);
    } catch (err: any) { setError(err.response?.data?.error || t('services.createFailed')); }
    finally { setLoading(false); }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>{t('services.add')}</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        {error && <p style={styles.error}>{error}</p>}
        <form onSubmit={handleSubmit} style={styles.formGrid}>
          <div style={styles.formGroup}><label style={styles.label}>{t('shared.nameRequired')}</label><input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div style={styles.formGroup}><label style={styles.label}>{t('shared.categoryRequired')}</label><select style={styles.input} value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} required><option value="">{t('shared.select')}</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div style={styles.formGroup}><label style={styles.label}>{t('shared.bookingType')}</label><select style={styles.input} value={form.booking_type} onChange={(e) => setForm({ ...form, booking_type: e.target.value })}><option value="individual">{t('shared.bookingType.individual')}</option><option value="shared">{t('shared.bookingType.shared')}</option><option value="group">{t('shared.bookingType.group')}</option><option value="resource">{t('shared.bookingType.resource')}</option></select></div>
          <div style={styles.formGroup}><label style={styles.label}>{t('services.durationMin')}</label><input style={styles.input} type="number" min={5} value={form.default_duration} onChange={(e) => setForm({ ...form, default_duration: Number(e.target.value) })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>{t('services.bufferBefore')}</label><input style={styles.input} type="number" min={0} value={form.buffer_before} onChange={(e) => setForm({ ...form, buffer_before: Number(e.target.value) })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>{t('services.durationBuffer.after')}</label><input style={styles.input} type="number" min={0} value={form.buffer_after} onChange={(e) => setForm({ ...form, buffer_after: Number(e.target.value) })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>{t('services.maxCapacity')}</label><input style={styles.input} type="number" min={1} value={form.max_capacity} onChange={(e) => setForm({ ...form, max_capacity: Number(e.target.value) })} /></div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}><label style={styles.label}>{t('shared.shortDescription')}</label><input style={styles.input} value={form.short_description} onChange={(e) => setForm({ ...form, short_description: e.target.value })} /></div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}><label style={styles.label}>{t('shared.description')}</label><textarea style={{ ...styles.input, minHeight: '60px' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', gridColumn: '1 / -1' }}><input type="checkbox" checked={form.online_booking_enabled} onChange={(e) => setForm({ ...form, online_booking_enabled: e.target.checked })} style={{ width: '16px', height: '16px' }} />{t('shared.onlineBooking')}</label>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}><Button variant="secondary" type="button" onClick={onClose}>{t('common:cancel')}</Button><Button type="submit" loading={loading}>{t('services.create')}</Button></div>
        </form>
      </div>
    </div>
  );
}

// --- Create Product Modal ---

function CreateProductModal({ businessId, categories, onClose, onCreated }: { businessId: string; categories: ServiceCategory[]; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation('offerings');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [priceDisplay, setPriceDisplay] = useState('0.00');
  const [form, setForm] = useState({ name: '', description: '', short_description: '', category_id: '', sku: '', price: 0 });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) { setError(t('products.nameRequiredMsg')); return; }
    setLoading(true);
    setError('');
    try {
      await apiClient.post('/v1/merchandise', { business_id: businessId, name: form.name, description: form.description || undefined, short_description: form.short_description || undefined, category_id: form.category_id || undefined, sku: form.sku || undefined, price: form.price });
      onCreated();
    } catch (err: any) { setError(err.response?.data?.error || t('products.createFailed')); }
    finally { setLoading(false); }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>{t('products.add')}</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        {error && <p style={styles.error}>{error}</p>}
        <form onSubmit={handleSubmit} style={styles.formGrid}>
          <div style={styles.formGroup}><label style={styles.label}>{t('shared.nameRequired')}</label><input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div style={styles.formGroup}><label style={styles.label}>{t('shared.category')}</label><select style={styles.input} value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}><option value="">{t('shared.none')}</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div style={styles.formGroup}><label style={styles.label}>{t('shared.priceRequired')}</label><input style={styles.input} type="number" step="0.01" min="0" value={priceDisplay} onChange={(e) => setPriceDisplay(e.target.value)} onBlur={() => { const cents = Math.round(parseFloat(priceDisplay || '0') * 100); setForm({ ...form, price: cents }); setPriceDisplay((cents / 100).toFixed(2)); }} /></div>
          <div style={styles.formGroup}><label style={styles.label}>{t('shared.sku')}</label><input style={styles.input} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder={t('products.optional')} /></div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}><label style={styles.label}>{t('shared.shortDescription')}</label><input style={styles.input} value={form.short_description} onChange={(e) => setForm({ ...form, short_description: e.target.value })} /></div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}><label style={styles.label}>{t('shared.description')}</label><textarea style={{ ...styles.input, minHeight: '60px' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}><Button variant="secondary" type="button" onClick={onClose}>{t('common:cancel')}</Button><Button type="submit" loading={loading}>{t('products.create')}</Button></div>
        </form>
      </div>
    </div>
  );
}

// --- Memberships Tab ---

function MembershipsTab() {
  const { t } = useTranslation('offerings');
  const navigate = useNavigate();
  const businessId = localStorage.getItem('business_id') || '';
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => { const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300); return () => clearTimeout(t); }, [searchInput]);

  const fetchPlans = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await apiClient.get(`/v1/memberships/plans?business_id=${businessId}&page=${page}&limit=20${statusFilter ? `&status=${statusFilter}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`);
      setPlans(res.data.data || []);
      const meta = res.data.meta || {};
      setTotalPages(meta.totalPages || Math.ceil((meta.total || 0) / 20) || 1);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId, page, statusFilter, search]);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  const handleQuickAction = async (action: string, plan: any) => {
    try {
      await apiClient.put(`/v1/memberships/plans/${plan.id}/${action}?business_id=${businessId}`);
      fetchPlans();
    } catch { /* silent */ }
  };

  const columns = [
    { key: 'name', header: t('shared.name'), sortable: true },
    {
      key: 'billing_frequency', header: t('memberships.billing'), sortable: true,
      render: (val: string) => val ? t(`shared.billing.${val}`, { defaultValue: val.charAt(0).toUpperCase() + val.slice(1) }) : '—',
    },
    {
      key: 'price', header: t('shared.price'), sortable: true, filter: 'amount' as const,
      render: (val: number) => formatCurrency(val),
    },
    {
      key: 'active_enrollments', header: t('memberships.enrolled'), sortable: true,
      render: (val: number) => val || 0,
    },
    {
      key: 'status', header: t('shared.status'), sortable: true,
      render: (val: string) => <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>{t(`shared.status.${val}`, { defaultValue: val })}</Badge>,
    },
    {
      key: 'actions', header: '', filter: false as const,
      render: (_: any, row: any) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          {row.status === 'active' && <ActionBtn label={t('shared.pause')} onClick={() => handleQuickAction('pause', row)} />}
          {(row.status === 'paused' || row.status === 'draft') && <ActionBtn label={t('shared.activate')} onClick={() => handleQuickAction('activate', row)} />}
          {row.status !== 'archived' && <ActionBtn label={t('shared.archive')} onClick={() => handleQuickAction('archive', row)} />}
        </div>
      ),
    },
  ];

  return (
    <>
      <div style={styles.toolbar}>
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder={t('memberships.search')} />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={styles.select}>
          <option value="">{t('shared.allStatuses')}</option>
          <option value="active">{t('shared.option.active')}</option>
          <option value="paused">{t('shared.option.paused')}</option>
          <option value="draft">{t('shared.option.draft')}</option>
          <option value="archived">{t('shared.option.archived')}</option>
        </select>
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={() => setShowCreate(true)}>{t('memberships.add')}</Button>
      </div>

      <Table
        columns={columns}
        data={plans}
        loading={loading}
        onRowClick={(row) => navigate(`/offers/memberships/${row.id}`)}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        emptyMessage={t('memberships.empty')}
        mobileCardMode
        clientSort
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
  const { t } = useTranslation('offerings');
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
    if (!form.name) { setError(t('products.nameRequiredMsg')); return; }
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.post('/v1/memberships/plans', { ...form, business_id: businessId });
      onCreated(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || t('memberships.createFailed'));
    } finally { setLoading(false); }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>{t('memberships.addPlan')}</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        {error && <p style={styles.error}>{error}</p>}
        <form onSubmit={handleSubmit} style={styles.formGrid}>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('shared.nameRequired')}</label>
            <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('memberships.billingFrequency')}</label>
            <select style={styles.input} value={form.billing_frequency} onChange={(e) => setForm({ ...form, billing_frequency: e.target.value })}>
              <option value="weekly">{t('shared.billing.weekly')}</option>
              <option value="biweekly">{t('shared.billing.biweekly')}</option>
              <option value="monthly">{t('shared.billing.monthly')}</option>
              <option value="quarterly">{t('shared.billing.quarterly')}</option>
              <option value="annually">{t('shared.billing.annually')}</option>
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('memberships.pricePerPeriod')}</label>
            <input style={styles.input} type="number" step="0.01" min="0" value={priceDisplay}
              onChange={(e) => setPriceDisplay(e.target.value)}
              onBlur={() => { const cents = Math.round(parseFloat(priceDisplay || '0') * 100); setForm({ ...form, price: cents }); setPriceDisplay((cents / 100).toFixed(2)); }}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('memberships.trialDays')}</label>
            <input style={styles.input} type="number" min={0} value={form.trial_days} onChange={(e) => setForm({ ...form, trial_days: Number(e.target.value) })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('memberships.discountServices')}</label>
            <input style={styles.input} type="number" min={0} max={100} value={form.discount_services_pct} onChange={(e) => setForm({ ...form, discount_services_pct: Number(e.target.value) })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('memberships.discountProducts')}</label>
            <input style={styles.input} type="number" min={0} max={100} value={form.discount_merchandise_pct} onChange={(e) => setForm({ ...form, discount_merchandise_pct: Number(e.target.value) })} />
          </div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
            <label style={styles.label}>{t('shared.description')}</label>
            <textarea style={{ ...styles.input, minHeight: '60px', resize: 'vertical', maxWidth: '100%' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
            <Button variant="secondary" type="button" onClick={onClose}>{t('common:cancel')}</Button>
            <Button type="submit" loading={loading}>{t('memberships.createPlan')}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Packages Tab ---

function PackagesTab() {
  const { t } = useTranslation('offerings');
  const navigate = useNavigate();
  const businessId = localStorage.getItem('business_id') || '';
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => { const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300); return () => clearTimeout(t); }, [searchInput]);

  const fetchPackages = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await apiClient.get(`/v1/packages?business_id=${businessId}&page=${page}&limit=20${search ? `&search=${encodeURIComponent(search)}` : ''}${statusFilter ? `&status=${statusFilter}` : ''}`);
      setPackages(res.data.data || []);
      const meta = res.data.meta || {};
      setTotalPages(meta.totalPages || Math.ceil((meta.total || 0) / 20) || 1);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId, page, search, statusFilter]);

  useEffect(() => { fetchPackages(); }, [fetchPackages]);

  const handleQuickAction = async (action: string, pkg: any) => {
    try {
      await apiClient.put(`/v1/packages/${pkg.id}/${action}?business_id=${businessId}`);
      fetchPackages();
    } catch { /* silent */ }
  };

  const columns = [
    { key: 'name', header: t('shared.name'), sortable: true },
    { key: 'price', header: t('shared.price'), sortable: true, filter: 'amount' as const, render: (val: number) => formatCurrency(val) },
    {
      key: 'expiration_type', header: t('packages.expiration'), sortable: true,
      render: (val: string, row: any) => val === 'none' ? t('packages.never') : t(`packages.expiry.${row.expiration_unit || 'days'}`, { count: Number(row.expiration_days) }),
    },
    { key: 'active_purchases', header: t('packages.sold'), sortable: true, render: (val: number) => val || 0 },
    { key: 'status', header: t('shared.status'), sortable: true, render: (val: string) => <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>{t(`shared.status.${val}`, { defaultValue: val })}</Badge> },
    {
      key: 'actions', header: '', filter: false as const,
      render: (_: any, row: any) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          {row.status === 'active' && <ActionBtn label={t('shared.pause')} onClick={() => handleQuickAction('pause', row)} />}
          {(row.status === 'paused' || row.status === 'archived') && <ActionBtn label={t('shared.activate')} onClick={() => handleQuickAction('activate', row)} />}
          {row.status !== 'archived' && <ActionBtn label={t('shared.archive')} onClick={() => handleQuickAction('archive', row)} />}
        </div>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder={t('packages.search')} />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={styles.select}>
          <option value="">{t('shared.allStatuses')}</option>
          <option value="active">{t('shared.option.active')}</option>
          <option value="paused">{t('shared.option.paused')}</option>
          <option value="archived">{t('shared.option.archived')}</option>
        </select>
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={() => setShowCreate(true)}>{t('packages.add')}</Button>
      </div>

      <Table
        columns={columns}
        data={packages}
        loading={loading}
        onRowClick={(row) => navigate(`/offers/packages/${row.id}`)}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        emptyMessage={t('packages.empty')}
        mobileCardMode
        clientSort
      />

      {showCreate && (
        <CreatePackageModal
          businessId={businessId}
          onClose={() => setShowCreate(false)}
          onCreated={(pkg) => { setShowCreate(false); navigate(`/offers/packages/${pkg.id}`); }}
        />
      )}
    </>
  );
}

function CreatePackageModal({ businessId, onClose, onCreated }: { businessId: string; onClose: () => void; onCreated: (pkg: any) => void }) {
  const { t } = useTranslation('offerings');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [priceDisplay, setPriceDisplay] = useState('0.00');
  const [form, setForm] = useState({
    name: '',
    description: '',
    price: 0,
    expiration_type: 'none',
    expiration_days: '',
    expiration_unit: 'days',
    new_customers_only: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) { setError(t('products.nameRequiredMsg')); return; }
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.post('/v1/packages', {
        business_id: businessId,
        name: form.name,
        description: form.description || undefined,
        price: form.price,
        expiration_type: form.expiration_type,
        expiration_days: form.expiration_days ? parseInt(form.expiration_days) : undefined,
        expiration_unit: form.expiration_unit,
        new_customers_only: form.new_customers_only,
      });
      onCreated(res.data.data);
    } catch (err: any) { setError(err.response?.data?.error || t('packages.createFailed')); }
    finally { setLoading(false); }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>{t('packages.add')}</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        {error && <p style={styles.error}>{error}</p>}
        <form onSubmit={handleSubmit} style={styles.formGrid}>
          <div style={styles.formGroup}><label style={styles.label}>{t('shared.nameRequired')}</label><input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('shared.priceRequired')}</label>
            <input style={styles.input} type="number" step="0.01" min="0" value={priceDisplay}
              onChange={(e) => setPriceDisplay(e.target.value)}
              onBlur={() => { const cents = Math.round(parseFloat(priceDisplay || '0') * 100); setForm({ ...form, price: cents }); setPriceDisplay((cents / 100).toFixed(2)); }}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('packages.expiration')}</label>
            <select style={styles.input} value={form.expiration_type} onChange={(e) => setForm({ ...form, expiration_type: e.target.value })}>
              <option value="none">{t('packages.neverExpires')}</option>
              <option value="days_from_purchase">{t('packages.daysFromPurchase')}</option>
            </select>
          </div>
          {form.expiration_type === 'days_from_purchase' && (
            <div style={styles.formGroup}>
              <label style={styles.label}>{t('packages.expiresAfter')}</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input style={{ ...styles.input, flex: 1 }} type="number" min="1" value={form.expiration_days} onChange={(e) => setForm({ ...form, expiration_days: e.target.value })} />
                <select style={{ ...styles.input, width: '120px' }} value={form.expiration_unit} onChange={(e) => setForm({ ...form, expiration_unit: e.target.value })}>
                  <option value="days">{t('packages.days')}</option>
                  <option value="weeks">{t('packages.weeks')}</option>
                  <option value="months">{t('packages.months')}</option>
                </select>
              </div>
            </div>
          )}
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.new_customers_only} onChange={(e) => setForm({ ...form, new_customers_only: e.target.checked })} style={{ width: '16px', height: '16px' }} /> {t('packages.newCustomersOnly')}
            </label>
          </div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}><label style={styles.label}>{t('shared.description')}</label><textarea style={{ ...styles.input, minHeight: '60px', resize: 'vertical', maxWidth: '100%' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}><Button variant="secondary" type="button" onClick={onClose}>{t('common:cancel')}</Button><Button type="submit" loading={loading}>{t('packages.create')}</Button></div>
        </form>
      </div>
    </div>
  );
}

// --- Promotions Tab ---

function PromotionsTab() {
  const { t } = useTranslation('offerings');
  const navigate = useNavigate();
  const businessId = localStorage.getItem('business_id') || '';
  const [promotions, setPromotions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => { const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300); return () => clearTimeout(t); }, [searchInput]);

  const fetchPromotions = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await apiClient.get(`/v1/promotions?business_id=${businessId}&page=${page}&limit=20${search ? `&search=${encodeURIComponent(search)}` : ''}${statusFilter ? `&status=${statusFilter}` : ''}`);
      setPromotions(res.data.data || []);
      const meta = res.data.meta || {};
      setTotalPages(meta.totalPages || Math.ceil((meta.total || 0) / 20) || 1);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId, page, search, statusFilter]);

  useEffect(() => { fetchPromotions(); }, [fetchPromotions]);

  const handleQuickAction = async (action: string, promo: any) => {
    try {
      await apiClient.put(`/v1/promotions/${promo.id}/${action}?business_id=${businessId}`);
      fetchPromotions();
    } catch { /* silent */ }
  };

  const columns = [
    { key: 'name', header: t('shared.name'), sortable: true },
    { key: 'type', header: t('shared.type'), sortable: true, render: (val: string) => t(`shared.promoType.${val}`, { defaultValue: val }) },
    {
      key: 'value', header: t('shared.value'), sortable: true, filter: 'values' as const,
      render: (_: any, row: any) => {
        if (row.type.includes('percentage')) return formatPercent(row.value);
        return formatCurrency(row.value);
      },
    },
    { key: 'promo_code', header: t('shared.code'), sortable: true, render: (val: string) => val || '—' },
    {
      key: 'date_range', header: t('promotions.activePeriod'), sortable: true,
      render: (_: any, row: any) => {
        if (!row.date_from && !row.date_to) return t('promotions.always');
        const from = row.date_from ? formatDateOnly(row.date_from) : '';
        const to = row.date_to ? formatDateOnly(row.date_to) : '';
        return t('promotions.range', { from, to });
      },
    },
    { key: 'status', header: t('shared.status'), sortable: true, render: (val: string) => <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>{t(`shared.status.${val}`, { defaultValue: val })}</Badge> },
    {
      key: 'actions', header: '', filter: false as const,
      render: (_: any, row: any) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          {row.status === 'active' && <ActionBtn label={t('shared.pause')} onClick={() => handleQuickAction('pause', row)} />}
          {(row.status === 'paused' || row.status === 'expired') && <ActionBtn label={t('shared.activate')} onClick={() => handleQuickAction('activate', row)} />}
          {row.status !== 'archived' && <ActionBtn label={t('shared.archive')} onClick={() => handleQuickAction('archive', row)} />}
        </div>
      ),
    },
  ];

  return (
    <>
      <div style={styles.toolbar}>
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder={t('promotions.search')} />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={styles.select}>
          <option value="">{t('shared.allStatuses')}</option>
          <option value="active">{t('shared.option.active')}</option>
          <option value="paused">{t('shared.option.paused')}</option>
          <option value="expired">{t('shared.option.expired')}</option>
          <option value="archived">{t('shared.option.archived')}</option>
        </select>
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={() => setShowCreate(true)}>{t('promotions.add')}</Button>
      </div>

      <Table
        columns={columns}
        data={promotions}
        loading={loading}
        onRowClick={(row) => navigate(`/offers/promotions/${row.id}`)}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        emptyMessage={t('promotions.empty')}
        mobileCardMode
        clientSort
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
  const { t } = useTranslation('offerings');
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
    if (!form.name) { setError(t('products.nameRequiredMsg')); return; }
    if (!form.value) { setError(t('promotions.valueRequiredMsg')); return; }
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
    } catch (err: any) { setError(err.response?.data?.error || t('promotions.createFailed')); }
    finally { setLoading(false); }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>{t('promotions.add')}</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        {error && <p style={styles.error}>{error}</p>}
        <form onSubmit={handleSubmit} style={styles.formGrid}>
          <div style={styles.formGroup}><label style={styles.label}>{t('shared.nameRequired')}</label><input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('promotions.typeRequired')}</label>
            <select style={styles.input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="discount_percentage">{t('promotions.type.percentageDiscount')}</option>
              <option value="discount_fixed">{t('promotions.type.fixedDiscount')}</option>
              <option value="price_override">{t('promotions.type.priceOverride')}</option>
              <option value="premium_percentage">{t('promotions.type.percentagePremium')}</option>
              <option value="premium_fixed">{t('promotions.type.fixedPremium')}</option>
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{form.type.includes('percentage') ? t('promotions.percentageRequired') : t('promotions.amountRequired')}</label>
            <input style={styles.input} type="number" step={form.type.includes('percentage') ? '1' : '0.01'} min="0" value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} required />
          </div>
          <div style={styles.formGroup}><label style={styles.label}>{t('promotions.promoCode')}</label><input style={styles.input} value={form.promo_code} onChange={(e) => setForm({ ...form, promo_code: e.target.value.toUpperCase() })} placeholder={t('products.optional')} /></div>
          <div style={styles.formGroup}><label style={styles.label}>{t('promotions.startDate')}</label><input style={styles.input} type="date" value={form.date_from} onChange={(e) => setForm({ ...form, date_from: e.target.value })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>{t('promotions.endDate')}</label><input style={styles.input} type="date" value={form.date_to} onChange={(e) => setForm({ ...form, date_to: e.target.value })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>{t('promotions.maxRedemptions')}</label><input style={styles.input} type="number" min="1" value={form.max_redemptions} onChange={(e) => setForm({ ...form, max_redemptions: e.target.value })} placeholder={t('promotions.unlimited')} /></div>
          <div style={styles.formGroup}><label style={styles.label}>{t('promotions.maxPerCustomer')}</label><input style={styles.input} type="number" min="1" value={form.max_per_customer} onChange={(e) => setForm({ ...form, max_per_customer: e.target.value })} placeholder={t('promotions.unlimited')} /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', gridColumn: '1 / -1' }}>
            <input type="checkbox" checked={form.stackable} onChange={(e) => setForm({ ...form, stackable: e.target.checked })} style={{ width: '16px', height: '16px' }} />
            {t('promotions.stackable')}
          </label>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}><label style={styles.label}>{t('shared.description')}</label><textarea style={{ ...styles.input, minHeight: '60px', resize: 'vertical', maxWidth: '100%' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}><Button variant="secondary" type="button" onClick={onClose}>{t('common:cancel')}</Button><Button type="submit" loading={loading}>{t('promotions.create')}</Button></div>
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
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', margin: 0 },
  tabBar: { display: 'flex', gap: '0', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--space-md)' },
  tab: { background: 'none', border: 'none', borderBottom: '3px solid transparent', padding: '10px 20px', fontSize: 'var(--font-size-base)', fontWeight: 500, color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)', marginBottom: '-1px' },
  tabActive: { color: 'var(--color-primary)', borderBottomColor: 'var(--color-primary)', fontWeight: 600 },
  toolbar: { display: 'flex', gap: 'var(--space-md)', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap' as const },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  actionBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--button-radius)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)', minWidth: '60px', textAlign: 'center' as const, minHeight: 'var(--button-height-sm)' },
  overlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '600px', maxHeight: '85vh', overflow: 'auto', border: '1px solid var(--color-border)', boxShadow: '0 10px 25px rgba(0,0,0,0.3)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)' },
  closeBtn: { background: 'none', border: 'none', fontSize: 'var(--font-size-xl)', cursor: 'pointer', color: 'var(--color-text-secondary)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)' },
  input: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 'var(--font-size-base)', width: '100%', boxSizing: 'border-box' as const, fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)' },
  error: { color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: '0 0 8px 0' },
};
