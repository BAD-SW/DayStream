import { askConfirm, showMessage } from '../design-system/components/feedback/dialogs';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '../design-system/components/actions/Button';
import { apiClient } from '../api/client';
import { useBusinessSettings } from '../context/BusinessSettingsContext';
import { useContextManager } from '../context/ContextManager';
import { ThemeGallery } from './settings/ThemeGallery';
import { LeadStagesSettings } from './settings/LeadStagesSettings';
import { ProcessorConfigForm } from '../components/ProcessorConfigForm';
import { PageHeader } from '../design-system/components/layout/PageHeader';
import { StickyPageTop } from '../design-system/components/layout/StickyPageTop';
import { TabBar } from '../design-system/components/navigation/TabBar';
import { DraftSectionsProvider, DraftTab, useDraftSections, useDraft, draftBox, UnsavedTag, fieldMark, checkMark, toggleMark } from '../components/unsaved/DraftSections';
import { LeaveGuard } from '../components/unsaved/LeaveGuard';
import * as payApi from '../api/payments';
import * as checkoutApi from '../api/checkout';
import * as bookingsApi from '../api/bookings';
import { BOOKINGS_VIEW_OPTIONS, getBookingsView, saveBusinessBookingsView } from '../api/bookingsView';
import type { BookingsView } from '../api/bookingsView';
import { InboxSettings } from './settings/InboxSettings';
import { KioskSettings } from './settings/KioskSettings';
import { PeopleListSettings } from './settings/PeopleListSettings';
import { TIMEZONES } from '../utils/timezones';
import { SUPPORTED_LANGUAGES, LANGUAGE_DETAILS } from '@daystream/shared';
import { getBusinessLanguages, setBusinessLanguages } from '../api/translations';
import { rememberBusinessLanguages } from '../context/useBusinessLanguages';
import { formatDateTime } from '../utils/format';

type SettingsTab = 'system' | 'lifecycle' | 'leads' | 'inbox' | 'people-lists' | 'processes' | 'kiosk' | 'notifications' | 'payment-methods' | 'integrations' | 'booking-widget' | 'appearance';

// The tab names come from business.tab.<key>, looked up where the tabs are shown.
const TABS: { key: SettingsTab; separatorBefore?: boolean }[] = [
  { key: 'system' },
  { key: 'lifecycle' },
  { key: 'leads' },
  { key: 'inbox' },
  { key: 'people-lists' },
  { key: 'notifications' },
  { key: 'payment-methods' },
  { key: 'integrations' },
  { key: 'booking-widget' },
  // Processes and Appearance act straight away with their own buttons (David, 2026-10-28):
  // they sit apart, after a separator, and are not part of Save changes.
  { key: 'processes', separatorBefore: true },
  { key: 'kiosk' },
  { key: 'appearance' },
];

export function BusinessSettings() {
  return (
    <DraftSectionsProvider>
      <SettingsPage />
    </DraftSectionsProvider>
  );
}

// One Save for all of Settings (David, 2026-10-28): every tab stays mounted so its
// edits survive switching tabs; tabs and sections with unsaved changes are marked, and
// leaving with unsaved changes asks first.
function SettingsPage() {
  const { t } = useTranslation('settings');
  // The section can be opened by address (e.g. /settings?tab=leads from Marketing → Leads).
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTabState] = useState<SettingsTab>(() => (searchParams.get('tab') as SettingsTab) || 'system');
  const setActiveTab = (tab: SettingsTab) => { setActiveTabState(tab); setSearchParams(tab === 'system' ? {} : { tab }, { replace: true }); };
  const { dirtySections, saveAll, saving } = useDraftSections();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = dirtySections.length > 0;
  const changedTabs = new Set(dirtySections.map((s) => s.tab));

  useEffect(() => { setResult((r) => (dirty ? (r?.ok ? null : r) : (r && !r.ok ? null : r))); }, [dirty]);

  const save = async () => {
    const { failed } = await saveAll();
    setResult(failed.length
      ? { ok: false, text: t('business.notSaved', { list: failed.map((f) => `${f.label} (${f.error})`).join('; ') }) }
      : { ok: true, text: t('business.allSaved') });
  };

  // A failed save says what was not saved, even while those changes are still unsaved.
  const status = dirty && !(result && !result.ok)
    ? <span style={{ color: 'var(--color-warning-dark)' }}>{t('business.unsaved')}</span>
    : result ? <span role={result.ok ? 'status' : 'alert'} style={{ color: result.ok ? 'var(--color-success)' : 'var(--color-error)' }}>{result.text}</span> : null;

  return (
    <div style={styles.page}>
      <LeaveGuard when={dirty} />
      <StickyPageTop>
        <PageHeader
          title={t('common:settings')}
          actions={<>{status && <span style={{ fontSize: 'var(--font-size-sm)' }}>{status}</span>}<Button onClick={save} loading={saving} disabled={!dirty}>{t('business.saveChanges')}</Button></>}
        />
        <TabBar aria-label={t('business.sections')} tabs={TABS.map((tab) => ({ ...tab, label: t(`business.tab.${tab.key}`), changed: changedTabs.has(tab.key) }))} active={activeTab} onChange={setActiveTab} />
      </StickyPageTop>
      {TABS.map((tab) => (
        <div key={tab.key} hidden={activeTab !== tab.key}>
          <DraftTab tab={tab.key}>{renderTab(tab.key)}</DraftTab>
        </div>
      ))}
    </div>
  );
}

function renderTab(tab: SettingsTab) {
  switch (tab) {
    case 'system': return <SystemSettings />;
    case 'lifecycle': return <LifecycleSettings />;
    case 'leads': return <LeadStagesSettings />;
    case 'inbox': return <InboxSettings />;
    case 'people-lists': return <PeopleListSettings />;
    case 'processes': return <ProcessesSettings />;
    case 'kiosk': return <KioskSettings />;
    case 'notifications': return <NotificationSettings />;
    case 'payment-methods': return <PaymentMethodsSettings />;
    case 'integrations': return <IntegrationsSettings />;
    case 'booking-widget': return <BookingWidgetSettings />;
    case 'appearance': return <AppearanceSettings />;
  }
}


// ============================================================
// System Settings
// ============================================================

function SystemSettings() {
  const { t } = useTranslation('settings');
  const businessId = localStorage.getItem('business_id') || '';
  const { refresh: refreshBusinessSettings } = useBusinessSettings();
  const [loading, setLoading] = useState(true);
  const scheduling = useDraft<string>('scheduling', t('business.system.schedulingDraft'), 'availability', async (mode) => {
    await apiClient.put(`/v1/admin/businesses/${businessId}/settings`, { scheduling_mode: mode });
    refreshBusinessSettings(); // Update sidebar and dashboard immediately
  });

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    apiClient.get(`/v1/admin/businesses/${businessId}/settings`)
      .then((res) => {
        const data = res.data.data;
        if (data) scheduling.load(data.scheduling_mode || 'availability');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [businessId, scheduling.load]);

  if (loading) return <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)' }}>{t('common:loading')}</p>;

  return (
    <>
    <div style={settingStyles.section}>
      <h3 style={settingStyles.sectionTitle}>{t('business.system.scheduling')}<UnsavedTag dirty={scheduling.dirty} /></h3>
      <div style={{ ...settingStyles.settingRow, ...draftBox(scheduling.dirty) }}>
        <div style={settingStyles.settingInfo}>
          <label style={settingStyles.settingLabel}>{t('business.system.useStaffSchedule')}</label>
          <p style={settingStyles.settingDesc}>
            {t('business.system.useStaffScheduleHelp')}
          </p>
        </div>
        <label style={settingStyles.toggle}>
          <input
            type="checkbox"
            checked={scheduling.value === 'schedule'}
            onChange={(e) => scheduling.setValue(e.target.checked ? 'schedule' : 'availability')}
            style={{ width: '18px', height: '18px', ...checkMark(scheduling.dirty) }}
          />
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', marginLeft: '8px' }}>
            {scheduling.value === 'schedule' ? t('business.enabled') : t('business.disabled')}
          </span>
        </label>
      </div>
    </div>
    <LanguagesSetting />
    <BookingsViewSetting />
    <CustomerCancellationSettings />
    <PayrollFrequencySettings />
    <CommissionRefundSetting />
    </>
  );
}

