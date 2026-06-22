import { useState, useEffect, useCallback } from 'react';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import { apiClient } from '../api/client';
import { TIMEZONES } from '../utils/timezones';

interface Business {
  id: string;
  name: string;
  slug: string;
  status: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  default_language: string;
  currency: string;
  timezone: string;
  primary_color: string;
  created_at: string;
  updated_at: string;
}

interface BusinessForm {
  name: string;
  slug: string;
  email: string;
  phone: string;
  address: string;
  default_language: string;
  currency: string;
  timezone: string;
  primary_color: string;
}

const EMPTY_FORM: BusinessForm = {
  name: '', slug: '', email: '', phone: '', address: '',
  default_language: 'en', currency: 'EUR', timezone: 'UTC', primary_color: '#C9A96E',
};

export function TenantBusinesses() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedBiz, setSelectedBiz] = useState<Business | null>(null);
  const [editing, setEditing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<BusinessForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchBusinesses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/v1/admin/businesses');
      setBusinesses(res.data.data || []);
    } catch { setBusinesses([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchBusinesses(); }, [fetchBusinesses]);

  const filtered = businesses.filter((b) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return b.name.toLowerCase().includes(q) || b.slug.toLowerCase().includes(q);
  });

  function openCreate() {
    setForm(EMPTY_FORM); setFormError(null); setShowCreate(true);
  }

  function openEdit(biz: Business) {
    setForm({
      name: biz.name, slug: biz.slug, email: biz.email || '', phone: biz.phone || '',
      address: biz.address || '', default_language: biz.default_language,
      currency: biz.currency, timezone: biz.timezone, primary_color: biz.primary_color,
    });
    setFormError(null); setEditing(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setFormError(null);
    try {
      await apiClient.post('/v1/admin/businesses', form);
      setShowCreate(false); fetchBusinesses();
    } catch (err: any) { setFormError(err.response?.data?.message || 'Failed to create'); }
    finally { setSaving(false); }
  }

  async function handleSaveEdit() {
    if (!selectedBiz) return;
    setSaving(true); setFormError(null);
    try {
      const res = await apiClient.put(`/v1/admin/businesses/${selectedBiz.id}`, form);
      setSelectedBiz(res.data.data); setEditing(false); fetchBusinesses();
    } catch (err: any) { setFormError(err.response?.data?.message || 'Failed to update'); }
    finally { setSaving(false); }
  }

  async function handleArchive(biz: Business) {
    if (!confirm(`Archive "${biz.name}"? This will deactivate the business.`)) return;
    try {
      await apiClient.delete(`/v1/admin/businesses/${biz.id}`);
      setSelectedBiz(null); fetchBusinesses();
    } catch (err: any) { alert(err.response?.data?.message || 'Failed to archive'); }
  }

  async function handleActivate(biz: Business) {
    try {
      await apiClient.put(`/v1/admin/businesses/${biz.id}`, { status: 'active' });
      setSelectedBiz((prev) => prev ? { ...prev, status: 'active' } : null); fetchBusinesses();
    } catch (err: any) { alert(err.response?.data?.message || 'Failed to activate'); }
  }

  const columns = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'slug', header: 'URL Alias', sortable: true },
    { key: 'status', header: 'Status', sortable: true, render: (val: string) => <Badge variant={val === 'active' ? 'success' : val === 'suspended' ? 'warning' : 'neutral'}>{val.charAt(0).toUpperCase() + val.slice(1)}</Badge> },
    { key: 'currency', header: 'Currency', sortable: true },
    { key: 'created_at', header: 'Created', sortable: true, render: (val: string) => new Date(val).toLocaleDateString() },
  ];

  return (
    <div>
      <div style={styles.header}>
        <h2 style={styles.heading}>Businesses</h2>
        <Button onClick={openCreate}>Create Business</Button>
      </div>
      <div style={{ marginBottom: '16px' }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search businesses..." />
      </div>

      <Table columns={columns} data={filtered} loading={loading} emptyMessage="No businesses found." clientSort onRowClick={(row) => setSelectedBiz(row)} mobileCardMode />

      {/* Detail / Edit Panel */}
      {selectedBiz && (
        <div style={styles.overlay} onClick={() => { setSelectedBiz(null); setEditing(false); }}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>{editing ? 'Edit Business' : selectedBiz.name}</h3>
              <button style={styles.closeBtn} onClick={() => { setSelectedBiz(null); setEditing(false); }}>&times;</button>
            </div>
            {formError && <div style={styles.formError}>{formError}</div>}
            {editing ? (
              <BusinessFormFields form={form} setForm={setForm} saving={saving} onSave={handleSaveEdit} onCancel={() => { setEditing(false); setFormError(null); }} />
            ) : (
              <>
                <div style={styles.detailBody}>
                  <DetailRow label="URL Alias" value={selectedBiz.slug} />
                  <DetailRow label="Status" value={selectedBiz.status.charAt(0).toUpperCase() + selectedBiz.status.slice(1)} />
                  <DetailRow label="Email" value={selectedBiz.email || '—'} />
                  <DetailRow label="Phone" value={selectedBiz.phone || '—'} />
                  <DetailRow label="Address" value={selectedBiz.address || '—'} />
                  <DetailRow label="Language" value={selectedBiz.default_language} />
                  <DetailRow label="Currency" value={selectedBiz.currency} />
                  <DetailRow label="Timezone" value={selectedBiz.timezone} />
                  <DetailRow label="Brand Color" value={selectedBiz.primary_color} />
                  <DetailRow label="Created" value={new Date(selectedBiz.created_at).toLocaleString()} />
                </div>
                <div style={styles.actions}>
                  <Button variant="primary" size="sm" onClick={() => openEdit(selectedBiz)}>Edit</Button>
                  {selectedBiz.status === 'active' && <Button variant="destructive" size="sm" onClick={() => handleArchive(selectedBiz)}>Archive</Button>}
                  {selectedBiz.status !== 'active' && <Button variant="primary" size="sm" onClick={() => handleActivate(selectedBiz)}>Activate</Button>}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div style={styles.overlay} onClick={() => setShowCreate(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Create Business</h3>
              <button style={styles.closeBtn} onClick={() => setShowCreate(false)}>&times;</button>
            </div>
            {formError && <div style={styles.formError}>{formError}</div>}
            <form onSubmit={handleCreate}>
              <BusinessFormFields form={form} setForm={setForm} saving={saving} onSave={() => {}} onCancel={() => setShowCreate(false)} isCreate />
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Shared form fields component
function BusinessFormFields({ form, setForm, saving, onSave, onCancel, isCreate }: {
  form: BusinessForm; setForm: (f: BusinessForm) => void;
  saving: boolean; onSave: () => void; onCancel: () => void; isCreate?: boolean;
}) {
  return (
    <div style={styles.formBody}>
      <div style={styles.formGroup}>
        <label style={styles.label}>Name *</label>
        <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Business Name" />
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>URL Alias</label>
        <input style={styles.input} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="auto-generated-from-name" />
        <span style={styles.helper}>Lowercase, hyphens only. Leave blank to auto-generate.</span>
      </div>
      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Email</label>
          <input style={styles.input} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="contact@business.com" />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Phone</label>
          <input style={styles.input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 234 567 890" />
        </div>
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Address</label>
        <input style={styles.input} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="123 Main St, City" />
      </div>
      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Language</label>
          <select style={styles.input} value={form.default_language} onChange={(e) => setForm({ ...form, default_language: e.target.value })}>
            <option value="en">English</option>
            <option value="es">Spanish</option>
          </select>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Currency</label>
          <input style={styles.input} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} maxLength={3} />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Timezone</label>
          <select style={styles.input} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
            {TIMEZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
          </select>
        </div>
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Brand Color</label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input type="color" value={form.primary_color} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} style={{ width: '36px', height: '36px', border: 'none', cursor: 'pointer' }} />
          <input style={{ ...styles.input, maxWidth: '100px' }} value={form.primary_color} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} />
        </div>
      </div>
      <div style={styles.formActions}>
        <Button variant="outline" type="button" onClick={onCancel}>Cancel</Button>
        {isCreate
          ? <Button type="submit" loading={saving}>Create Business</Button>
          : <Button onClick={onSave} loading={saving}>Save Changes</Button>
        }
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.detailRow}><span style={styles.detailLabel}>{label}</span><span style={styles.detailValue}>{value}</span></div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  heading: { fontSize: '24px', fontWeight: 300, margin: 0, color: 'var(--color-text)' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-elevated, var(--color-surface))', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '560px', maxHeight: '85vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px var(--color-border)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { fontSize: '18px', fontWeight: 600, color: 'var(--color-text)', margin: 0 },
  closeBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: '24px', cursor: 'pointer', padding: '4px 8px', lineHeight: 1 },
  detailBody: { display: 'flex', flexDirection: 'column' as const, gap: '6px' },
  detailRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--color-border)' },
  detailLabel: { fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 },
  detailValue: { fontSize: '13px', color: 'var(--color-text)' },
  actions: { display: 'flex', gap: '8px', marginTop: '16px' },
  formBody: { display: 'flex', flexDirection: 'column' as const, gap: '12px' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px', flex: 1, minWidth: 0 },
  formRow: { display: 'flex', gap: '12px' },
  formActions: { display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '12px' },
  label: { fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 },
  input: { backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '8px 12px', color: 'var(--color-text)', fontSize: '14px', width: '100%', boxSizing: 'border-box' as const },
  helper: { fontSize: '11px', color: 'var(--color-text-muted)' },
  formError: { padding: '8px 12px', borderRadius: '6px', background: 'var(--color-error-bg, rgba(220,38,38,0.1))', border: '1px solid var(--color-error)', color: 'var(--color-error)', fontSize: '13px', marginBottom: '12px' },
};
