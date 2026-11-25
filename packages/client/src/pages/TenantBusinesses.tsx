import { askConfirm, showMessage } from '../design-system/components/feedback/dialogs';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_DETAILS } from '@daystream/shared';
import type { SupportedLanguage } from '@daystream/shared';
import { LanguageSelect } from '../components/LanguageSelect';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import { apiClient } from '../api/client';
import { TIMEZONES } from '../utils/timezones';
import { formatDateOnly } from '../utils/date';
import { formatDate, formatDateTime } from '../utils/format';
import { CurrencyInput } from '../components/CurrencyInput';
import { ThemeEditorFields, ThemeField } from '../design-system/components/forms/ThemeEditorFields';
import { Tabs } from '../design-system/components/navigation/Tabs';
import { useAuth } from '../context/AuthContext';
import { BusinessBillingTab } from '../components/BusinessBillingTab';
import { BusinessChargeHistory } from '../components/BusinessChargeHistory';
import { BusinessAuditTrail } from '../components/BusinessAuditTrail';
import { DataMigration } from './settings/DataMigration';

const THEME_TO_FORM_FIELD: Record<ThemeField, 'base_theme' | 'primary_color' | 'secondary_color' | 'title_color' | 'font_family' | 'base_font_size' | 'favicon_url'> = {
  baseTheme: 'base_theme',
  primaryColor: 'primary_color',
  secondaryColor: 'secondary_color',
  titleColor: 'title_color',
  fontFamily: 'font_family',
  baseFontSize: 'base_font_size',
  faviconUrl: 'favicon_url',
};

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
  primary_color: string | null;
  secondary_color: string | null;
  title_color: string | null;
  font_family: string | null;
  base_font_size: number | null;
  base_theme: string | null;
  favicon_url: string | null;
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
  // Appearance fields are optional (null = "not customized, inherit the tenant's theme" —
  // see 104_theme_cascade.sql), so theming can be part of setup without forcing a choice.
  primary_color: string | null;
  secondary_color: string | null;
  title_color: string | null;
  font_family: string | null;
  base_font_size: number | null;
  base_theme: string | null;
  favicon_url: string | null;
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
  default_language: 'en', currency: 'EUR', timezone: 'UTC',
  primary_color: null, secondary_color: null, title_color: null, font_family: null, base_font_size: null,
  base_theme: null, favicon_url: null,
  billing_frequency: 'monthly', billing_amount: 0, billing_method: 'tbd',
  signup_date: '', next_billing_date: '',
  payment_bank_name: '', payment_account_holder: '', payment_account_number: '',
  payment_routing_number: '', payment_iban: '',
  payment_card_last4: '', payment_card_brand: '', payment_card_exp: '',
  owner_email: '', owner_first_name: '', owner_last_name: '', owner_password: '',
};

