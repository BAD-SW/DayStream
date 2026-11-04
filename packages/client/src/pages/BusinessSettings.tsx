import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import * as bookingsApi from '../api/bookings';
import { TIMEZONES } from '../utils/timezones';

type SettingsTab = 'system' | 'lifecycle' | 'leads' | 'processes' | 'notifications' | 'payment-methods' | 'integrations' | 'booking-widget' | 'appearance';

const TABS: { key: SettingsTab; label: string; separatorBefore?: boolean }[] = [
  { key: 'system', label: 'System' },
  { key: 'lifecycle', label: 'Customer Lifecycle' },
  { key: 'leads', label: 'Leads' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'payment-methods', label: 'Payment Methods' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'booking-widget', label: 'Booking Widget' },
  // Processes and Appearance act straight away with their own buttons (David, 2026-10-28):
  // they sit apart, after a separator, and are not part of Save changes.
  { key: 'processes', label: 'Processes', separatorBefore: true },
  { key: 'appearance', label: 'Appearance' },
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
      ? { ok: false, text: `Not saved: ${failed.map((f) => `${f.label} (${f.error})`).join('; ')}` }
      : { ok: true, text: 'All changes saved.' });
  };

  // A failed save says what was not saved, even while those changes are still unsaved.
  const status = dirty && !(result && !result.ok)
    ? <span style={{ color: 'var(--color-warning-dark)' }}>You have unsaved changes.</span>
    : result ? <span role={result.ok ? 'status' : 'alert'} style={{ color: result.ok ? 'var(--color-success)' : 'var(--color-error)' }}>{result.text}</span> : null;

  return (
    <div style={styles.page}>
      <LeaveGuard when={dirty} />
      <StickyPageTop>
        <PageHeader
          title="Settings"
          actions={<>{status && <span style={{ fontSize: 'var(--font-size-sm)' }}>{status}</span>}<Button onClick={save} loading={saving} disabled={!dirty}>Save changes</Button></>}
        />
        <TabBar aria-label="Settings sections" tabs={TABS.map((t) => ({ ...t, changed: changedTabs.has(t.key) }))} active={activeTab} onChange={setActiveTab} />
      </StickyPageTop>
      {TABS.map((t) => (
        <div key={t.key} hidden={activeTab !== t.key}>
          <DraftTab tab={t.key}>{renderTab(t.key)}</DraftTab>
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
    case 'processes': return <ProcessesSettings />;
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
  const businessId = localStorage.getItem('business_id') || '';
  const { refresh: refreshBusinessSettings } = useBusinessSettings();
  const [loading, setLoading] = useState(true);
  const scheduling = useDraft<string>('scheduling', 'System › Scheduling', 'availability', async (mode) => {
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

  if (loading) return <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)' }}>Loading...</p>;

  return (
    <>
    <div style={settingStyles.section}>
      <h3 style={settingStyles.sectionTitle}>Scheduling<UnsavedTag dirty={scheduling.dirty} /></h3>
      <div style={{ ...settingStyles.settingRow, ...draftBox(scheduling.dirty) }}>
        <div style={settingStyles.settingInfo}>
          <label style={settingStyles.settingLabel}>Use Staff Schedule</label>
          <p style={settingStyles.settingDesc}>
            When enabled, the appointment booking engine uses the Staff Schedule (shifts assigned on the Schedule page) to determine when staff are available.
            When disabled, it uses Staff Availability Patterns (defined on each staff member's profile).
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
            {scheduling.value === 'schedule' ? 'Enabled' : 'Disabled'}
          </span>
        </label>
      </div>
    </div>
    <CustomerCancellationSettings />
    <PayrollFrequencySettings />
    <CommissionRefundSetting />
    </>
  );
}

// Customer cancellations (THE-20): may customers cancel, up to how long before the start,
// and where the money of a paid cancellation goes. Set separately for events and appointments.
function CustomerCancellationSettings() {
  const businessId = localStorage.getItem('business_id') || '';
  const [settings, setSettings] = useState<{ events: bookingsApi.CancelSettings; appointments: bookingsApi.CancelSettings } | null>(null);

  useEffect(() => {
    if (!businessId) return;
    bookingsApi.getCancellationSettings(businessId).then((s) => setSettings({ events: s.events, appointments: s.appointments })).catch(() => {});
  }, [businessId]);

  if (!settings) return null;
  return (
    <div style={settingStyles.section}>
      <h3 style={settingStyles.sectionTitle}>Customer cancellations</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <CancellationBlock kind="appointments" label="Appointments" initial={settings.appointments} businessId={businessId} />
        <CancellationBlock kind="events" label="Events" initial={settings.events} businessId={businessId} />
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
  const draft = useDraft<CancelDraft>(`cancel-${kind}`, `System › Customer cancellations › ${label}`, toCancelDraft(initial), async (d) => {
    await bookingsApi.saveCancellationSettings(businessId, kind, {
      customer_cancel_enabled: d.enabled,
      customer_cancel_hours: Math.round(Number(d.amount) || 0) * (d.unit === 'days' ? 24 : 1),
      cancel_refund_to: d.refundTo,
      ...(kind === 'events' ? { change_refund_days: Math.max(0, Math.round(Number(d.changeDays) || 0)) } : {}),
    });
  });
  const { enabled, amount, unit, refundTo, changeDays } = draft.value;
  const set = (patch: Partial<CancelDraft>) => draft.setValue({ ...draft.value, ...patch });
  const noun = kind === 'events' ? 'event' : 'appointment';

  const field = { padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: 'var(--font-size-sm)', background: 'var(--color-surface)', color: 'var(--color-text)' };
  return (
    <div style={{ ...settingStyles.settingRow, flexDirection: 'column' as const, gap: '12px', ...draftBox(draft.dirty) }} data-testid={`cancel-settings-${kind}`}>
      <div style={settingStyles.settingInfo}>
        <label style={settingStyles.settingLabel}>{label}<UnsavedTag dirty={draft.dirty} /></label>
        <p style={settingStyles.settingDesc}>Whether customers can cancel {kind === 'events' ? 'their own event registrations' : 'their own appointments'} online, and until when. Staff can always cancel.</p>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => set({ enabled: e.target.checked })} style={{ width: '18px', height: '18px', ...checkMark(draft.changed((v) => v.enabled)) }} />
        Customers can cancel
      </label>
      {enabled && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const, fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
            Up to
            <input type="number" min={0} max={unit === 'days' ? 90 : 2160} value={amount} onChange={(e) => set({ amount: Number(e.target.value) })} style={{ ...field, width: '80px', ...fieldMark(draft.changed((v) => v.amount)) }} aria-label="How long before" />
            <select value={unit} onChange={(e) => set({ unit: e.target.value as 'hours' | 'days' })} style={{ ...field, ...fieldMark(draft.changed((v) => v.unit)) }} aria-label="Unit">
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
            before the {noun} starts
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '6px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>When a paid {noun} is cancelled in time, the money goes:</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="radio" name={`refund-${kind}`} checked={refundTo === 'card'} onChange={() => set({ refundTo: 'card' })} style={checkMark(draft.changed((v) => v.refundTo) && refundTo === 'card')} /> Back to the customer's card (refund)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="radio" name={`refund-${kind}`} checked={refundTo === 'credit'} onChange={() => set({ refundTo: 'credit' })} style={checkMark(draft.changed((v) => v.refundTo) && refundTo === 'credit')} /> To the customer's account credit, to use later
            </label>
          </div>
        </>
      )}
      {/* After a date, time or place change, registered people can cancel for a full refund (decision 14). */}
      {kind === 'events' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const, fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
          When an event's date, time or place changes, the people registered can cancel for a full refund for
          <input type="number" min={0} max={90} value={changeDays} onChange={(e) => set({ changeDays: Number(e.target.value) })} style={{ ...field, width: '70px', ...fieldMark(draft.changed((v) => v.changeDays)) }} aria-label="Days to cancel after a change" />
          days (or until it starts, if sooner), even when they could not cancel otherwise.
        </div>
      )}
    </div>
  );
}

function PayrollFrequencySettings() {
  const businessId = localStorage.getItem('business_id') || '';
  const [loading, setLoading] = useState(true);
  const draft = useDraft('payroll', 'System › Payroll', { payFrequency: 'monthly', startDate: '' }, async (d) => {
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
      <h3 style={settingStyles.sectionTitle}>Payroll<UnsavedTag dirty={draft.dirty} /></h3>
      <div style={{ ...settingStyles.settingRow, flexDirection: 'column' as const, gap: '12px', ...draftBox(draft.dirty) }}>
        <div style={settingStyles.settingInfo}>
          <label style={settingStyles.settingLabel}>Pay Frequency</label>
          <p style={settingStyles.settingDesc}>How often employees are paid. Pay periods are automatically generated based on this setting.</p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' as const }}>
          <div>
            <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>Frequency</label>
            <select value={draft.value.payFrequency} onChange={(e) => draft.setValue({ ...draft.value, payFrequency: e.target.value })} style={{ padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: 'var(--font-size-sm)', ...fieldMark(draft.changed((v) => v.payFrequency)) }}>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Bi-weekly (every 2 weeks)</option>
              <option value="semi_monthly">Semi-monthly (1st & 16th)</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>Period Start Reference Date</label>
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
  const businessId = localStorage.getItem('business_id') || '';
  const [loaded, setLoaded] = useState(false);
  const draft = useDraft<boolean>('commission-refunds', 'System › Commission after a refund', true, async (takeBack) => {
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
          <label style={settingStyles.settingLabel}>Commission after a refund<UnsavedTag dirty={draft.dirty} /></label>
          <p style={settingStyles.settingDesc}>
            When a sale is refunded, what happens to the commission the staff member earned on it. Taken back commission
            comes off the pay period in which the refund happens; pay periods already finalized never change.
          </p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
          <input type="radio" name="commission-refunds" checked={draft.value} onChange={() => draft.setValue(true)} style={checkMark(draft.dirty && draft.value)} />
          Take the commission back
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
          <input type="radio" name="commission-refunds" checked={!draft.value} onChange={() => draft.setValue(false)} style={checkMark(draft.dirty && !draft.value)} />
          Keep the commission
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
  const businessId = localStorage.getItem('business_id') || '';
  const [loading, setLoading] = useState(true);
  const draft = useDraft('lifecycle', 'Customer Lifecycle', {
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

  if (loading) return <p style={styles.muted}>Loading...</p>;

  return (
    <div style={{ ...styles.section, ...draftBox(draft.dirty) }}>
      <h2 style={styles.sectionTitle}>Customer Lifecycle Automation<UnsavedTag dirty={draft.dirty} /></h2>
      <p style={styles.description}>
        Configure how customers automatically transition between lifecycle stages based on inactivity.
        When enabled, the system will evaluate customer activity daily and move them through stages.
      </p>

      <div style={styles.field}>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={config.enabled} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} style={checkMark(draft.changed((v) => v.enabled))} />
          <span>Enable automatic lifecycle transitions</span>
        </label>
      </div>

      {config.enabled && (
        <>
          <div style={styles.fieldRow}>
            <div style={styles.field}>
              <label style={styles.label}>Days before "Active" → "At Risk"</label>
              <input style={{ ...styles.input, ...fieldMark(draft.changed((v) => v.at_risk_days)) }} type="number" min={1} value={config.at_risk_days}
                onChange={(e) => setConfig({ ...config, at_risk_days: parseInt(e.target.value) || 30 })} />
              <span style={styles.helper}>Customer has no bookings or activity for this many days</span>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Days before "At Risk" → "Churned"</label>
              <input style={{ ...styles.input, ...fieldMark(draft.changed((v) => v.churned_days)) }} type="number" min={1} value={config.churned_days}
                onChange={(e) => setConfig({ ...config, churned_days: parseInt(e.target.value) || 60 })} />
              <span style={styles.helper}>Customer remains at-risk with no activity for this many additional days</span>
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Daily evaluation time</label>
            <input style={{ ...styles.input, ...fieldMark(draft.changed((v) => v.run_time)) }} type="time" value={config.run_time}
              onChange={(e) => setConfig({ ...config, run_time: e.target.value })} />
            <span style={styles.helper}>Time of day when the lifecycle evaluation runs (server timezone)</span>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// Processes Settings
// ============================================================

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function ProcessesSettings() {
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
    } catch { alert('Failed to save schedule'); }
  };

  const handleDeleteSchedule = async (type: string) => {
    const job = getJobForType(type);
    if (!job) return;
    if (!confirm('Remove the schedule for this process?')) return;
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

  if (loading) return <p style={styles.muted}>Loading...</p>;

  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>Processes</h2>
      <p style={styles.description}>
        Automated business processes. Run any process manually or configure a recurring schedule. Timezone: <strong>{businessTimezone}</strong>
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
                      {job.enabled ? `● ${job.frequency} at ${job.schedule_time}` : '○ Disabled'}
                    </span>
                  )}
                  <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }} onClick={() => handleRunNow(proc.type)}>Run</button>
                  <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }} onClick={() => { setExpandedProcess(expandedProcess === proc.type ? null : proc.type); if (!job && expandedProcess !== proc.type) handleScheduleToggle(proc.type); }}>Schedule</button>
                  <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }} onClick={() => handleViewHistory(proc.type)}>History</button>
                </div>
              </div>

              {runPanel === proc.type && (
                <div style={{ padding: '8px 16px 12px', borderTop: '1px solid var(--color-border)', background: 'var(--color-background)' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>From
                      <input style={{ ...styles.input, marginLeft: '4px', maxWidth: '150px' }} type="date" value={runForm.dateFrom} onChange={(e) => setRunForm({ ...runForm, dateFrom: e.target.value })} />
                    </label>
                    <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>To
                      <input style={{ ...styles.input, marginLeft: '4px', maxWidth: '150px' }} type="date" value={runForm.dateTo} onChange={(e) => setRunForm({ ...runForm, dateTo: e.target.value })} />
                    </label>
                    {/* Posting Date applies only to revenue recognition. Recurring
                        charges (billing_process) raise a real card charge "now" — the
                        payment + its GL entry must carry the actual charge date so they
                        reconcile with Stripe, so no posting-date override is offered. */}
                    {proc.type === 'revenue_recognition' && (
                      <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>Posting Date
                        <input style={{ ...styles.input, marginLeft: '4px', maxWidth: '150px' }} type="date" value={runForm.postingDate} onChange={(e) => setRunForm({ ...runForm, postingDate: e.target.value })} />
                      </label>
                    )}
                    <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 14px', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-primary)' }} onClick={executeRun} disabled={running}>
                      {running ? 'Running...' : 'Execute'}
                    </button>
                  </div>
                  {runResult && (
                    <div style={{ marginTop: '8px', fontSize: 'var(--font-size-sm)', padding: '8px', borderRadius: '4px', background: runResult.status === 'failed' ? 'var(--color-error-bg, #fff0f0)' : 'var(--color-success-bg, #f0fff0)', color: runResult.status === 'failed' ? 'var(--color-error)' : 'var(--color-success)' }}>
                      {runResult.status === 'failed' ? (
                        <span>Failed: {runResult.error}</span>
                      ) : (
                        <span>
                          Success ({runResult.duration_ms}ms)
                          {runResult.result?.journalEntriesCreated !== undefined && (
                            <> — {runResult.result.journalEntriesCreated} entries created, {runResult.result.datesProcessed} dates processed, {runResult.result.skipped} skipped</>
                          )}
                          {runResult.result?.transitioned !== undefined && (
                            <> — {runResult.result.transitioned} customers transitioned</>
                          )}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {selectedHistory?.type === proc.type && selectedHistory && (
                <div style={{ padding: '8px 16px 12px', borderTop: '1px solid var(--color-border)' }}>
                  {selectedHistory.entries.length === 0 ? <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>No execution history</p> : (
                    selectedHistory.entries.slice(0, 10).map((e: any) => (
                      <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-sm)', padding: '4px 0', borderBottom: '1px solid var(--color-border)' }}>
                        <span>{new Date(e.started_at).toLocaleString(undefined, { timeZone: businessTimezone })} ({businessTimezone})</span>
                        <span style={{ color: e.status === 'success' ? 'var(--color-success)' : 'var(--color-error)' }}>{e.status} {e.duration_ms ? `(${e.duration_ms}ms)` : ''}</span>
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
                        Schedule: <strong>{job.frequency}</strong> at <strong>{job.schedule_time}</strong>
                        {job.frequency === 'weekly' && job.day_of_week != null && <> on <strong>{(Array.isArray(job.day_of_week) ? job.day_of_week : [job.day_of_week]).map((d: number) => DAYS_OF_WEEK[d]?.slice(0, 3)).join(', ')}</strong></>}
                        {job.frequency === 'monthly' && job.day_of_month != null && <> on day <strong>{job.day_of_month === -1 ? 'Last day' : job.day_of_month}</strong></>}
                      </span>
                      <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: 'var(--font-size-sm)', color: job.enabled ? 'var(--color-success)' : 'var(--color-text-secondary)' }} onClick={() => handleScheduleToggle(proc.type)}>
                        {job.enabled ? '● Enabled' : '○ Disabled'}
                      </button>
                      <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: 'var(--font-size-sm)', color: 'var(--color-error)' }} onClick={() => handleDeleteSchedule(proc.type)}>Remove Schedule</button>
                      {job.last_run_at && (
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Last: {new Date(job.last_run_at).toLocaleString(undefined, { timeZone: businessTimezone })} ({job.last_run_status})</span>
                      )}
                    </div>
                  ) : scheduleForm?.type === proc.type ? (
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <div>
                        <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>Frequency</label>
                        <select style={{ ...styles.input, marginLeft: '4px' }} value={scheduleForm.frequency} onChange={(e) => setScheduleForm({ ...scheduleForm, frequency: e.target.value })}>
                          <option value="every_15min">Every 15 min</option>
                          <option value="hourly">Hourly</option>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>Time</label>
                        <input style={{ ...styles.input, marginLeft: '4px', maxWidth: '100px' }} type="time" value={scheduleForm.schedule_time} onChange={(e) => setScheduleForm({ ...scheduleForm, schedule_time: e.target.value })} />
                      </div>
                      {scheduleForm.frequency === 'weekly' && (
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginRight: '4px' }}>Days</label>
                          {DAYS_OF_WEEK.map((d, i) => {
                            const selected = (scheduleForm.day_of_week || []).includes(i);
                            return (
                              <button key={i} type="button" style={{ padding: '2px 8px', fontSize: 'var(--font-size-xs)', cursor: 'pointer', borderRadius: '4px', border: '1px solid var(--color-border)', background: selected ? 'var(--color-primary)' : 'transparent', color: selected ? '#fff' : 'var(--color-text-secondary)' }}
                                onClick={() => {
                                  const days = scheduleForm.day_of_week || [];
                                  const updated = selected ? days.filter((x: number) => x !== i) : [...days, i].sort();
                                  setScheduleForm({ ...scheduleForm, day_of_week: updated });
                                }}>{d.slice(0, 3)}</button>
                            );
                          })}
                        </div>
                      )}
                      {scheduleForm.frequency === 'monthly' && (
                        <div>
                          <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>Day of Month</label>
                          <select style={{ ...styles.input, marginLeft: '4px' }} value={scheduleForm.day_of_month} onChange={(e) => setScheduleForm({ ...scheduleForm, day_of_month: parseInt(e.target.value) })}>
                            {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                            <option value={-1}>Last day</option>
                          </select>
                        </div>
                      )}
                      <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 12px', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-primary)' }} onClick={saveSchedule}>Save</button>
                      <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }} onClick={() => setScheduleForm(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 12px', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }} onClick={() => handleScheduleToggle(proc.type)}>
                      Add Schedule
                    </button>
                  )}

                  {/* Failed-renewal retry parameters (C6.4) — only for Membership Renewals. */}
                  {proc.type === 'billing_process' && retryParams && (
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed var(--color-border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {/* Failed renewal retries — inputs inline to the right of the explanation. */}
                      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: '240px' }}>
                          <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)' }}>Failed renewal retries</span>
                          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                            When a renewal fails, the membership goes to <em>Renewing</em> and is retried automatically; it expires if all retries fail.
                          </span>
                        </div>
                        <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>Retries
                          <input style={{ ...styles.input, marginLeft: '4px', maxWidth: '70px' }} type="number" min={1} max={10}
                            value={retryParams.count}
                            onChange={(e) => setRetryParams({ ...retryParams, count: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)) })} />
                        </label>
                        <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>Days between
                          <input style={{ ...styles.input, marginLeft: '4px', maxWidth: '70px' }} type="number" min={1} max={90}
                            value={retryParams.intervalDays}
                            onChange={(e) => setRetryParams({ ...retryParams, intervalDays: Math.max(1, Math.min(90, parseInt(e.target.value, 10) || 1)) })} />
                        </label>
                      </div>

                      {/* Renewal reminder — same inline layout. */}
                      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: '240px' }}>
                          <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)' }}>Renewal reminder</span>
                          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                            Email the customer this many days before a membership renews. Set to 0 to turn the reminder off.
                          </span>
                        </div>
                        <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>Remind (days before)
                          <input style={{ ...styles.input, marginLeft: '4px', maxWidth: '70px' }} type="number" min={0} max={90}
                            value={retryParams.reminderDaysBefore ?? 0}
                            onChange={(e) => setRetryParams({ ...retryParams, reminderDaysBefore: Math.max(0, Math.min(90, parseInt(e.target.value, 10) || 0)) })} />
                        </label>
                      </div>

                      {/* Single Save applies to both sets of parameters above. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '4px', borderTop: '1px dashed var(--color-border)' }}>
                        <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 16px', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-primary)' }} onClick={saveRetryParams} disabled={savingRetry}>
                          {savingRetry ? 'Saving...' : 'Save renewal settings'}
                        </button>
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                          Saves both the retry and reminder settings.
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
  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>Notification Settings</h2>
      <p style={styles.description}>
        Configure how your business sends notifications to customers (booking confirmations, reminders, marketing).
      </p>
      <p style={styles.muted}>Notification configuration is managed at the platform level. Contact your administrator for changes.</p>
    </div>
  );
}

// ============================================================
// Payment Methods Settings
// ============================================================


// ============================================================
// Payment Methods Settings
// ============================================================

const METHOD_INFO: { method: string; label: string; description: string; integrationOnly?: boolean }[] = [
  { method: 'cash', label: 'Cash', description: 'Accept cash payments in person' },
  { method: 'card', label: 'Card', description: 'Accept credit/debit card payments' },
  { method: 'bank_draw', label: 'Direct Debit', description: 'Pull payments via SEPA/ACH direct debit mandate (requires a connected processor)', integrationOnly: true },
  { method: 'bank_transfer', label: 'Bank Transfer', description: 'Record payments received via bank transfer' },
  { method: 'check', label: 'Check', description: 'Accept check payments' },
  { method: 'gift_card', label: 'Gift Card', description: 'Accept gift card codes as payment' },
  { method: 'google_pay', label: 'Google Pay', description: 'Accept Google Pay (requires integration)', integrationOnly: true },
  { method: 'apple_pay', label: 'Apple Pay', description: 'Accept Apple Pay (requires integration)', integrationOnly: true },
  { method: 'other', label: 'Other', description: 'Miscellaneous payment methods' },
];


function PaymentMethodsSettings() {
  const businessId = localStorage.getItem('business_id') || '';
  const [loading, setLoading] = useState(true);
  const methodsDraft = useDraft<{ method: string; enabled: boolean }[]>('payment-methods', 'Payment Methods › Accepted methods', [], async (methods) => {
    await payApi.setAcceptedMethods(businessId, methods);
  });
  // Gift cards (C7): whether selling a gift card is taxed (default off), and how many days a
  // purchased card is valid for (0 = no expiry; held as a string for the input).
  const giftDraft = useDraft('gift-cards', 'Payment Methods › Gift cards', { tax: false, expiryDays: '0' }, async (g) => {
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

  if (loading) return <p style={styles.muted}>Loading...</p>;

  return (
    <div style={styles.section}>
      <div style={draftBox(methodsDraft.dirty || giftDraft.dirty)}>
      <h2 style={styles.sectionTitle}>Accepted Payment Methods<UnsavedTag dirty={methodsDraft.dirty || giftDraft.dirty} /></h2>
      <p style={styles.description}>
        Choose which payment methods your business accepts. Disabled methods will not appear as options when recording payments.
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
                <span style={{ fontWeight: 600, fontSize: 'var(--font-size-base)', color: 'var(--color-text)' }}>{info.label}</span>
                {info.integrationOnly && <span style={{ marginLeft: '8px', fontSize: 'var(--font-size-xs)', padding: '2px 6px', borderRadius: '4px', background: 'var(--color-warning-bg, #fff3cd)', color: 'var(--color-warning-text, #856404)' }}>Integration</span>}
                <p style={{ margin: '2px 0 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{info.description}</p>
                {info.method === 'gift_card' && (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={gift.tax} onChange={(e) => giftDraft.setValue({ ...gift, tax: e.target.checked })} style={checkMark(giftDraft.changed((v) => v.tax))} />
                      Apply tax to gift card sales (at the default tax rate) — depends on your jurisdiction
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', flexWrap: 'wrap' }}>
                      <label htmlFor="gift-expiry-days">Gift cards expire after</label>
                      <input
                        id="gift-expiry-days"
                        type="number"
                        min={0}
                        value={gift.expiryDays}
                        onChange={(e) => giftDraft.setValue({ ...gift, expiryDays: e.target.value })}
                        style={{ width: '72px', padding: '4px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--border-radius-sm, 4px)', background: 'var(--color-background)', color: 'var(--color-text)', ...fieldMark(giftDraft.changed((v) => v.expiryDays)) }}
                      />
                      <span>days from purchase (0 = no expiry) — depends on your jurisdiction</span>
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
        <InvoicingSetting businessId={businessId} />
      </div>

      <div style={{ borderTop: '1px solid var(--color-border)', margin: '32px 0 0', paddingTop: '24px' }}>
        <BillingRunTimeSetting businessId={businessId} />
      </div>
    </div>
  );
}

// --- Invoicing on/off (C5.1) ---
function InvoicingSetting({ businessId }: { businessId: string }) {
  const [loading, setLoading] = useState(true);
  const draft = useDraft<boolean>('invoicing', 'Payment Methods › Invoicing', false, async (on) => {
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
      <h2 style={styles.sectionTitle}>Invoicing<UnsavedTag dirty={draft.dirty} /></h2>
      <p style={styles.description}>
        When enabled, you can issue payable invoices to customers (e.g. corporate clients) that they can settle online.
        When off, you simply take payment at the time of service.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-surface)', maxWidth: '480px' }}>
        <span style={{ fontWeight: 600, fontSize: 'var(--font-size-base)', color: 'var(--color-text)' }}>Enable invoicing</span>
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
  const [schedule, setSchedule] = useState<payApi.BusinessBillingSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const draft = useDraft('billing-run', 'Payment Methods › Recurring billing run', { time: '02:00', tz: 'UTC', enabled: true }, async (d) => {
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
    try { await payApi.runBusinessBillingNow(businessId); setMessage('Billing run started.'); }
    catch { setMessage('Failed to run billing.'); }
    finally { setRunning(false); }
  };

  if (loading) return null;
  return (
    <div style={draftBox(draft.dirty)}>
      <h2 style={styles.sectionTitle}>Recurring Billing Run<UnsavedTag dirty={draft.dirty} /></h2>
      <p style={styles.description}>
        Membership renewals and payment retries run automatically each day at this time, in your chosen timezone.
      </p>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>Run time</label>
          <input type="time" value={time} onChange={(e) => draft.setValue({ ...draft.value, time: e.target.value })} style={{ ...settingInputStyle, ...fieldMark(draft.changed((v) => v.time)) }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '220px' }}>
          <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>Timezone</label>
          <select value={tz} onChange={(e) => draft.setValue({ ...draft.value, tz: e.target.value })} style={{ ...settingInputStyle, ...fieldMark(draft.changed((v) => v.tz)) }}>
            {TIMEZONES.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
          </select>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => draft.setValue({ ...draft.value, enabled: e.target.checked })} style={checkMark(draft.changed((v) => v.enabled))} /> Enabled
        </label>
      </div>
      {schedule?.nextRunAt && (
        <p style={styles.muted}>Next run: {new Date(schedule.nextRunAt).toLocaleString()}{schedule.lastRunStatus ? ` · Last: ${schedule.lastRunStatus}` : ''}</p>
      )}
      {message && <p style={{ fontSize: 'var(--font-size-sm)', color: message.includes('Failed') ? 'var(--color-error)' : 'var(--color-success)', marginBottom: '12px' }}>{message}</p>}
      <div style={{ display: 'flex', gap: '8px' }}>
        <Button variant="secondary" onClick={runNow} loading={running}>Run Now</Button>
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
  const { activeContext } = useContextManager();
  const businessId = activeContext.businessId;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const draft = useDraft('booking-widget', 'Booking Widget', { enabled: false, requirePayment: true, origins: '' }, async (d) => {
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

  if (!businessId) return <div style={styles.section}><p style={styles.muted}>Select a business to configure its booking widget.</p></div>;
  if (loading) return <div style={styles.section}><p style={styles.muted}>Loading…</p></div>;

  // The script is served by the API (in development through the dev proxy); the booking page it
  // opens is served by this app.
  const apiOrigin = import.meta.env.VITE_API_URL || window.location.origin;
  const snippet = `<script src="${apiOrigin}/widget/daystream-widget.js" data-business-id="${businessId}" data-app-url="${window.location.origin}"></script>`;

  return (
    <div style={styles.section}>
      <div style={draftBox(draft.dirty)}>
      <h2 style={styles.sectionTitle}>Booking Widget<UnsavedTag dirty={draft.dirty} /></h2>
      <p style={styles.description}>
        The booking widget lets visitors book from your own website. While it is off, the widget shows nothing and takes no bookings.
      </p>
      {loadError && <p role="alert" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-error, #b42318)' }}>The widget settings could not be loaded.</p>}

      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', margin: 'var(--space-md) 0', color: 'var(--color-text)' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => set({ enabled: e.target.checked })} style={checkMark(draft.changed((v) => v.enabled))} />
        Booking widget is on
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', margin: 'var(--space-md) 0', color: 'var(--color-text)' }}>
        <input type="checkbox" checked={requirePayment} onChange={(e) => set({ requirePayment: e.target.checked })} style={checkMark(draft.changed((v) => v.requirePayment))} />
        A booking is confirmed only after it is paid
      </label>

      <div style={{ margin: 'var(--space-md) 0' }}>
        <label htmlFor="widget-origins" style={{ display: 'block', marginBottom: '4px', color: 'var(--color-text)', fontSize: 'var(--font-size-sm)' }}>
          Websites allowed to show the widget
        </label>
        <textarea
          id="widget-origins" rows={3} value={origins} onChange={(e) => set({ origins: e.target.value })}
          placeholder="https://www.example.com"
          style={{ width: '100%', maxWidth: '520px', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', ...fieldMark(draft.changed((v) => v.origins)) }}
        />
        <p style={styles.muted}>One address per line. Leave empty to allow any website.</p>
      </div>
      </div>

      <div style={{ marginTop: 'var(--space-lg)' }}>
        <h3 style={styles.sectionTitle}>Add it to your website</h3>
        <p style={styles.description}>Paste this line once, near the end of each page. Then copy a button for each service, package or membership from its page in Offerings ("Copy widget snippet").</p>
        <pre style={{ padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 'var(--font-size-xs)', overflowX: 'auto', maxWidth: '100%' }}>{snippet}</pre>
      </div>
    </div>
  );
}

function IntegrationsSettings() {
  const { activeContext } = useContextManager();
  const businessId = activeContext.businessId;

  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>Integrations</h2>
      <p style={styles.description}>
        Connect external services to your business. Payment processors, calendars, accounting systems, and more will be configured here.
      </p>

      <div style={{ marginTop: 'var(--spacing-lg)' }}>
        <h3 style={styles.sectionTitle}>Payment Processor</h3>
        <p style={styles.description}>
          Configure the payment provider your business uses to charge your customers. Credentials
          are stored securely and never shown again after saving. This is the account customer
          payments settle into.
        </p>
        {businessId ? (
          <ProcessorConfigForm owner={{ owner_level: 'business', business_id: businessId }} sharedSave={{ id: 'processor', label: 'Integrations › Payment processor' }} />
        ) : (
          <p style={styles.muted}>Select a business to configure its payment processor.</p>
        )}
      </div>

      <p style={{ ...styles.muted, marginTop: 'var(--spacing-lg)' }}>
        Additional integrations (calendars, accounting, and more) will be available as they are developed.
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
