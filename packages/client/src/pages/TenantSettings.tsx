import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ThemeGallery } from './settings/ThemeGallery';
import { ProcessorConfigForm } from '../components/ProcessorConfigForm';
import { Button } from '../design-system/components/actions/Button';
import * as payApi from '../api/payments';
import type { TenantBillingAccount } from '../api/payments';

type SettingsTab = 'appearance' | 'payment-processors' | 'business-billing';

export function TenantSettings() {
  const { t } = useTranslation('tenant');
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'appearance', label: t('settings.tabThemes') },
    { key: 'payment-processors', label: t('settings.tabProcessors') },
    { key: 'business-billing', label: t('settings.tabBilling') },
  ];

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>{t('settings.title')}</h1>
      <div style={styles.tabBar}>
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{ ...styles.tab, ...(activeTab === tab.key ? styles.tabActive : {}) }}>
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === 'appearance' && <ThemeGallery persona="tenant" />}
      {activeTab === 'payment-processors' && <TenantPaymentProcessorsPanel />}
      {activeTab === 'business-billing' && <TenantBillingAccountPanel />}
    </div>
  );
}

/**
 * TenantPaymentProcessorsPanel — the tenant's own payment provider configuration.
 * This is the provider the tenant uses to charge its businesses (Section B).
 * Mirrors the system Payment Processors tab, one level down (owner_level='tenant').
 */
function TenantPaymentProcessorsPanel() {
  const { t } = useTranslation('tenant');
  return (
    <div style={styles.panel}>
      <h3 style={styles.panelTitle}>{t('settings.tabProcessors')}</h3>
      <p style={styles.panelSubtext}>
        {t('settings.processorsHelp')}
      </p>
      <ProcessorConfigForm owner={{ owner_level: 'tenant' }} />
    </div>
  );
}

const EMPTY_ACCOUNT: TenantBillingAccount = {
  bank_name: '', account_holder: '', account_number: '',
  routing_number: '', iban: '', swift: '',
};

/**
 * TenantBillingAccountPanel — the tenant's own receiving account, where its
 * businesses' payments are deposited. The tenant-level mirror of DayStream's
 * Platform Receiving Account (system Configuration → Platform Billing).
 */
function TenantBillingAccountPanel() {
  const { t } = useTranslation('tenant');
  const [form, setForm] = useState<TenantBillingAccount>(EMPTY_ACCOUNT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    payApi.getTenantBillingAccount()
      .then((d) => {
        if (d) {
          setForm({
            bank_name: d.bank_name || '',
            account_holder: d.account_holder || '',
            account_number: d.account_number || '',
            routing_number: d.routing_number || '',
            iban: d.iban || '',
            swift: d.swift || '',
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true); setMessage(null);
    try {
      await payApi.saveTenantBillingAccount(form);
      setMessage(t('settings.accountSaved'));
    } catch (err: any) {
      setMessage(err?.response?.data?.message || t('settings.accountSaveFailed'));
    } finally { setSaving(false); }
  };

  if (loading) return <p style={styles.panelSubtext}>{t('settings.loading')}</p>;

  return (
    <div style={styles.panel}>
      <h3 style={styles.panelTitle}>{t('settings.accountTitle')}</h3>
      <p style={styles.panelSubtext}>{t('settings.accountHelp')}</p>
      {message && <div style={styles.successMsg}>{message}</div>}
      <div style={styles.formSection}>
        <div style={styles.formRow}>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('settings.bankName')}</label>
            <input style={styles.input} value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} placeholder={t('settings.bankName')} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('settings.accountHolder')}</label>
            <input style={styles.input} value={form.account_holder} onChange={(e) => setForm({ ...form, account_holder: e.target.value })} placeholder={t('settings.accountHolderPlaceholder')} />
          </div>
        </div>
        <div style={styles.formRow}>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('settings.accountNumber')}</label>
            <input style={styles.input} value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} placeholder={t('settings.accountNumberPlaceholder')} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('settings.routingNumber')}</label>
            <input style={styles.input} value={form.routing_number} onChange={(e) => setForm({ ...form, routing_number: e.target.value })} placeholder="021000021" />
          </div>
        </div>
        <div style={styles.formRow}>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('settings.iban')}</label>
            <input style={styles.input} value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} placeholder={t('settings.ibanPlaceholder')} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('settings.swift')}</label>
            <input style={styles.input} value={form.swift} onChange={(e) => setForm({ ...form, swift: e.target.value })} placeholder={t('settings.swiftPlaceholder')} />
          </div>
        </div>
      </div>
      <div style={styles.formActions}>
        <Button onClick={handleSave} loading={saving}>{t('settings.saveConfiguration')}</Button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-xl)' },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text-title)', margin: '0 0 var(--space-lg) 0' },
  tabBar: { display: 'flex', gap: '4px', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--space-xl)' },
  tab: { padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid transparent', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)', fontWeight: 600, cursor: 'pointer' },
  tabActive: { color: 'var(--color-primary)', borderBottomColor: 'var(--color-primary)' },
  panel: { maxWidth: '720px' },
  panelTitle: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: '0 0 var(--space-xs)' },
  panelSubtext: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-md)' },
  successMsg: { padding: '8px 12px', borderRadius: 'var(--radius-md)', background: 'var(--color-success-surface, #E7F5EE)', color: 'var(--color-success, #17794A)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-md)' },
  formSection: { display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' },
  formRow: { display: 'flex', gap: 'var(--space-md)' },
  formGroup: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: 0 },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text)' },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  formActions: { marginTop: 'var(--space-lg)' },
};
