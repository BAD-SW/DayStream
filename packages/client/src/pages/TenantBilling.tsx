import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../design-system/components/actions/Button';
import { apiClient } from '../api/client';
import { formatDateOnly } from '../utils/date';

interface BillingInfo {
  currency: string;
  last_billing_date: string | null;
  contract_start_date: string | null;
  contract_expire_date: string | null;
  payment_bank_name: string | null;
  payment_account_holder: string | null;
  payment_account_number: string | null;
  payment_routing_number: string | null;
  payment_iban: string | null;
  payment_card_last4: string | null;
  payment_card_brand: string | null;
  payment_card_exp: string | null;
}

interface PaymentForm {
  payment_bank_name: string;
  payment_account_holder: string;
  payment_account_number: string;
  payment_routing_number: string;
  payment_iban: string;
  payment_card_last4: string;
  payment_card_brand: string;
  payment_card_exp: string;
}

export function TenantBilling() {
  const { t } = useTranslation('tenant');
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<PaymentForm>({
    payment_bank_name: '', payment_account_holder: '',
    payment_account_number: '', payment_routing_number: '', payment_iban: '',
    payment_card_last4: '', payment_card_brand: '', payment_card_exp: '',
  });

  useEffect(() => {
    apiClient.get('/v1/admin/my-billing')
      .then((res) => {
        const d = res.data.data;
        setBilling(d);
        setForm({
          payment_bank_name: d.payment_bank_name || '',
          payment_account_holder: d.payment_account_holder || '',
          payment_account_number: d.payment_account_number || '',
          payment_routing_number: d.payment_routing_number || '',
          payment_iban: d.payment_iban || '',
          payment_card_last4: d.payment_card_last4 || '',
          payment_card_brand: d.payment_card_brand || '',
          payment_card_exp: d.payment_card_exp || '',
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true); setMessage(null);
    try {
      await apiClient.put('/v1/admin/my-billing/payment-method', form);
      setMessage(t('tenantBilling.updated'));
      setEditing(false);
    } catch (err: any) {
      setMessage(err.response?.data?.message || t('tenantBilling.saveFailed'));
    } finally { setSaving(false); }
  };

  if (loading) return <p style={styles.loading}>{t('common:loading')}</p>;
  if (!billing) return <p style={styles.loading}>{t('tenantBilling.loadFailed')}</p>;

  return (
    <div>
      <h2 style={styles.heading}>{t('tenantBilling.title')}</h2>
      <p style={styles.subtext}>{t('tenantBilling.subtitle')}</p>

      {/* Plan Summary - Read Only */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>{t('tenantBilling.planSummary')}</h3>
        <div style={styles.summaryGrid}>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>{t('tenantBilling.billing')}</span>
            <span style={styles.summaryValue}>{t('tenantBilling.monthly')}</span>
          </div>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>{t('tenantBilling.contractStart')}</span>
            <span style={styles.summaryValue}>{billing.contract_start_date ? formatDateOnly(billing.contract_start_date) : '—'}</span>
          </div>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>{t('tenantBilling.contractExpires')}</span>
            <span style={styles.summaryValue}>{billing.contract_expire_date ? formatDateOnly(billing.contract_expire_date) : '—'}</span>
          </div>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>{t('tenantBilling.lastPayment')}</span>
            <span style={styles.summaryValue}>{billing.last_billing_date ? formatDateOnly(billing.last_billing_date) : t('tenantBilling.never')}</span>
          </div>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>{t('tenantBilling.status')}</span>
            <span style={{ ...styles.summaryValue, color: 'var(--color-success)' }}>{t('tenantBilling.active')}</span>
          </div>
        </div>
      </div>

      {/* Payment Method - Editable */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <h3 style={styles.cardTitle}>{t('tenantBilling.paymentMethod')}</h3>
          {!editing && <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>{t('common:edit')}</Button>}
        </div>
        {message && <div style={styles.message}>{message}</div>}

        {editing ? (
          <div style={styles.formBody}>
            <div style={styles.sectionLabel}>{t('tenantBilling.primaryEdit')}</div>
            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>{t('tenantBilling.bankName')}</label>
                <input style={styles.input} value={form.payment_bank_name} onChange={(e) => setForm({ ...form, payment_bank_name: e.target.value })} placeholder={t('tenantBilling.bankName')} />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>{t('tenantBilling.accountHolder')}</label>
                <input style={styles.input} value={form.payment_account_holder} onChange={(e) => setForm({ ...form, payment_account_holder: e.target.value })} placeholder={t('tenantBilling.accountHolderPlaceholder')} />
              </div>
            </div>
            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>{t('tenantBilling.accountNumber')}</label>
                <input style={styles.input} value={form.payment_account_number} onChange={(e) => setForm({ ...form, payment_account_number: e.target.value })} placeholder={t('tenantBilling.accountNumberPlaceholder')} />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>{t('tenantBilling.routingIban')}</label>
                <input style={styles.input} value={form.payment_routing_number || form.payment_iban} onChange={(e) => setForm({ ...form, payment_routing_number: e.target.value })} placeholder={t('tenantBilling.routingIbanPlaceholder')} />
              </div>
            </div>

            <div style={styles.sectionLabel}>{t('tenantBilling.backupCard')}</div>
            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>{t('tenantBilling.last4')}</label>
                <input style={styles.input} value={form.payment_card_last4} onChange={(e) => setForm({ ...form, payment_card_last4: e.target.value })} maxLength={4} placeholder={t('tenantBilling.last4Placeholder')} />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>{t('tenantBilling.brand')}</label>
                <select style={styles.input} value={form.payment_card_brand} onChange={(e) => setForm({ ...form, payment_card_brand: e.target.value })}>
                  <option value="">{t('tenantBilling.none')}</option>
                  <option value="visa">{t('tenantBilling.brandVisa')}</option>
                  <option value="mastercard">{t('tenantBilling.brandMastercard')}</option>
                  <option value="amex">{t('tenantBilling.brandAmex')}</option>
                  <option value="discover">{t('tenantBilling.brandDiscover')}</option>
                </select>
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>{t('tenantBilling.expiry')}</label>
                <input style={styles.input} value={form.payment_card_exp} onChange={(e) => setForm({ ...form, payment_card_exp: e.target.value })} placeholder={t('tenantBilling.expiryPlaceholder')} maxLength={7} />
              </div>
            </div>

            <div style={styles.formActions}>
              <Button variant="outline" onClick={() => setEditing(false)}>{t('common:cancel')}</Button>
              <Button onClick={handleSave} loading={saving}>{t('tenantBilling.savePaymentMethod')}</Button>
            </div>
          </div>
        ) : (
          <div style={styles.methodSummary}>
            <div style={styles.methodSection}>
              <div style={styles.methodLabel}>{t('tenantBilling.primaryView')}</div>
              {billing.payment_bank_name ? (
                <div style={styles.methodDetail}>
                  <span>{billing.payment_bank_name}</span>
                  <span style={styles.methodMuted}>{billing.payment_account_holder}</span>
                  <span style={styles.methodMuted}>••••{billing.payment_account_number?.slice(-4) || '—'}</span>
                </div>
              ) : (
                <span style={styles.methodMuted}>{t('tenantBilling.notConfigured')}</span>
              )}
            </div>
            <div style={styles.methodSection}>
              <div style={styles.methodLabel}>{t('tenantBilling.backupCard')}</div>
              {billing.payment_card_last4 ? (
                <div style={styles.methodDetail}>
                  <span>{(billing.payment_card_brand || '').charAt(0).toUpperCase() + (billing.payment_card_brand || '').slice(1)} ••••{billing.payment_card_last4}</span>
                  <span style={styles.methodMuted}>{t('tenantBilling.expires', { date: billing.payment_card_exp })}</span>
                </div>
              ) : (
                <span style={styles.methodMuted}>{t('tenantBilling.notConfigured')}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Invoice History - Placeholder */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>{t('tenantBilling.invoiceHistory')}</h3>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)', margin: 0 }}>{t('tenantBilling.noInvoices')}</p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, margin: '0 0 8px 0', color: 'var(--color-text)' },
  subtext: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)', marginBottom: '24px' },
  loading: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)' },
  card: { border: '1px solid var(--color-border)', borderRadius: '8px', padding: '20px', marginBottom: '16px' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  cardTitle: { fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--color-text)', margin: 0 },
  message: { padding: '8px 12px', borderRadius: '6px', background: 'var(--color-surface)', border: '1px solid var(--color-success)', color: 'var(--color-success)', fontSize: 'var(--font-size-sm)', marginBottom: '12px' },
  // Summary grid
  summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px' },
  summaryItem: { display: 'flex', flexDirection: 'column' as const, gap: '2px' },
  summaryLabel: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', fontWeight: 500, textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  summaryValue: { fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--color-text)' },
  // Form
  formBody: { display: 'flex', flexDirection: 'column' as const, gap: '12px' },
  formRow: { display: 'flex', gap: '12px' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px', flex: 1, minWidth: 0 },
  formActions: { display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '12px' },
  label: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', fontWeight: 500 },
  sectionLabel: { fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', paddingTop: '8px', borderTop: '1px solid var(--color-border)', marginTop: '4px' },
  input: { backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '8px 12px', color: 'var(--color-text)', fontSize: 'var(--font-size-base)', width: '100%', boxSizing: 'border-box' as const },
  // Method display
  methodSummary: { display: 'flex', flexDirection: 'column' as const, gap: '16px' },
  methodSection: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  methodLabel: { fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  methodDetail: { display: 'flex', flexDirection: 'column' as const, gap: '2px', fontSize: 'var(--font-size-base)', color: 'var(--color-text)' },
  methodMuted: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' },
};