// The languages the business works in (Phase 44, requirement 8): a checkbox for each language on
// DayStream's list. The default language is always on; it is changed in the business details.
function LanguagesSetting() {
  const { t } = useTranslation('settings');
  const { activeContext } = useContextManager();
  const businessId = activeContext.businessId ?? '';
  const [defaultLanguage, setDefaultLanguage] = useState<string | null>(null);
  const draft = useDraft<string[]>('languages', t('business.languages.draftName'), [], async (chosen) => {
    const saved = await setBusinessLanguages(businessId, chosen);
    rememberBusinessLanguages(businessId, saved);
    return saved.languages;
  });
  useEffect(() => {
    if (!businessId) return;
    getBusinessLanguages(businessId)
      .then((data) => { setDefaultLanguage(data.default_language); draft.load(data.languages); })
      .catch(() => {});
  }, [businessId, draft.load]);
  if (!defaultLanguage) return null;
  const toggle = (code: string, on: boolean) => {
    const next = on ? [...draft.value, code] : draft.value.filter((c) => c !== code);
    draft.setValue(SUPPORTED_LANGUAGES.filter((c) => c === defaultLanguage || next.includes(c)));
  };
  return (
    <div style={settingStyles.section} data-testid="languages-setting">
      <h3 style={settingStyles.sectionTitle}>{t('business.languages.title')}<UnsavedTag dirty={draft.dirty} /></h3>
      <div style={{ ...settingStyles.settingRow, flexDirection: 'column' as const, gap: 'var(--space-sm)', ...draftBox(draft.dirty) }}>
        <p style={settingStyles.settingDesc}>{t('business.languages.intro')}</p>
        <div role="group" aria-label={t('business.languages.listLabel')} style={{ display: 'flex', flexDirection: 'column' as const }}>
          {SUPPORTED_LANGUAGES.map((code) => {
            const isDefault = code === defaultLanguage;
            const on = draft.value.includes(code);
            return (
              <label key={code} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', minHeight: '44px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', cursor: isDefault ? 'default' : 'pointer' }}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={isDefault}
                  onChange={(e) => toggle(code, e.target.checked)}
                  style={{ width: '18px', height: '18px', ...checkMark(draft.changed((v) => v.includes(code))) }}
                />
                <span lang={code}>{LANGUAGE_DETAILS[code].label}</span>
                {isDefault && <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>{t('business.languages.defaultHelp')}</span>}
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
// Which screen Bookings opens on for staff (spec 51, gap 3): the calendar, or the list with the
// Waiting list. Each staff member can choose differently on their profile.
function BookingsViewSetting() {
  const { t } = useTranslation('settings');
  const businessId = localStorage.getItem('business_id') || '';
  const [loaded, setLoaded] = useState(false);
  const draft = useDraft<BookingsView>('bookings-view', t('business.bookingsView.draftName'), 'calendar', async (view) => {
    await saveBusinessBookingsView(businessId, view);
  });

  useEffect(() => {
    if (!businessId) return;
    getBookingsView(businessId)
      .then((r) => { draft.load(r.business); setLoaded(true); })
      .catch(() => {});
  }, [businessId, draft.load]);

  if (!loaded) return null;
  return (
    <div style={settingStyles.section}>
      <h3 style={settingStyles.sectionTitle}>{t('business.bookingsView.title')}<UnsavedTag dirty={draft.dirty} /></h3>
      <div style={{ ...settingStyles.settingRow, flexDirection: 'column' as const, gap: '10px', ...draftBox(draft.dirty) }}>
        <div style={settingStyles.settingInfo}>
          <label style={settingStyles.settingLabel} htmlFor="bookings-view">{t('business.bookingsView.opensOn')}</label>
          <p style={settingStyles.settingDesc}>
            {t('business.bookingsView.help')}
          </p>
        </div>
        <select id="bookings-view" value={draft.value} onChange={(e) => draft.setValue(e.target.value as BookingsView)}
          style={{ padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: 'var(--font-size-sm)', alignSelf: 'flex-start', ...fieldMark(draft.dirty) }}>
          {BOOKINGS_VIEW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    </div>
  );
}

// Customer cancellations (THE-20): may customers cancel, up to how long before the start,
// and where the money of a paid cancellation goes. Set separately for events and appointments.
function CustomerCancellationSettings() {
  const { t } = useTranslation('settings');
  const businessId = localStorage.getItem('business_id') || '';
  const [settings, setSettings] = useState<{ events: bookingsApi.CancelSettings; appointments: bookingsApi.CancelSettings } | null>(null);

  useEffect(() => {
    if (!businessId) return;
    bookingsApi.getCancellationSettings(businessId).then((s) => setSettings({ events: s.events, appointments: s.appointments })).catch(() => {});
  }, [businessId]);

  if (!settings) return null;
  return (
    <div style={settingStyles.section}>
      <h3 style={settingStyles.sectionTitle}>{t('business.cancel.title')}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <CancellationBlock kind="appointments" label={t('business.cancel.appointments')} initial={settings.appointments} businessId={businessId} />
        <CancellationBlock kind="events" label={t('business.cancel.events')} initial={settings.events} businessId={businessId} />
      </div>
    </div>
  );
}

interface CancelDraft { enabled: boolean; amount: number; unit: 'hours' | 'days'; refundTo: bookingsApi.CancelSettings['cancel_refund_to']; changeDays: number }

function toCancelDraft(s: bookingsApi.CancelSettings): CancelDraft {
  const inDays = s.customer_cancel_hours > 0 && s.customer_cancel_hours % 24 === 0;
  return { enabled: s.customer_cancel_enabled, amount: inDays ? s.customer_cancel_hours / 24 : s.customer_cancel_hours, unit: inDays ? 'days' : 'hours', refundTo: s.cancel_refund_to, changeDays: s.change_refund_days ?? 7 };
}

function CancellationBlock({ kind, label, initial, businessId }: { kind: 'events' | 'appointments'; label: string; initial: bookingsApi.CancelSettings; businessId: string }) {
  const { t } = useTranslation('settings');
  const draft = useDraft<CancelDraft>(`cancel-${kind}`, t('business.cancel.draftName', { label }), toCancelDraft(initial), async (d) => {
    await bookingsApi.saveCancellationSettings(businessId, kind, {
      customer_cancel_enabled: d.enabled,
      customer_cancel_hours: Math.round(Number(d.amount) || 0) * (d.unit === 'days' ? 24 : 1),
      cancel_refund_to: d.refundTo,
      ...(kind === 'events' ? { change_refund_days: Math.max(0, Math.round(Number(d.changeDays) || 0)) } : {}),
    });
  });
  const { enabled, amount, unit, refundTo, changeDays } = draft.value;
  const set = (patch: Partial<CancelDraft>) => draft.setValue({ ...draft.value, ...patch });

  const field = { padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: 'var(--font-size-sm)', background: 'var(--color-surface)', color: 'var(--color-text)' };
  return (
    <div style={{ ...settingStyles.settingRow, flexDirection: 'column' as const, gap: '12px', ...draftBox(draft.dirty) }} data-testid={`cancel-settings-${kind}`}>
      <div style={settingStyles.settingInfo}>
        <label style={settingStyles.settingLabel}>{label}<UnsavedTag dirty={draft.dirty} /></label>
        <p style={settingStyles.settingDesc}>{t(`business.cancel.whether.${kind}`)}</p>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => set({ enabled: e.target.checked })} style={{ width: '18px', height: '18px', ...checkMark(draft.changed((v) => v.enabled)) }} />
        {t('business.cancel.customersCanCancel')}
      </label>
      {enabled && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const, fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
            {t('business.cancel.upTo')}
            <input type="number" min={0} max={unit === 'days' ? 90 : 2160} value={amount} onChange={(e) => set({ amount: Number(e.target.value) })} style={{ ...field, width: '80px', ...fieldMark(draft.changed((v) => v.amount)) }} aria-label={t('business.cancel.howLongBefore')} />
            <select value={unit} onChange={(e) => set({ unit: e.target.value as 'hours' | 'days' })} style={{ ...field, ...fieldMark(draft.changed((v) => v.unit)) }} aria-label={t('business.cancel.unit')}>
              <option value="hours">{t('business.cancel.hours')}</option>
              <option value="days">{t('business.cancel.days')}</option>
            </select>
            {t(`business.cancel.beforeStarts.${kind}`)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '6px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>{t(`business.cancel.moneyGoes.${kind}`)}</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="radio" name={`refund-${kind}`} checked={refundTo === 'card'} onChange={() => set({ refundTo: 'card' })} style={checkMark(draft.changed((v) => v.refundTo) && refundTo === 'card')} /> {t('business.cancel.toCard')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="radio" name={`refund-${kind}`} checked={refundTo === 'credit'} onChange={() => set({ refundTo: 'credit' })} style={checkMark(draft.changed((v) => v.refundTo) && refundTo === 'credit')} /> {t('business.cancel.toCredit')}
            </label>
          </div>
        </>
      )}
      {/* After a date, time or place change, registered people can cancel for a full refund (decision 14). */}
      {kind === 'events' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const, fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
          <Trans i18nKey="business.cancel.afterChange" ns="settings" components={{
            days: <input type="number" min={0} max={90} value={changeDays} onChange={(e) => set({ changeDays: Number(e.target.value) })} style={{ ...field, width: '70px', ...fieldMark(draft.changed((v) => v.changeDays)) }} aria-label={t('business.cancel.daysAfterChange')} />,
          }} />
        </div>
      )}
    </div>
  );
}

function PayrollFrequencySettings() {
  const { t } = useTranslation('settings');
  const businessId = localStorage.getItem('business_id') || '';
  const [loading, setLoading] = useState(true);
  const draft = useDraft('payroll', t('business.payroll.draftName'), { payFrequency: 'monthly', startDate: '' }, async (d) => {
    await apiClient.put(`/v1/payroll/settings?business_id=${businessId}`, {
      pay_frequency: d.payFrequency,
      pay_period_start_date: d.startDate || null,
    });
  });

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    apiClient.get(`/v1/payroll/settings?business_id=${businessId}`)
      .then((res) => {
        const data = res.data.data;
        if (data) {
          draft.load({
            payFrequency: data.pay_frequency || 'monthly',
            startDate: data.pay_period_start_date ? data.pay_period_start_date.slice(0, 10) : '',
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [businessId, draft.load]);

  if (loading) return null;

  return (
    <div style={settingStyles.section}>
      <h3 style={settingStyles.sectionTitle}>{t('business.payroll.title')}<UnsavedTag dirty={draft.dirty} /></h3>
      <div style={{ ...settingStyles.settingRow, flexDirection: 'column' as const, gap: '12px', ...draftBox(draft.dirty) }}>
        <div style={settingStyles.settingInfo}>
          <label style={settingStyles.settingLabel}>{t('business.payroll.payFrequency')}</label>
          <p style={settingStyles.settingDesc}>{t('business.payroll.payFrequencyHelp')}</p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' as const }}>
          <div>
            <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>{t('business.payroll.frequency')}</label>
            <select value={draft.value.payFrequency} onChange={(e) => draft.setValue({ ...draft.value, payFrequency: e.target.value })} style={{ padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: 'var(--font-size-sm)', ...fieldMark(draft.changed((v) => v.payFrequency)) }}>
              <option value="weekly">{t('business.payroll.weekly')}</option>
              <option value="biweekly">{t('business.payroll.biweekly')}</option>
              <option value="semi_monthly">{t('business.payroll.semiMonthly')}</option>
              <option value="monthly">{t('business.payroll.monthly')}</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>{t('business.payroll.periodStart')}</label>
            <input type="date" value={draft.value.startDate} onChange={(e) => draft.setValue({ ...draft.value, startDate: e.target.value })} style={{ padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: 'var(--font-size-sm)', ...fieldMark(draft.changed((v) => v.startDate)) }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Commission after a refund (THE-21): take the commission on the refunded part back in the
// pay period of the refund (default), or keep it. Finalized pay periods never change.
function CommissionRefundSetting() {
  const { t } = useTranslation('settings');
  const businessId = localStorage.getItem('business_id') || '';
  const [loaded, setLoaded] = useState(false);
  const draft = useDraft<boolean>('commission-refunds', t('business.commission.draftName'), true, async (takeBack) => {
    await apiClient.put(`/v1/payroll/settings/commission-refunds?business_id=${businessId}`, { take_back: takeBack });
  });

  useEffect(() => {
    if (!businessId) return;
    apiClient.get(`/v1/payroll/settings/commission-refunds?business_id=${businessId}`)
      .then((res) => { draft.load(!!res.data.data?.take_back); setLoaded(true); })
      .catch(() => {});
  }, [businessId, draft.load]);

  if (!loaded) return null;
  return (
    <div style={settingStyles.section} data-testid="commission-refund-setting">
      <div style={{ ...settingStyles.settingRow, flexDirection: 'column' as const, gap: '10px', ...draftBox(draft.dirty) }}>
        <div style={settingStyles.settingInfo}>
          <label style={settingStyles.settingLabel}>{t('business.commission.title')}<UnsavedTag dirty={draft.dirty} /></label>
          <p style={settingStyles.settingDesc}>
            {t('business.commission.help')}
          </p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
          <input type="radio" name="commission-refunds" checked={draft.value} onChange={() => draft.setValue(true)} style={checkMark(draft.dirty && draft.value)} />
          {t('business.commission.takeBack')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
          <input type="radio" name="commission-refunds" checked={!draft.value} onChange={() => draft.setValue(false)} style={checkMark(draft.dirty && !draft.value)} />
          {t('business.commission.keep')}
        </label>
      </div>
    </div>
  );
}

const settingStyles: Record<string, React.CSSProperties> = {
  section: { marginBottom: 'var(--space-xl)' },
  sectionTitle: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-md)', fontWeight: 600 as any, color: 'var(--color-text)' },
  settingRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface)' },
  settingInfo: { flex: 1 },
  settingLabel: { fontSize: 'var(--font-size-sm)', fontWeight: 600 as any, color: 'var(--color-text)', display: 'block', marginBottom: '4px' },
  settingDesc: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', margin: 0, maxWidth: '500px', lineHeight: 1.4 },
  toggle: { display: 'flex', alignItems: 'center', cursor: 'pointer', flexShrink: 0 },
};

// ============================================================
// Lifecycle Settings
// ============================================================

function LifecycleSettings() {
  const { t } = useTranslation('settings');
  const businessId = localStorage.getItem('business_id') || '';
  const [loading, setLoading] = useState(true);
  const draft = useDraft('lifecycle', t('business.lifecycle.draftName'), {
    enabled: true,
    at_risk_days: 30,
    churned_days: 60,
    run_time: '02:00',
  }, async (config) => {
    await apiClient.put(`/v1/customers/lifecycle-config?business_id=${businessId}`, config);
  });
  const config = draft.value;
  const setConfig = draft.setValue;

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    apiClient.get(`/v1/customers/lifecycle-config?business_id=${businessId}`)
      .then((res) => {
        const d = res.data.data;
        if (d) {
          draft.load({
            enabled: d.enabled ?? true,
            at_risk_days: d.at_risk_days ?? 30,
            churned_days: d.churned_days ?? 60,
            run_time: d.run_time || '02:00',
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [businessId, draft.load]);

  if (loading) return <p style={styles.muted}>{t('common:loading')}</p>;

  return (
    <div style={{ ...styles.section, ...draftBox(draft.dirty) }}>
      <h2 style={styles.sectionTitle}>{t('business.lifecycle.title')}<UnsavedTag dirty={draft.dirty} /></h2>
      <p style={styles.description}>
        {t('business.lifecycle.intro')}
      </p>

      <div style={styles.field}>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={config.enabled} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} style={checkMark(draft.changed((v) => v.enabled))} />
          <span>{t('business.lifecycle.enable')}</span>
        </label>
      </div>

      {config.enabled && (
        <>
          <div style={styles.fieldRow}>
            <div style={styles.field}>
              <label style={styles.label}>{t('business.lifecycle.daysAtRisk')}</label>
              <input style={{ ...styles.input, ...fieldMark(draft.changed((v) => v.at_risk_days)) }} type="number" min={1} value={config.at_risk_days}
                onChange={(e) => setConfig({ ...config, at_risk_days: parseInt(e.target.value) || 30 })} />
              <span style={styles.helper}>{t('business.lifecycle.daysAtRiskHelp')}</span>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>{t('business.lifecycle.daysChurned')}</label>
              <input style={{ ...styles.input, ...fieldMark(draft.changed((v) => v.churned_days)) }} type="number" min={1} value={config.churned_days}
                onChange={(e) => setConfig({ ...config, churned_days: parseInt(e.target.value) || 60 })} />
              <span style={styles.helper}>{t('business.lifecycle.daysChurnedHelp')}</span>
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>{t('business.lifecycle.evalTime')}</label>
            <input style={{ ...styles.input, ...fieldMark(draft.changed((v) => v.run_time)) }} type="time" value={config.run_time}
              onChange={(e) => setConfig({ ...config, run_time: e.target.value })} />
            <span style={styles.helper}>{t('business.lifecycle.evalTimeHelp')}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// Processes Settings
// ============================================================

// Sunday = 0. The short day names come from business.processes.dayShort.<index>.
const DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6];

function ProcessesSettings() {
  const { t } = useTranslation('settings');
  // A stored value (a schedule frequency or a run status) is shown through a key; an unknown one shows as it is.
  const frequencyText = (f: string) => t(`business.processes.frequencyLower.${f}`, { defaultValue: f });
  const statusText = (s: string) => t(`business.processes.status.${s}`, { defaultValue: s });
  const businessId = localStorage.getItem('business_id') || '';
  const [processTypes, setProcessTypes] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [businessTimezone, setBusinessTimezone] = useState('UTC');
  const [loading, setLoading] = useState(true);
  const [expandedProcess, setExpandedProcess] = useState<string | null>(null);
  const [runPanel, setRunPanel] = useState<string | null>(null);
  const [runForm, setRunForm] = useState({ dateFrom: '', dateTo: '', postingDate: '' });
  const [runResult, setRunResult] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [scheduleForm, setScheduleForm] = useState<any>(null);
  const [selectedHistory, setSelectedHistory] = useState<{ type: string; entries: any[] } | null>(null);
  // Membership Renewals retry parameters (C6.4): max retries + days between.
  const [retryParams, setRetryParams] = useState<payApi.RenewalRetryParams | null>(null);
  const [savingRetry, setSavingRetry] = useState(false);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    Promise.all([
      apiClient.get('/v1/customers/scheduled-jobs/types').then(r => r.data.data),
      apiClient.get(`/v1/customers/scheduled-jobs?business_id=${businessId}`).then(r => r.data.data),
      apiClient.get('/v1/admin/businesses').then(r => {
        const biz = r.data.data?.find((b: any) => b.id === businessId);
        return biz?.timezone || 'UTC';
      }),
    ]).then(([types, existingJobs, tz]) => {
      setProcessTypes(types || []);
      setJobs(existingJobs || []);
      setBusinessTimezone(tz);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [businessId]);

  // Load the renewal retry parameters when the Membership Renewals process is expanded.
  useEffect(() => {
    if (expandedProcess !== 'billing_process' || !businessId) return;
    payApi.getRenewalRetryParams(businessId).then(setRetryParams).catch(() => setRetryParams(null));
  }, [expandedProcess, businessId]);

  const saveRetryParams = async () => {
    if (!retryParams || !businessId) return;
    setSavingRetry(true);
    try {
      const saved = await payApi.saveRenewalRetryParams(businessId, retryParams);
      setRetryParams(saved);
    } catch { /* surfaced inline; keep the entered values */ }
    finally { setSavingRetry(false); }
  };

  const getJobForType = (type: string) => jobs.find((j: any) => j.job_type === type);

  const handleRunNow = (type: string) => {
    if (runPanel === type) { setRunPanel(null); setRunResult(null); return; }
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    setRunPanel(type);
    setRunForm({ dateFrom: yesterday, dateTo: today, postingDate: today });
    setRunResult(null);
  };

  const executeRun = async () => {
    if (!runPanel) return;
    setRunning(true);
    setRunResult(null);
    try {
      const body: any = { job_type: runPanel };
      if (runForm.dateFrom) body.date_from = runForm.dateFrom;
      if (runForm.dateTo) body.date_to = runForm.dateTo;
      // Posting date only applies to revenue recognition — recurring charges post on
      // the real (current) charge date to reconcile with Stripe (see field above).
      if (runForm.postingDate && runPanel === 'revenue_recognition') body.posting_date = runForm.postingDate;
      const res = await apiClient.post(`/v1/customers/scheduled-jobs/run?business_id=${businessId}`, body);
      setRunResult(res.data.data);
    } catch (err: any) {
      setRunResult({ status: 'failed', error: err.response?.data?.message || err.message });
    } finally { setRunning(false); }
  };

  const handleScheduleToggle = async (type: string) => {
    const existingJob = getJobForType(type);
    if (existingJob) {
      const res = await apiClient.put(`/v1/customers/scheduled-jobs/${existingJob.id}/toggle`);
      setJobs(jobs.map((j: any) => j.id === existingJob.id ? { ...j, enabled: res.data.data.enabled } : j));
    } else {
      setScheduleForm({ type, frequency: 'daily', schedule_time: '02:00', day_of_week: [1, 2, 3, 4, 5], day_of_month: 1 });
    }
  };

  const saveSchedule = async () => {
    if (!scheduleForm) return;
    try {
      const res = await apiClient.post(`/v1/customers/scheduled-jobs?business_id=${businessId}`, {
        job_type: scheduleForm.type,
        schedule_time: scheduleForm.schedule_time,
        schedule_timezone: businessTimezone,
        frequency: scheduleForm.frequency,
        day_of_week: scheduleForm.frequency === 'weekly' ? scheduleForm.day_of_week : null,
        day_of_month: scheduleForm.frequency === 'monthly' ? scheduleForm.day_of_month : null,
      });
      setJobs([...jobs.filter((j: any) => j.job_type !== scheduleForm.type), res.data.data]);
      setScheduleForm(null);
    } catch { void showMessage({ message: t('business.processes.saveScheduleFailed'), tone: 'error' }); }
  };

  const handleDeleteSchedule = async (type: string) => {
    const job = getJobForType(type);
    if (!job) return;
    if (!(await askConfirm({ message: t('business.processes.removeConfirm'), confirmLabel: t('common:action.remove'), destructive: true }))) return;
    await apiClient.delete(`/v1/customers/scheduled-jobs/${job.id}`);
    setJobs(jobs.filter((j: any) => j.id !== job.id));
  };

  const handleViewHistory = async (type: string) => {
    if (selectedHistory?.type === type) { setSelectedHistory(null); return; }
    const job = getJobForType(type);
    if (!job) { setSelectedHistory({ type, entries: [] }); return; }
    const res = await apiClient.get(`/v1/customers/scheduled-jobs/${job.id}/history`);
    setSelectedHistory({ type, entries: res.data.data || [] });
  };

  if (loading) return <p style={styles.muted}>{t('common:loading')}</p>;

  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>{t('business.processes.title')}</h2>
      <p style={styles.description}>
        <Trans i18nKey="business.processes.intro" ns="settings" values={{ timezone: businessTimezone }} components={{ strong: <strong /> }} />
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {processTypes.map((proc: any) => {
          const job = getJobForType(proc.type);
          const isExpanded = expandedProcess === proc.type;
          return (
            <div key={proc.type} style={{ border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', background: isExpanded ? 'var(--color-background)' : undefined }}
                onClick={() => setExpandedProcess(isExpanded ? null : proc.type)}>
                <div>
                  <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{proc.label}</span>
                  <span style={{ marginLeft: '12px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{proc.description}</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                  {job && (
                    <span style={{ fontSize: 'var(--font-size-xs)', color: job.enabled ? 'var(--color-success)' : 'var(--color-text-muted)', marginRight: '4px' }}>
                      {job.enabled ? t('business.processes.scheduleBadge', { frequency: frequencyText(job.frequency), time: job.schedule_time }) : t('business.processes.disabledBadge')}
                    </span>
                  )}
                  <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }} onClick={() => handleRunNow(proc.type)}>{t('business.processes.run')}</button>
                  <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }} onClick={() => { setExpandedProcess(expandedProcess === proc.type ? null : proc.type); if (!job && expandedProcess !== proc.type) handleScheduleToggle(proc.type); }}>{t('business.processes.schedule')}</button>
                  <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }} onClick={() => handleViewHistory(proc.type)}>{t('business.processes.history')}</button>
                </div>
              </div>

              {runPanel === proc.type && (
                <div style={{ padding: '8px 16px 12px', borderTop: '1px solid var(--color-border)', background: 'var(--color-background)' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('business.processes.from')}
                      <input style={{ ...styles.input, marginLeft: '4px', maxWidth: '150px' }} type="date" value={runForm.dateFrom} onChange={(e) => setRunForm({ ...runForm, dateFrom: e.target.value })} />
                    </label>
                    <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('business.processes.to')}
                      <input style={{ ...styles.input, marginLeft: '4px', maxWidth: '150px' }} type="date" value={runForm.dateTo} onChange={(e) => setRunForm({ ...runForm, dateTo: e.target.value })} />
                    </label>
                    {/* Posting Date applies only to revenue recognition. Recurring
                        charges (billing_process) raise a real card charge "now" — the
                        payment + its GL entry must carry the actual charge date so they
                        reconcile with Stripe, so no posting-date override is offered. */}
                    {proc.type === 'revenue_recognition' && (
                      <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('business.processes.postingDate')}
                        <input style={{ ...styles.input, marginLeft: '4px', maxWidth: '150px' }} type="date" value={runForm.postingDate} onChange={(e) => setRunForm({ ...runForm, postingDate: e.target.value })} />
                      </label>
                    )}
                    <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 14px', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-primary)' }} onClick={executeRun} disabled={running}>
                      {running ? t('business.processes.running') : t('business.processes.execute')}
                    </button>
                  </div>
                  {runResult && (
                    <div style={{ marginTop: '8px', fontSize: 'var(--font-size-sm)', padding: '8px', borderRadius: '4px', background: runResult.status === 'failed' ? 'var(--color-error-bg, #fff0f0)' : 'var(--color-success-bg, #f0fff0)', color: runResult.status === 'failed' ? 'var(--color-error)' : 'var(--color-success)' }}>
                      {runResult.status === 'failed' ? (
                        <span>{t('business.processes.failedWith', { error: runResult.error })}</span>
                      ) : (
                        <span>
                          {t('business.processes.success', { ms: runResult.duration_ms })}
                          {runResult.result?.journalEntriesCreated !== undefined && (
                            <> {t('business.processes.entriesCreated', { created: runResult.result.journalEntriesCreated, dates: runResult.result.datesProcessed, skipped: runResult.result.skipped })}</>
                          )}
                          {runResult.result?.transitioned !== undefined && (
                            <> {t('business.processes.transitioned', { count: runResult.result.transitioned })}</>
                          )}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {selectedHistory?.type === proc.type && selectedHistory && (
                <div style={{ padding: '8px 16px 12px', borderTop: '1px solid var(--color-border)' }}>
                  {selectedHistory.entries.length === 0 ? <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>{t('business.processes.noHistory')}</p> : (
                    selectedHistory.entries.slice(0, 10).map((e: any) => (
                      <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-sm)', padding: '4px 0', borderBottom: '1px solid var(--color-border)' }}>
                        <span>{formatDateTime(e.started_at, businessTimezone)} ({businessTimezone})</span>
                        <span style={{ color: e.status === 'success' ? 'var(--color-success)' : 'var(--color-error)' }}>{statusText(e.status)} {e.duration_ms ? `(${e.duration_ms}ms)` : ''}</span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {isExpanded && (
                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border)' }}>
                  {job ? (
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
                        <Trans
                          i18nKey={job.frequency === 'weekly' && job.day_of_week != null ? 'business.processes.scheduleWeekly' : job.frequency === 'monthly' && job.day_of_month != null ? 'business.processes.scheduleMonthly' : 'business.processes.scheduleLine'}
                          ns="settings"
                          values={{
                            frequency: frequencyText(job.frequency),
                            time: job.schedule_time,
                            days: (Array.isArray(job.day_of_week) ? job.day_of_week : [job.day_of_week]).map((d: number) => t(`business.processes.dayShort.${d}`)).join(', '),
                            day: job.day_of_month === -1 ? t('business.processes.lastDay') : job.day_of_month,
                          }}
                          components={{ strong: <strong /> }}
                        />
                      </span>
                      <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: 'var(--font-size-sm)', color: job.enabled ? 'var(--color-success)' : 'var(--color-text-secondary)' }} onClick={() => handleScheduleToggle(proc.type)}>
                        {job.enabled ? t('business.processes.enabledBadge') : t('business.processes.disabledBadge')}
                      </button>
                      <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: 'var(--font-size-sm)', color: 'var(--color-error)' }} onClick={() => handleDeleteSchedule(proc.type)}>{t('business.processes.removeSchedule')}</button>
                      {job.last_run_at && (
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{t('business.processes.last', { when: formatDateTime(job.last_run_at, businessTimezone), status: statusText(job.last_run_status) })}</span>
                      )}
                    </div>
                  ) : scheduleForm?.type === proc.type ? (
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <div>
                        <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('business.payroll.frequency')}</label>
                        <select style={{ ...styles.input, marginLeft: '4px' }} value={scheduleForm.frequency} onChange={(e) => setScheduleForm({ ...scheduleForm, frequency: e.target.value })}>
                          <option value="every_15min">{t('business.processes.every15')}</option>
                          <option value="hourly">{t('business.processes.hourly')}</option>
                          <option value="daily">{t('business.processes.daily')}</option>
                          <option value="weekly">{t('business.payroll.weekly')}</option>
                          <option value="monthly">{t('business.payroll.monthly')}</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('business.processes.time')}</label>
                        <input style={{ ...styles.input, marginLeft: '4px', maxWidth: '100px' }} type="time" value={scheduleForm.schedule_time} onChange={(e) => setScheduleForm({ ...scheduleForm, schedule_time: e.target.value })} />
                      </div>
                      {scheduleForm.frequency === 'weekly' && (
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginRight: '4px' }}>{t('business.processes.days')}</label>
                          {DAY_INDEXES.map((i) => {
                            const selected = (scheduleForm.day_of_week || []).includes(i);
                            return (
                              <button key={i} type="button" style={{ padding: '2px 8px', fontSize: 'var(--font-size-xs)', cursor: 'pointer', borderRadius: '4px', border: '1px solid var(--color-border)', background: selected ? 'var(--color-primary)' : 'transparent', color: selected ? '#fff' : 'var(--color-text-secondary)' }}
                                onClick={() => {
                                  const days = scheduleForm.day_of_week || [];
                                  const updated = selected ? days.filter((x: number) => x !== i) : [...days, i].sort();
                                  setScheduleForm({ ...scheduleForm, day_of_week: updated });
                                }}>{t(`business.processes.dayShort.${i}`)}</button>
                            );
                          })}
                        </div>
                      )}
                      {scheduleForm.frequency === 'monthly' && (
                        <div>
                          <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('business.processes.dayOfMonth')}</label>
                          <select style={{ ...styles.input, marginLeft: '4px' }} value={scheduleForm.day_of_month} onChange={(e) => setScheduleForm({ ...scheduleForm, day_of_month: parseInt(e.target.value) })}>
                            {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                            <option value={-1}>{t('business.processes.lastDay')}</option>
                          </select>
                        </div>
                      )}
                      <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 12px', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-primary)' }} onClick={saveSchedule}>{t('common:save')}</button>
                      <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }} onClick={() => setScheduleForm(null)}>{t('common:cancel')}</button>
                    </div>
                  ) : (
                    <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 12px', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }} onClick={() => handleScheduleToggle(proc.type)}>
                      {t('business.processes.addSchedule')}
                    </button>
                  )}

                  {/* Failed-renewal retry parameters (C6.4) — only for Membership Renewals. */}
                  {proc.type === 'billing_process' && retryParams && (
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed var(--color-border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {/* Failed renewal retries — inputs inline to the right of the explanation. */}
                      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: '240px' }}>
                          <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)' }}>{t('business.processes.retriesTitle')}</span>
                          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                            <Trans i18nKey="business.processes.retriesHelp" ns="settings" components={{ em: <em /> }} />
                          </span>
                        </div>
                        <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('business.processes.retries')}
                          <input style={{ ...styles.input, marginLeft: '4px', maxWidth: '70px' }} type="number" min={1} max={10}
                            value={retryParams.count}
                            onChange={(e) => setRetryParams({ ...retryParams, count: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)) })} />
                        </label>
                        <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('business.processes.daysBetween')}
                          <input style={{ ...styles.input, marginLeft: '4px', maxWidth: '70px' }} type="number" min={1} max={90}
                            value={retryParams.intervalDays}
                            onChange={(e) => setRetryParams({ ...retryParams, intervalDays: Math.max(1, Math.min(90, parseInt(e.target.value, 10) || 1)) })} />
                        </label>
                      </div>

                      {/* Renewal reminder — same inline layout. */}
                      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: '240px' }}>
                          <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)' }}>{t('business.processes.reminderTitle')}</span>
                          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                            {t('business.processes.reminderHelp')}
                          </span>
                        </div>
                        <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('business.processes.remindDays')}
                          <input style={{ ...styles.input, marginLeft: '4px', maxWidth: '70px' }} type="number" min={0} max={90}
                            value={retryParams.reminderDaysBefore ?? 0}
                            onChange={(e) => setRetryParams({ ...retryParams, reminderDaysBefore: Math.max(0, Math.min(90, parseInt(e.target.value, 10) || 0)) })} />
                        </label>
                      </div>

                      {/* Single Save applies to both sets of parameters above. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '4px', borderTop: '1px dashed var(--color-border)' }}>
                        <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 16px', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-primary)' }} onClick={saveRetryParams} disabled={savingRetry}>
                          {savingRetry ? t('business.processes.saving') : t('business.processes.saveRenewal')}
                        </button>
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                          {t('business.processes.savesBoth')}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Notification Settings (placeholder for now)
// ============================================================

function NotificationSettings() {
  const { t } = useTranslation('settings');
  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>{t('business.notifications.title')}</h2>
      <p style={styles.description}>
        {t('business.notifications.intro')}
      </p>
      <p style={styles.muted}>{t('business.notifications.platform')}</p>
    </div>
  );
}

// ============================================================
// Payment Methods Settings
// ============================================================


// ============================================================
// Payment Methods Settings
// ============================================================

// The words of each method: business.methods.<method>.label / .description.
const METHOD_INFO: { method: string; integrationOnly?: boolean }[] = [
  { method: 'cash' },
  { method: 'card' },
  { method: 'bank_draw', integrationOnly: true },
  { method: 'bank_transfer' },
  { method: 'check' },
  { method: 'gift_card' },
  { method: 'google_pay', integrationOnly: true },
  { method: 'apple_pay', integrationOnly: true },
  { method: 'other' },
];


function PaymentMethodsSettings() {
  const { t } = useTranslation('settings');
  const businessId = localStorage.getItem('business_id') || '';
  const [loading, setLoading] = useState(true);
  const methodsDraft = useDraft<{ method: string; enabled: boolean }[]>('payment-methods', t('business.methods.draftName'), [], async (methods) => {
    await payApi.setAcceptedMethods(businessId, methods);
  });
  // Gift cards (C7): whether selling a gift card is taxed (default off), and how many days a
  // purchased card is valid for (0 = no expiry; held as a string for the input).
  const giftDraft = useDraft('gift-cards', t('business.methods.giftDraftName'), { tax: false, expiryDays: '0' }, async (g) => {
    await payApi.setGiftCardTaxEnabled(businessId, g.tax);
    const saved = await payApi.setGiftCardExpiryDays(businessId, Math.max(0, Math.floor(Number(g.expiryDays) || 0)));
    return { tax: g.tax, expiryDays: String(saved) };
  });
  const methods = methodsDraft.value;
  const gift = giftDraft.value;

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    Promise.all([
      payApi.getAcceptedMethods(businessId).then((rows) => rows || [])
        // Default all manual methods to enabled if API fails
        .catch(() => METHOD_INFO.map((m) => ({ method: m.method, enabled: !m.integrationOnly }))),
      payApi.getGiftCardTaxEnabled(businessId).catch(() => false),
      payApi.getGiftCardExpiryDays(businessId).then((d) => String(d)).catch(() => '0'),
    ]).then(([rows, tax, expiryDays]) => {
      methodsDraft.load(rows);
      giftDraft.load({ tax, expiryDays });
    }).finally(() => setLoading(false));
  }, [businessId, methodsDraft.load, giftDraft.load]);

  const toggleMethod = (method: string) => {
    const known = methods.some((m) => m.method === method);
    const info = METHOD_INFO.find((m) => m.method === method);
    methodsDraft.setValue(known
      ? methods.map((m) => m.method === method ? { ...m, enabled: !m.enabled } : m)
      : [...methods, { method, enabled: !!info?.integrationOnly }]);
  };

  if (loading) return <p style={styles.muted}>{t('common:loading')}</p>;

  return (
    <div style={styles.section}>
      <div style={draftBox(methodsDraft.dirty || giftDraft.dirty)}>
      <h2 style={styles.sectionTitle}>{t('business.methods.title')}<UnsavedTag dirty={methodsDraft.dirty || giftDraft.dirty} /></h2>
      <p style={styles.description}>
        {t('business.methods.intro')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
        {METHOD_INFO.map((info) => {
          const current = methods.find((m) => m.method === info.method);
          const enabled = current?.enabled ?? !info.integrationOnly;
          const savedRow = methodsDraft.saved.find((m) => m.method === info.method);
          const switchChanged = enabled !== (savedRow?.enabled ?? !info.integrationOnly);
          return (
            <div key={info.method} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', border: '1px solid var(--color-border)', borderRadius: '8px', background: enabled ? 'var(--color-surface)' : 'var(--color-background)' }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 'var(--font-size-base)', color: 'var(--color-text)' }}>{t(`business.methods.${info.method}.label`)}</span>
                {info.integrationOnly && <span style={{ marginLeft: '8px', fontSize: 'var(--font-size-xs)', padding: '2px 6px', borderRadius: '4px', background: 'var(--color-warning-bg, #fff3cd)', color: 'var(--color-warning-text, #856404)' }}>{t('business.methods.integration')}</span>}
                <p style={{ margin: '2px 0 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t(`business.methods.${info.method}.description`)}</p>
                {info.method === 'gift_card' && (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={gift.tax} onChange={(e) => giftDraft.setValue({ ...gift, tax: e.target.checked })} style={checkMark(giftDraft.changed((v) => v.tax))} />
                      {t('business.methods.giftTax')}
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', flexWrap: 'wrap' }}>
                      <label htmlFor="gift-expiry-days">{t('business.methods.giftExpireAfter')}</label>
                      <input
                        id="gift-expiry-days"
                        type="number"
                        min={0}
                        value={gift.expiryDays}
                        onChange={(e) => giftDraft.setValue({ ...gift, expiryDays: e.target.value })}
                        style={{ width: '72px', padding: '4px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--border-radius-sm, 4px)', background: 'var(--color-background)', color: 'var(--color-text)', ...fieldMark(giftDraft.changed((v) => v.expiryDays)) }}
                      />
                      <span>{t('business.methods.giftExpireDays')}</span>
                    </div>
                  </>
                )}
              </div>
              <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px', cursor: 'pointer' }}>
                <input type="checkbox" checked={enabled} onChange={() => toggleMethod(info.method)}
                  style={{ opacity: 0, width: 0, height: 0 }} />
                <span style={{
                  position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: enabled ? 'var(--color-primary)' : 'var(--color-border)',
                  borderRadius: '12px', transition: 'background-color 0.2s', ...toggleMark(switchChanged),
                }} />
                <span style={{
                  position: 'absolute', top: '2px', left: enabled ? '22px' : '2px',
                  width: '20px', height: '20px', backgroundColor: '#fff',
                  borderRadius: '50%', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </label>
            </div>
          );
        })}
      </div>
      </div>

      <div style={{ borderTop: '1px solid var(--color-border)', margin: '32px 0 0', paddingTop: '24px' }}>
        <TipsSetting businessId={businessId} />
      </div>

      <div style={{ borderTop: '1px solid var(--color-border)', margin: '32px 0 0', paddingTop: '24px' }}>
        <InvoicingSetting businessId={businessId} />
      </div>

      <div style={{ borderTop: '1px solid var(--color-border)', margin: '32px 0 0', paddingTop: '24px' }}>
        <BillingRunTimeSetting businessId={businessId} />
      </div>
    </div>
  );
}

// --- Tips (spec 51, gap 14) ---
type TipDraft = { enabled: boolean; defaultPercent: string; maxPercent: string; onManual: boolean; split: 'value' | 'even'; base: 'before_tax' | 'after_tax' };
const tipDraftOf = (s: checkoutApi.TipSettings): TipDraft => ({
  enabled: s.enabled, onManual: s.on_manual, split: s.split, base: s.base,
  defaultPercent: String(s.default_percent), maxPercent: String(s.max_percent),
});
function TipsSetting({ businessId }: { businessId: string }) {
  const { t } = useTranslation('settings');
  const [loading, setLoading] = useState(true);
  const draft = useDraft<TipDraft>('tips', t('business.tips.draftName'),
    { enabled: false, defaultPercent: '15', maxPercent: '30', onManual: true, split: 'value', base: 'before_tax' }, async (d) => {
      const def = Number(d.defaultPercent); const max = Number(d.maxPercent);
      if (!Number.isInteger(max) || max < 1 || max > 100) throw new Error(t('business.tips.maxInvalid'));
      if (!Number.isInteger(def) || def < 0 || def > max) throw new Error(t('business.tips.defaultInvalid'));
      return tipDraftOf(await checkoutApi.saveTipSettings(businessId, { enabled: d.enabled, default_percent: def, max_percent: max, on_manual: d.onManual, split: d.split, base: d.base }));
    });
  const tip = draft.value;
  useEffect(() => {
    if (!businessId) return;
    checkoutApi.getTipSettings(businessId).then((s) => draft.load(tipDraftOf(s))).catch(() => {}).finally(() => setLoading(false));
  }, [businessId, draft.load]);
  if (loading) return null;
  const pctInput = (k: 'defaultPercent' | 'maxPercent', label: string, min: number) => (
    <input type="number" min={min} max={100} step={1} value={tip[k]} aria-label={label}
      onChange={(e) => draft.setValue({ ...tip, [k]: e.target.value })}
      style={{ width: '64px', padding: '4px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-background)', color: 'var(--color-text)', ...fieldMark(draft.changed((v) => v[k])) }} />
  );
  return (
    <div style={draftBox(draft.dirty)}>
      <h2 style={styles.sectionTitle}>{t('business.tips.title')}<UnsavedTag dirty={draft.dirty} /></h2>
      <p style={styles.description}>
        {t('business.tips.intro')}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <input type="checkbox" checked={tip.enabled} onChange={(e) => draft.setValue({ ...tip, enabled: e.target.checked })} style={checkMark(draft.changed((v) => v.enabled))} />
          {t('business.tips.offer')}
        </label>
        {tip.enabled && <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span>{t('business.tips.startsAt')}</span>{pctInput('defaultPercent', t('business.tips.defaultLabel'), 0)}<span>{t('business.tips.upTo')}</span>
            {pctInput('maxPercent', t('business.tips.maxLabel'), 1)}<span>{t('business.tips.ofTotal')}</span>
            <select aria-label={t('business.tips.percentagesOf')} value={tip.base} onChange={(e) => draft.setValue({ ...tip, base: e.target.value as TipDraft['base'] })}
              style={{ padding: '4px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-background)', color: 'var(--color-text)', ...fieldMark(draft.changed((v) => v.base)) }}>
              <option value="before_tax">{t('business.tips.beforeTax')}</option>
              <option value="after_tax">{t('business.tips.includingTax')}</option>
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input type="checkbox" checked={tip.onManual} onChange={(e) => draft.setValue({ ...tip, onManual: e.target.checked })} style={checkMark(draft.changed((v) => v.onManual))} />
            {t('business.tips.onManual')}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <label htmlFor="tips-split">{t('business.tips.shareLabel')}</label>
            <select id="tips-split" value={tip.split} onChange={(e) => draft.setValue({ ...tip, split: e.target.value as TipDraft['split'] })}
              style={{ padding: '4px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-background)', color: 'var(--color-text)', ...fieldMark(draft.changed((v) => v.split)) }}>
              <option value="value">{t('business.tips.byValue')}</option>
              <option value="even">{t('business.tips.evenly')}</option>
            </select>
          </div>
          <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>{t('business.tips.staffCanChange')}</p>
        </>}
      </div>
    </div>
  );
}

// --- Invoicing on/off (C5.1) ---
function InvoicingSetting({ businessId }: { businessId: string }) {
  const { t } = useTranslation('settings');
  const [loading, setLoading] = useState(true);
  const draft = useDraft<boolean>('invoicing', t('business.invoicing.draftName'), false, async (on) => {
    await payApi.setInvoicingEnabled(businessId, on);
  });
  const enabled = draft.value;

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    payApi.getInvoicingEnabled(businessId).then(draft.load).catch(() => {}).finally(() => setLoading(false));
  }, [businessId, draft.load]);

  if (loading) return null;
  return (
    <div style={draftBox(draft.dirty)}>
      <h2 style={styles.sectionTitle}>{t('business.invoicing.title')}<UnsavedTag dirty={draft.dirty} /></h2>
      <p style={styles.description}>
        {t('business.invoicing.intro')}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-surface)', maxWidth: '480px' }}>
        <span style={{ fontWeight: 600, fontSize: 'var(--font-size-base)', color: 'var(--color-text)' }}>{t('business.invoicing.enable')}</span>
        <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px', cursor: 'pointer' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => draft.setValue(e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
          <span style={{ position: 'absolute', inset: 0, backgroundColor: enabled ? 'var(--color-primary)' : 'var(--color-border)', borderRadius: '12px', transition: 'background-color 0.2s', ...toggleMark(draft.dirty) }} />
          <span style={{ position: 'absolute', top: '2px', left: enabled ? '22px' : '2px', width: '20px', height: '20px', backgroundColor: '#fff', borderRadius: '50%', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
        </label>
      </div>
    </div>
  );
}

// --- Recurring-billing run time (C6a) ---
function BillingRunTimeSetting({ businessId }: { businessId: string }) {
  const { t } = useTranslation('settings');
  const [schedule, setSchedule] = useState<payApi.BusinessBillingSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const draft = useDraft('billing-run', t('business.billingRun.draftName'), { time: '02:00', tz: 'UTC', enabled: true }, async (d) => {
    const s = await payApi.saveBusinessBillingSchedule(businessId, d.time, d.tz, d.enabled);
    setSchedule(s);
  });
  const { time, tz, enabled } = draft.value;

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    payApi.getBusinessBillingSchedule(businessId)
      .then((s) => {
        setSchedule(s);
        if (s) draft.load({ time: s.scheduleTime, tz: s.scheduleTimezone, enabled: s.enabled });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [businessId, draft.load]);

  // Running the billing now is an action, not a setting: it has its own button.
  const runNow = async () => {
    setRunning(true); setMessage(null);
    try { await payApi.runBusinessBillingNow(businessId); setMessage({ ok: true, text: t('business.billingRun.started') }); }
    catch { setMessage({ ok: false, text: t('business.billingRun.failed') }); }
    finally { setRunning(false); }
  };

  if (loading) return null;
  return (
    <div style={draftBox(draft.dirty)}>
      <h2 style={styles.sectionTitle}>{t('business.billingRun.title')}<UnsavedTag dirty={draft.dirty} /></h2>
      <p style={styles.description}>
        {t('business.billingRun.intro')}
      </p>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('business.billingRun.runTime')}</label>
          <input type="time" value={time} onChange={(e) => draft.setValue({ ...draft.value, time: e.target.value })} style={{ ...settingInputStyle, ...fieldMark(draft.changed((v) => v.time)) }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '220px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('business.billingRun.timezone')}</label>
          <select value={tz} onChange={(e) => draft.setValue({ ...draft.value, tz: e.target.value })} style={{ ...settingInputStyle, ...fieldMark(draft.changed((v) => v.tz)) }}>
            {TIMEZONES.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
          </select>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => draft.setValue({ ...draft.value, enabled: e.target.checked })} style={checkMark(draft.changed((v) => v.enabled))} /> {t('business.enabled')}
        </label>
      </div>
      {schedule?.nextRunAt && (
        <p style={styles.muted}>{schedule.lastRunStatus
          ? t('business.billingRun.nextRunLast', { when: formatDateTime(schedule.nextRunAt), status: t(`business.processes.status.${schedule.lastRunStatus}`, { defaultValue: schedule.lastRunStatus }) })
          : t('business.billingRun.nextRun', { when: formatDateTime(schedule.nextRunAt) })}</p>
      )}
      {message && <p style={{ fontSize: 'var(--font-size-sm)', color: message.ok ? 'var(--color-success)' : 'var(--color-error)', marginBottom: '12px' }}>{message.text}</p>}
      <div style={{ display: 'flex', gap: '8px' }}>
        <Button variant="secondary" onClick={runNow} loading={running}>{t('business.billingRun.runNow')}</Button>
      </div>
    </div>
  );
}

const settingInputStyle: React.CSSProperties = {
  padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: '8px',
  background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-base)',
};


// ============================================================
// Integrations Settings (placeholder)
// ============================================================

// ============================================================
// Booking Widget (spec 38 R14 / R19)
// ============================================================

function BookingWidgetSettings() {
  const { t } = useTranslation('settings');
  const { activeContext } = useContextManager();
  const businessId = activeContext.businessId;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const draft = useDraft('booking-widget', t('business.widget.title'), { enabled: false, requirePayment: true, origins: '' }, async (d) => {
    const res = await apiClient.put(`/v1/admin/businesses/${businessId}/widget-config`, {
      is_enabled: d.enabled,
      require_payment_before_confirmation: d.requirePayment,
      allowed_origins: d.origins.split(/[\n,]+/).map((o) => o.trim()).filter(Boolean),
    });
    return { ...d, origins: (res.data.data.allowed_origins || []).join('\n') };
  });
  const { enabled, requirePayment, origins } = draft.value;
  const set = (patch: Partial<typeof draft.value>) => draft.setValue({ ...draft.value, ...patch });

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    apiClient.get(`/v1/admin/businesses/${businessId}/widget-config`)
      .then((res) => {
        const data = res.data.data;
        draft.load({
          enabled: !!data.is_enabled,
          requirePayment: !!data.require_payment_before_confirmation,
          origins: (data.allowed_origins || []).join('\n'),
        });
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [businessId, draft.load]);

  if (!businessId) return <div style={styles.section}><p style={styles.muted}>{t('business.widget.selectBusiness')}</p></div>;
  if (loading) return <div style={styles.section}><p style={styles.muted}>{t('common:loading')}</p></div>;

  // The script is served by the API (in development through the dev proxy); the booking page it
  // opens is served by this app.
  const apiOrigin = import.meta.env.VITE_API_URL || window.location.origin;
  const snippet = `<script src="${apiOrigin}/widget/daystream-widget.js" data-business-id="${businessId}" data-app-url="${window.location.origin}"></script>`;

  return (
    <div style={styles.section}>
      <div style={draftBox(draft.dirty)}>
      <h2 style={styles.sectionTitle}>{t('business.widget.title')}<UnsavedTag dirty={draft.dirty} /></h2>
      <p style={styles.description}>
        {t('business.widget.intro')}
      </p>
      {loadError && <p role="alert" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-error, #b42318)' }}>{t('business.widget.loadFailed')}</p>}

      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', margin: 'var(--space-md) 0', color: 'var(--color-text)' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => set({ enabled: e.target.checked })} style={checkMark(draft.changed((v) => v.enabled))} />
        {t('business.widget.isOn')}
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', margin: 'var(--space-md) 0', color: 'var(--color-text)' }}>
        <input type="checkbox" checked={requirePayment} onChange={(e) => set({ requirePayment: e.target.checked })} style={checkMark(draft.changed((v) => v.requirePayment))} />
        {t('business.widget.requirePayment')}
      </label>

      <div style={{ margin: 'var(--space-md) 0' }}>
        <label htmlFor="widget-origins" style={{ display: 'block', marginBottom: '4px', color: 'var(--color-text)', fontSize: 'var(--font-size-sm)' }}>
          {t('business.widget.allowedSites')}
        </label>
        <textarea
          id="widget-origins" rows={3} value={origins} onChange={(e) => set({ origins: e.target.value })}
          placeholder={'https://www.example.com'}
          style={{ width: '100%', maxWidth: '520px', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', ...fieldMark(draft.changed((v) => v.origins)) }}
        />
        <p style={styles.muted}>{t('business.widget.oneAddress')}</p>
      </div>
      </div>

      <div style={{ marginTop: 'var(--space-lg)' }}>
        <h3 style={styles.sectionTitle}>{t('business.widget.addTitle')}</h3>
        <p style={styles.description}>{t('business.widget.addHelp')}</p>
        <pre style={{ padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 'var(--font-size-xs)', overflowX: 'auto', maxWidth: '100%' }}>{snippet}</pre>
      </div>
    </div>
  );
}

function IntegrationsSettings() {
  const { t } = useTranslation('settings');
  const { activeContext } = useContextManager();
  const businessId = activeContext.businessId;

  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>{t('business.integrations.title')}</h2>
      <p style={styles.description}>
        {t('business.integrations.intro')}
      </p>

      <div style={{ marginTop: 'var(--spacing-lg)' }}>
        <h3 style={styles.sectionTitle}>{t('business.integrations.processorTitle')}</h3>
        <p style={styles.description}>
          {t('business.integrations.processorHelp')}
        </p>
        {businessId ? (
          <ProcessorConfigForm owner={{ owner_level: 'business', business_id: businessId }} sharedSave={{ id: 'processor', label: t('business.integrations.processorDraft') }} />
        ) : (
          <p style={styles.muted}>{t('business.integrations.selectBusiness')}</p>
        )}
      </div>

      <p style={{ ...styles.muted, marginTop: 'var(--spacing-lg)' }}>
        {t('business.integrations.more')}
      </p>
    </div>
  );
}

// ============================================================
// Appearance Settings — Theme Setup module (spec 37)
// ============================================================

function AppearanceSettings() {
  return <ThemeGallery persona="business" />;
}


// ============================================================
// Styles
// ============================================================

const styles: Record<string, React.CSSProperties> = {
  page: { padding: '0 var(--space-lg) var(--space-lg)', maxWidth: '1600px', margin: '0 auto' },
  tab: { background: 'none', border: 'none', borderBottom: '2px solid transparent', padding: '10px 16px', fontSize: 'var(--font-size-base)', fontWeight: 500, color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  tabActive: { color: 'var(--color-primary)', borderBottomColor: 'var(--color-primary)' },
  section: { marginBottom: '32px' },
  sectionTitle: { fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 8px 0' },
  description: { fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)', marginBottom: '20px' },
  fieldRow: { display: 'flex', gap: '24px', marginBottom: '16px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px', marginBottom: '16px', flex: 1 },
  label: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', fontWeight: 500 },
  input: { backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '8px 12px', color: 'var(--color-text)', fontSize: 'var(--font-size-base)', fontFamily: 'var(--font-family)', maxWidth: '200px' },
  helper: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' },
  checkLabel: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-base)', color: 'var(--color-text)', cursor: 'pointer' },
  actions: { marginTop: '16px' },
  message: { fontSize: 'var(--font-size-sm)', color: 'var(--color-success)', marginTop: '8px' },
  muted: { fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)' },
};
