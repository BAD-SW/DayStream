import { useState, useEffect, useCallback } from 'react';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import { apiClient } from '../api/client';
import { TIMEZONES } from '../utils/timezones';
import { CurrencyInput } from '../components/CurrencyInput';
import { formatCurrency } from '../utils/currency';

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
  billing_frequency: string;
  billing_amount: number;
  billing_method: string;
  signup_date: string | null;
  next_billing_date: string | null;
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
  billing_frequency: string;
  billing_amount: number; // stored as cents
  billing_method: string;
  signup_date: string;
  next_billing_date: string;
  payment_bank_name: string;
  payment_account_holder: string;
  payment_account_number: string;
  payment_routing_number: string;
  payment_iban: string;
  payment_card_last4: string;
  payment_card_brand: string;
  payment_card_exp: string;
  owner_email: string;
  owner_first_name: string;
  owner_last_name: string;
  owner_password: string;
}

const EMPTY_FORM: BusinessForm = {
  name: '', slug: '', email: '', phone: '', address: '',
  default_language: 'en', currency: 'EUR', timezone: 'UTC', primary_color: '#C9A96E',
  billing_frequency: 'monthly', billing_amount: 0, billing_method: 'tbd',
  signup_date: '', next_billing_date: '',
  payment_bank_name: '', payment_account_holder: '', payment_account_number: '',
  payment_routing_number: '', payment_iban: '',
  payment_card_last4: '', payment_card_brand: '', payment_card_exp: '',
  owner_email: '', owner_first_name: '', owner_last_name: '', owner_password: '',
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
      billing_frequency: biz.billing_frequency || 'monthly',
      billing_amount: biz.billing_amount || 0,
      billing_method: biz.billing_method || 'tbd',
      signup_date: biz.signup_date ? biz.signup_date.split('T')[0] : '',
      next_billing_date: biz.next_billing_date ? biz.next_billing_date.split('T')[0] : '',
      payment_bank_name: (biz as any).payment_bank_name || '',
      payment_account_holder: (biz as any).payment_account_holder || '',
      payment_account_number: (biz as any).payment_account_number || '',
      payment_routing_number: (biz as any).payment_routing_number || '',
      payment_iban: (biz as any).payment_iban || '',
      payment_card_last4: (biz as any).payment_card_last4 || '',
      payment_card_brand: (biz as any).payment_card_brand || '',
      payment_card_exp: (biz as any).payment_card_exp || '',
    });
    setFormError(null); setEditing(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setFormError(null);
    try {
      await apiClient.post('/v1/admin/businesses', {
        ...form,
        billing_amount: form.billing_amount,
        signup_date: form.signup_date || null,
        next_billing_date: form.next_billing_date || null,
        owner_email: form.owner_email,
        owner_first_name: form.owner_first_name,
        owner_last_name: form.owner_last_name,
        owner_password: form.owner_password,
      });
      setShowCreate(false); fetchBusinesses();
    } catch (err: any) { setFormError(err.response?.data?.error || err.response?.data?.message || 'Failed to create'); }
    finally { setSaving(false); }
  }

  async function handleSaveEdit() {
    if (!selectedBiz) return;
    setSaving(true); setFormError(null);
    try {
      const res = await apiClient.put(`/v1/admin/businesses/${selectedBiz.id}`, {
        ...form,
        billing_amount: form.billing_amount,
        signup_date: form.signup_date || null,
        next_billing_date: form.next_billing_date || null,
      });
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
        <div style={styles.overlay}>
          <div style={styles.modal}>
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
                  <DetailRow label="Billing Frequency" value={selectedBiz.billing_frequency?.charAt(0).toUpperCase() + selectedBiz.billing_frequency?.slice(1) || '—'} />
                  <DetailRow label="Billing Amount" value={selectedBiz.billing_amount ? formatCurrency(selectedBiz.billing_amount, selectedBiz.currency) : '—'} />
                  <DetailRow label="Billing Method" value={selectedBiz.billing_method === 'tbd' ? 'TBD' : selectedBiz.billing_method} />
                  <DetailRow label="Signup Date" value={selectedBiz.signup_date ? new Date(selectedBiz.signup_date).toLocaleDateString() : '—'} />
                  <DetailRow label="Next Billing Date" value={selectedBiz.next_billing_date ? new Date(selectedBiz.next_billing_date).toLocaleDateString() : '—'} />
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
        <div style={styles.overlay}>
          <div style={styles.modal}>
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
  // Auto-calculate next billing date preview when frequency or signup date changes
  function recalcNextBilling(newForm: BusinessForm) {
    const ref = newForm.signup_date;
    if (!ref) return newForm;
    const freq = newForm.billing_frequency || 'monthly';
    const refDate = new Date(ref);
    if (isNaN(refDate.getTime())) return newForm;
    const now = new Date();
    let next = new Date(refDate);
    const addInterval = (d: Date): Date => {
      const r = new Date(d);
      switch (freq) {
        case 'monthly': r.setMonth(r.getMonth() + 1); break;
        case 'quarterly': r.setMonth(r.getMonth() + 3); break;
        case 'semi-annual': r.setMonth(r.getMonth() + 6); break;
        case 'annual': r.setFullYear(r.getFullYear() + 1); break;
        default: r.setMonth(r.getMonth() + 1);
      }
      return r;
    };
    while (next <= now) { next = addInterval(next); }
    return { ...newForm, next_billing_date: next.toISOString().split('T')[0] };
  }

  function handleFrequencyChange(value: string) {
    setForm(recalcNextBilling({ ...form, billing_frequency: value }));
  }

  function handleSignupChange(value: string) {
    setForm(recalcNextBilling({ ...form, signup_date: value }));
  }

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

      {isCreate && (
        <>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', paddingTop: '8px', borderTop: '1px solid var(--color-border)', marginTop: '4px', marginBottom: '12px' }}>
            Owner Details
          </div>
          <div style={styles.formRow}>
            <div style={styles.formGroup}>
              <label style={styles.label}>First Name *</label>
              <input style={styles.input} value={form.owner_first_name} onChange={(e) => setForm({ ...form, owner_first_name: e.target.value })} required placeholder="First Name" />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Last Name *</label>
              <input style={styles.input} value={form.owner_last_name} onChange={(e) => setForm({ ...form, owner_last_name: e.target.value })} required placeholder="Last Name" />
            </div>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Owner Email *</label>
            <input style={styles.input} type="email" value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} required placeholder="owner@business.com" />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Owner Password *</label>
            <input style={styles.input} type="password" value={form.owner_password} onChange={(e) => setForm({ ...form, owner_password: e.target.value })} required minLength={10} placeholder="Minimum 10 characters" />
          </div>
        </>
      )}

      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', paddingTop: '8px', borderTop: '1px solid var(--color-border)', marginTop: '4px', marginBottom: '12px' }}>
        Business Contact
      </div>
      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Business Email</label>
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
          <select style={styles.input} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            <option value="USD">USD ($)</option>
            <option value="EUR">EUR (€)</option>
          </select>
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
      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Billing Frequency</label>
          <select style={styles.input} value={form.billing_frequency} onChange={(e) => handleFrequencyChange(e.target.value)}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="semi-annual">Semi-Annual</option>
            <option value="annual">Annual</option>
          </select>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Billing Amount</label>
          <CurrencyInput style={styles.input} value={form.billing_amount} onChange={(cents) => setForm({ ...form, billing_amount: cents })} />
        </div>
      </div>
      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Signup Date</label>
          <input style={styles.input} type="date" value={form.signup_date} onChange={(e) => handleSignupChange(e.target.value)} />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Next Billing Date</label>
          <input style={{ ...styles.input, opacity: 0.7, cursor: 'not-allowed' }} type="date" value={form.next_billing_date} disabled />
          <span style={styles.helper}>Auto-calculated from last billing date and frequency.</span>
        </div>
      </div>

      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', paddingTop: '8px', borderTop: '1px solid var(--color-border)', marginTop: '4px', marginBottom: '12px' }}>
        Payment Source (ACH/SEPA — primary)
      </div>
      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Bank Name</label>
          <input style={styles.input} value={form.payment_bank_name} onChange={(e) => setForm({ ...form, payment_bank_name: e.target.value })} placeholder="Bank Name" />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Account Holder</label>
          <input style={styles.input} value={form.payment_account_holder} onChange={(e) => setForm({ ...form, payment_account_holder: e.target.value })} placeholder="Business Name LLC" />
        </div>
      </div>
      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Account Number</label>
          <input style={styles.input} value={form.payment_account_number} onChange={(e) => setForm({ ...form, payment_account_number: e.target.value })} placeholder="••••••1234" />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Routing / IBAN</label>
          <input style={styles.input} value={form.payment_routing_number || form.payment_iban} onChange={(e) => setForm({ ...form, payment_routing_number: e.target.value })} placeholder="Routing or IBAN" />
        </div>
      </div>

      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', paddingTop: '8px', borderTop: '1px solid var(--color-border)', marginTop: '4px', marginBottom: '12px' }}>
        Card on File (backup)
      </div>
      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Last 4 Digits</label>
          <input style={styles.input} value={form.payment_card_last4} onChange={(e) => setForm({ ...form, payment_card_last4: e.target.value })} maxLength={4} placeholder="4242" />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Brand</label>
          <select style={styles.input} value={form.payment_card_brand} onChange={(e) => setForm({ ...form, payment_card_brand: e.target.value })}>
            <option value="">None</option>
            <option value="visa">Visa</option>
            <option value="mastercard">Mastercard</option>
            <option value="amex">Amex</option>
            <option value="discover">Discover</option>
          </select>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Expiry</label>
          <input style={styles.input} value={form.payment_card_exp} onChange={(e) => setForm({ ...form, payment_card_exp: e.target.value })} placeholder="MM/YYYY" maxLength={7} />
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
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '560px', maxHeight: '85vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px var(--color-border)' },
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
