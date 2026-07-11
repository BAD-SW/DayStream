import { useState, useEffect } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { apiClient } from '../api/client';
import { formatCurrency } from '../utils/currency';

interface BillingInfo {
  billing_frequency: string;
  billing_amount: number;
  billing_method: string;
  currency: string;
  signup_date: string | null;
  next_billing_date: string | null;
  last_billing_date: string | null;
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
      setMessage('Payment method updated successfully.');
      setEditing(false);
    } catch (err: any) {
      setMessage(err.response?.data?.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  if (loading) return <p style={styles.loading}>Loading...</p>;
  if (!billing) return <p style={styles.loading}>Unable to load billing information.</p>;

  const formatAmount = (cents: number, currency: string) => {
    return formatCurrency(cents, currency);
  };

  return (
    <div>
      <h2 style={styles.heading}>Billing</h2>
      <p style={styles.subtext}>Your subscription to DayStream.</p>

      {/* Plan Summary - Read Only */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Plan Summary</h3>
        <div style={styles.summaryGrid}>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>Frequency</span>
            <span style={styles.summaryValue}>{(billing.billing_frequency || 'monthly').charAt(0).toUpperCase() + (billing.billing_frequency || 'monthly').slice(1)}</span>
          </div>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>Amount</span>
            <span style={styles.summaryValue}>{billing.billing_amount ? formatAmount(billing.billing_amount, billing.currency) : '—'}</span>
          </div>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>Next Payment</span>
            <span style={styles.summaryValue}>{billing.next_billing_date ? new Date(billing.next_billing_date).toLocaleDateString() : '—'}</span>
          </div>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>Last Payment</span>
            <span style={styles.summaryValue}>{billing.last_billing_date ? new Date(billing.last_billing_date).toLocaleDateString() : 'Never'}</span>
          </div>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>Member Since</span>
            <span style={styles.summaryValue}>{billing.signup_date ? new Date(billing.signup_date).toLocaleDateString() : '—'}</span>
          </div>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>Status</span>
            <span style={{ ...styles.summaryValue, color: 'var(--color-success)' }}>Active</span>
          </div>
        </div>
      </div>

      {/* Payment Method - Editable */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <h3 style={styles.cardTitle}>Payment Method</h3>
          {!editing && <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>}
        </div>
        {message && <div style={styles.message}>{message}</div>}

        {editing ? (
          <div style={styles.formBody}>
            <div style={styles.sectionLabel}>Primary — ACH/SEPA (Direct Debit)</div>
            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Bank Name</label>
                <input style={styles.input} value={form.payment_bank_name} onChange={(e) => setForm({ ...form, payment_bank_name: e.target.value })} placeholder="Bank Name" />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Account Holder</label>
                <input style={styles.input} value={form.payment_account_holder} onChange={(e) => setForm({ ...form, payment_account_holder: e.target.value })} placeholder="Account Holder Name" />
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

            <div style={styles.sectionLabel}>Backup — Credit Card</div>
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
              <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              <Button onClick={handleSave} loading={saving}>Save Payment Method</Button>
            </div>
          </div>
        ) : (
          <div style={styles.methodSummary}>
            <div style={styles.methodSection}>
              <div style={styles.methodLabel}>Primary — ACH/SEPA</div>
              {billing.payment_bank_name ? (
                <div style={styles.methodDetail}>
                  <span>{billing.payment_bank_name}</span>
                  <span style={styles.methodMuted}>{billing.payment_account_holder}</span>
                  <span style={styles.methodMuted}>••••{billing.payment_account_number?.slice(-4) || '—'}</span>
                </div>
              ) : (
                <span style={styles.methodMuted}>Not configured</span>
              )}
            </div>
            <div style={styles.methodSection}>
              <div style={styles.methodLabel}>Backup — Credit Card</div>
              {billing.payment_card_last4 ? (
                <div style={styles.methodDetail}>
                  <span>{(billing.payment_card_brand || '').charAt(0).toUpperCase() + (billing.payment_card_brand || '').slice(1)} ••••{billing.payment_card_last4}</span>
                  <span style={styles.methodMuted}>Expires {billing.payment_card_exp}</span>
                </div>
              ) : (
                <span style={styles.methodMuted}>Not configured</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Invoice History - Placeholder */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Invoice History</h3>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', margin: 0 }}>No invoices yet. Invoices will appear here once billing is active.</p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: '24px', fontWeight: 300, margin: '0 0 8px 0', color: 'var(--color-text)' },
  subtext: { color: 'var(--color-text-secondary)', fontSize: '14px', marginBottom: '24px' },
  loading: { color: 'var(--color-text-secondary)', fontSize: '14px' },
  card: { border: '1px solid var(--color-border)', borderRadius: '8px', padding: '20px', marginBottom: '16px' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  cardTitle: { fontSize: '16px', fontWeight: 600, color: 'var(--color-text)', margin: 0 },
  message: { padding: '8px 12px', borderRadius: '6px', background: 'var(--color-surface)', border: '1px solid var(--color-success)', color: 'var(--color-success)', fontSize: '13px', marginBottom: '12px' },
  // Summary grid
  summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px' },
  summaryItem: { display: 'flex', flexDirection: 'column' as const, gap: '2px' },
  summaryLabel: { fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500, textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  summaryValue: { fontSize: '16px', fontWeight: 600, color: 'var(--color-text)' },
  // Form
  formBody: { display: 'flex', flexDirection: 'column' as const, gap: '12px' },
  formRow: { display: 'flex', gap: '12px' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px', flex: 1, minWidth: 0 },
  formActions: { display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '12px' },
  label: { fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 },
  sectionLabel: { fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', paddingTop: '8px', borderTop: '1px solid var(--color-border)', marginTop: '4px' },
  input: { backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '8px 12px', color: 'var(--color-text)', fontSize: '14px', width: '100%', boxSizing: 'border-box' as const },
  // Method display
  methodSummary: { display: 'flex', flexDirection: 'column' as const, gap: '16px' },
  methodSection: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  methodLabel: { fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  methodDetail: { display: 'flex', flexDirection: 'column' as const, gap: '2px', fontSize: '14px', color: 'var(--color-text)' },
  methodMuted: { fontSize: '13px', color: 'var(--color-text-muted)' },
};