export function TenantBusinesses() {
  const { t } = useTranslation('tenant');
  const { user } = useAuth();
  const tenantId = user?.tenant_id || '';
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedBiz, setSelectedBiz] = useState<Business | null>(null);
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
      currency: biz.currency, timezone: biz.timezone,
      primary_color: biz.primary_color ?? null,
      secondary_color: biz.secondary_color ?? null,
      title_color: biz.title_color ?? null,
      font_family: biz.font_family ?? null,
      base_font_size: biz.base_font_size ?? null,
      base_theme: biz.base_theme ?? null,
      favicon_url: biz.favicon_url ?? null,
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
      owner_email: '', owner_first_name: '', owner_last_name: '', owner_password: '',
    });
    setFormError(null);
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
    } catch (err: any) { setFormError(err.response?.data?.error || err.response?.data?.message || t('businesses.createFailed')); }
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
      setSelectedBiz(res.data.data); fetchBusinesses();
    } catch (err: any) { setFormError(err.response?.data?.message || t('businesses.updateFailed')); }
    finally { setSaving(false); }
  }

  async function handleArchive(biz: Business) {
    if (!(await askConfirm({ message: t('businesses.archiveConfirm', { name: biz.name }), confirmLabel: t('common:action.archive'), destructive: true }))) return;
    try {
      await apiClient.delete(`/v1/admin/businesses/${biz.id}`);
      setSelectedBiz(null); fetchBusinesses();
    } catch (err: any) { void showMessage({ message: err.response?.data?.message || t('businesses.archiveFailed'), tone: 'error' }); }
  }

  async function handleActivate(biz: Business) {
    try {
      await apiClient.put(`/v1/admin/businesses/${biz.id}`, { status: 'active' });
      setSelectedBiz((prev) => prev ? { ...prev, status: 'active' } : null); fetchBusinesses();
    } catch (err: any) { void showMessage({ message: err.response?.data?.message || t('businesses.activateFailed'), tone: 'error' }); }
  }

  // A stored status is shown through its key, never printed as stored.
  const statusLabel = (s: string) => t(`businesses.status_${s}`, { defaultValue: s });
  // A stored language code is shown as the language's own name.
  const languageName = (code: string) => LANGUAGE_DETAILS[code as SupportedLanguage]?.label ?? code;
  const columns = [
    { key: 'name', header: t('businesses.name'), sortable: true },
    { key: 'slug', header: t('businesses.urlAlias'), sortable: true },
    { key: 'status', header: t('businesses.status'), sortable: true, render: (val: string) => <Badge variant={val === 'active' ? 'success' : val === 'suspended' ? 'warning' : 'neutral'}>{statusLabel(val)}</Badge> },
    { key: 'currency', header: t('businesses.currency'), sortable: true },
    { key: 'created_at', header: t('businesses.created'), sortable: true, render: (val: string) => formatDate(val) },
  ];

  return (
    <div>
      <div style={styles.header}>
        <h2 style={styles.heading}>{t('businesses.title')}</h2>
        <Button onClick={openCreate}>{t('businesses.create')}</Button>
      </div>
      <div style={{ marginBottom: '16px' }}>
        <SearchInput value={search} onChange={setSearch} placeholder={t('businesses.search')} />
      </div>

      <Table columns={columns} data={filtered} loading={loading} emptyMessage={t('businesses.empty')} clientSort onRowClick={(row) => { setSelectedBiz(row); openEdit(row); }} mobileCardMode />

      {/* Detail Panel — tabbed (mirrors the Tenant window redesign) */}
      {selectedBiz && (
        <div style={styles.overlay}>
          <div style={styles.detailPanel}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>{selectedBiz.name}</h3>
              <button style={styles.closeBtn} onClick={() => { setSelectedBiz(null); }} aria-label={t('common:modal.close')}>{'\u00d7'}</button>
            </div>
            {formError && <div style={styles.formError}>{formError}</div>}

            <Tabs
              defaultTab="overview"
              items={[
                {
                  id: 'overview',
                  label: t('businesses.tabOverview'),
                  content: (
                    <>
                      <div style={styles.detailBody}>
                        <DetailRow label={t('businesses.urlAlias')} value={selectedBiz.slug} />
                        <DetailRow label={t('businesses.status')} value={statusLabel(selectedBiz.status)} />
                        <DetailRow label={t('businesses.email')} value={selectedBiz.email || '—'} />
                        <DetailRow label={t('businesses.phone')} value={selectedBiz.phone || '—'} />
                        <DetailRow label={t('businesses.address')} value={selectedBiz.address || '—'} />
                        <DetailRow label={t('businesses.language')} value={languageName(selectedBiz.default_language)} />
                        <DetailRow label={t('businesses.currency')} value={selectedBiz.currency} />
                        <DetailRow label={t('businesses.timezone')} value={selectedBiz.timezone} />
                        <DetailRow label={t('businesses.brandColor')} value={selectedBiz.primary_color || t('businesses.inheritedFromTenant')} />
                        <DetailRow label={t('businesses.signupDate')} value={selectedBiz.signup_date ? formatDateOnly(selectedBiz.signup_date) : '—'} />
                        <DetailRow label={t('businesses.created')} value={formatDateTime(selectedBiz.created_at)} />
                      </div>
                      <div style={styles.actions}>
                        {selectedBiz.status === 'active' && <Button variant="destructive" size="sm" onClick={() => handleArchive(selectedBiz)}>{t('businesses.archive')}</Button>}
                        {selectedBiz.status !== 'active' && <Button variant="primary" size="sm" onClick={() => handleActivate(selectedBiz)}>{t('businesses.activate')}</Button>}
                      </div>
                    </>
                  ),
                },
                {
                  id: 'settings',
                  label: t('businesses.tabSettings'),
                  content: (
                    <BusinessFormFields form={form} setForm={setForm} saving={saving} onSave={handleSaveEdit} onCancel={() => { setSelectedBiz(null); setFormError(null); }} />
                  ),
                },
                {
                  id: 'billing',
                  label: t('businesses.tabBilling'),
                  content: (
                    <BusinessBillingTab businessId={selectedBiz.id} tenantId={tenantId} currency={selectedBiz.currency} />
                  ),
                },
                {
                  id: 'charge-history',
                  label: t('businesses.tabChargeHistory'),
                  content: (
                    <BusinessChargeHistory businessId={selectedBiz.id} />
                  ),
                },
                {
                  id: 'audit-trail',
                  label: t('businesses.tabAuditTrail'),
                  content: (
                    <BusinessAuditTrail businessId={selectedBiz.id} />
                  ),
                },
                {
                  id: 'data-migration',
                  label: t('businesses.tabDataMigration'),
                  content: (
                    <DataMigration businessId={selectedBiz.id} />
                  ),
                },
              ]}
            />
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>{t('businesses.create')}</h3>
              <button style={styles.closeBtn} onClick={() => setShowCreate(false)} aria-label={t('common:modal.close')}>{'\u00d7'}</button>
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
  const { t } = useTranslation('tenant');
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
        <label style={styles.label}>{t('businesses.nameRequired')}</label>
        <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder={t('businesses.namePlaceholder')} />
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>{t('businesses.urlAlias')}</label>
        <input style={styles.input} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder={t('businesses.slugPlaceholder')} />
        <span style={styles.helper}>{t('businesses.slugHelp')}</span>
      </div>

      {isCreate && (
        <>
          <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', paddingTop: '8px', borderTop: '1px solid var(--color-border)', marginTop: '4px', marginBottom: '12px' }}>
            {t('businesses.ownerDetails')}
          </div>
          <div style={styles.formRow}>
            <div style={styles.formGroup}>
              <label style={styles.label}>{t('businesses.firstNameRequired')}</label>
              <input style={styles.input} value={form.owner_first_name} onChange={(e) => setForm({ ...form, owner_first_name: e.target.value })} required placeholder={t('businesses.firstName')} />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>{t('businesses.lastNameRequired')}</label>
              <input style={styles.input} value={form.owner_last_name} onChange={(e) => setForm({ ...form, owner_last_name: e.target.value })} required placeholder={t('businesses.lastName')} />
            </div>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('businesses.ownerEmailRequired')}</label>
            <input style={styles.input} type="email" value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} required placeholder={t('businesses.ownerEmailPlaceholder')} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('businesses.ownerPasswordRequired')}</label>
            <input style={styles.input} type="password" value={form.owner_password} onChange={(e) => setForm({ ...form, owner_password: e.target.value })} required minLength={10} placeholder={t('businesses.passwordHelp')} />
          </div>
        </>
      )}

      <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', paddingTop: '8px', borderTop: '1px solid var(--color-border)', marginTop: '4px', marginBottom: '12px' }}>
        {t('businesses.businessContact')}
      </div>
      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>{t('businesses.businessEmail')}</label>
          <input style={styles.input} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={t('businesses.contactEmailPlaceholder')} />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>{t('businesses.phone')}</label>
          <input style={styles.input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder={t('businesses.phonePlaceholder')} />
        </div>
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>{t('businesses.address')}</label>
        <input style={styles.input} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder={t('businesses.addressPlaceholder')} />
      </div>
      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>{t('businesses.language')}</label>
          <LanguageSelect style={styles.input} value={form.default_language} onChange={(v) => setForm({ ...form, default_language: v })} />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>{t('businesses.currency')}</label>
          <select style={styles.input} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            <option value="USD">{t('businesses.currencyUSD')}</option>
            <option value="EUR">{t('businesses.currencyEUR')}</option>
          </select>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>{t('businesses.timezone')}</label>
          <select style={styles.input} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
            {TIMEZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
          </select>
        </div>
      </div>
      <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', paddingTop: '8px', borderTop: '1px solid var(--color-border)', marginTop: '4px', marginBottom: '12px' }}>
        {t('businesses.appearance')}{isCreate && ` ${t('businesses.appearanceOptional')}`}
      </div>
      <ThemeEditorFields
        values={{
          baseTheme: form.base_theme,
          primaryColor: form.primary_color,
          secondaryColor: form.secondary_color,
          titleColor: form.title_color,
          fontFamily: form.font_family,
          baseFontSize: form.base_font_size,
          faviconUrl: form.favicon_url,
        }}
        onChange={(field, value) => {
          const formField = THEME_TO_FORM_FIELD[field];
          setForm({ ...form, [formField]: value });
        }}
        inherited={{}}
        inheritedLabel={t('businesses.inheritedLabel')}
      />
      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>{t('businesses.billingFrequency')}</label>
          <select style={styles.input} value={form.billing_frequency} onChange={(e) => handleFrequencyChange(e.target.value)}>
            <option value="monthly">{t('businesses.freqMonthly')}</option>
            <option value="quarterly">{t('businesses.freqQuarterly')}</option>
            <option value="semi-annual">{t('businesses.freqSemiAnnual')}</option>
            <option value="annual">{t('businesses.freqAnnual')}</option>
          </select>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>{t('businesses.billingAmount')}</label>
          <CurrencyInput style={styles.input} value={form.billing_amount} onChange={(cents) => setForm({ ...form, billing_amount: cents })} />
        </div>
      </div>
      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>{t('businesses.signupDate')}</label>
          <input style={styles.input} type="date" value={form.signup_date} onChange={(e) => handleSignupChange(e.target.value)} />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>{t('businesses.nextBillingDate')}</label>
          <input style={{ ...styles.input, opacity: 0.7, cursor: 'not-allowed' }} type="date" value={form.next_billing_date} disabled />
          <span style={styles.helper}>{t('businesses.nextBillingHelp')}</span>
        </div>
      </div>

      <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', paddingTop: '8px', borderTop: '1px solid var(--color-border)', marginTop: '4px', marginBottom: '12px' }}>
        {t('businesses.paymentSource')}
      </div>
      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>{t('businesses.bankName')}</label>
          <input style={styles.input} value={form.payment_bank_name} onChange={(e) => setForm({ ...form, payment_bank_name: e.target.value })} placeholder={t('businesses.bankName')} />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>{t('businesses.accountHolder')}</label>
          <input style={styles.input} value={form.payment_account_holder} onChange={(e) => setForm({ ...form, payment_account_holder: e.target.value })} placeholder={t('businesses.accountHolderPlaceholder')} />
        </div>
      </div>
      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>{t('businesses.accountNumber')}</label>
          <input style={styles.input} value={form.payment_account_number} onChange={(e) => setForm({ ...form, payment_account_number: e.target.value })} placeholder={t('businesses.accountNumberPlaceholder')} />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>{t('businesses.routingIban')}</label>
          <input style={styles.input} value={form.payment_routing_number || form.payment_iban} onChange={(e) => setForm({ ...form, payment_routing_number: e.target.value })} placeholder={t('businesses.routingIbanPlaceholder')} />
        </div>
      </div>

      <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', paddingTop: '8px', borderTop: '1px solid var(--color-border)', marginTop: '4px', marginBottom: '12px' }}>
        {t('businesses.cardOnFile')}
      </div>
      <div style={styles.formRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>{t('businesses.last4')}</label>
          <input style={styles.input} value={form.payment_card_last4} onChange={(e) => setForm({ ...form, payment_card_last4: e.target.value })} maxLength={4} placeholder={t('businesses.last4Placeholder')} />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>{t('businesses.brand')}</label>
          <select style={styles.input} value={form.payment_card_brand} onChange={(e) => setForm({ ...form, payment_card_brand: e.target.value })}>
            <option value="">{t('businesses.none')}</option>
            <option value="visa">{t('businesses.brandVisa')}</option>
            <option value="mastercard">{t('businesses.brandMastercard')}</option>
            <option value="amex">{t('businesses.brandAmex')}</option>
            <option value="discover">{t('businesses.brandDiscover')}</option>
          </select>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>{t('businesses.expiry')}</label>
          <input style={styles.input} value={form.payment_card_exp} onChange={(e) => setForm({ ...form, payment_card_exp: e.target.value })} placeholder={t('businesses.expiryPlaceholder')} maxLength={7} />
        </div>
      </div>

      <div style={styles.formActions}>
        <Button variant="outline" type="button" onClick={onCancel}>{t('common:cancel')}</Button>
        {isCreate
          ? <Button type="submit" loading={saving}>{t('businesses.create')}</Button>
          : <Button onClick={onSave} loading={saving}>{t('businesses.saveChanges')}</Button>
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
  heading: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, margin: 0, color: 'var(--color-text)' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '560px', maxHeight: '85vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px var(--color-border)' },
  detailPanel: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-xl)', width: '95vw', maxWidth: '1100px', maxHeight: '90vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px var(--color-border)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)', margin: 0 },
  closeBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-2xl)', cursor: 'pointer', padding: '4px 8px', lineHeight: 1 },
  detailBody: { display: 'flex', flexDirection: 'column' as const, gap: '6px' },
  detailRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--color-border)' },
  detailLabel: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', fontWeight: 500 },
  detailValue: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  actions: { display: 'flex', gap: '8px', marginTop: '16px' },
  formBody: { display: 'flex', flexDirection: 'column' as const, gap: '12px' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px', flex: 1, minWidth: 0 },
  formRow: { display: 'flex', gap: '12px' },
  formActions: { display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '12px' },
  label: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', fontWeight: 500 },
  input: { backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '8px 12px', color: 'var(--color-text)', fontSize: 'var(--font-size-base)', width: '100%', boxSizing: 'border-box' as const },
  helper: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' },
  formError: { padding: '8px 12px', borderRadius: '6px', background: 'var(--color-error-bg, rgba(220,38,38,0.1))', border: '1px solid var(--color-error)', color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', marginBottom: '12px' },
};
