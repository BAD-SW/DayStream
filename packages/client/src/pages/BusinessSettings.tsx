import { useState, useEffect } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { apiClient } from '../api/client';
import { useBusinessSettings } from '../context/BusinessSettingsContext';

type SettingsTab = 'system' | 'lifecycle' | 'processes' | 'notifications' | 'payment-methods' | 'integrations';

export function BusinessSettings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('system');

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'system', label: 'System' },
    { key: 'lifecycle', label: 'Customer Lifecycle' },
    { key: 'processes', label: 'Processes' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'payment-methods', label: 'Payment Methods' },
    { key: 'integrations', label: 'Integrations' },
  ];

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Settings</h1>
      <div style={styles.tabBar}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              style={{
                background: 'none', border: 'none', outline: 'none',
                borderBottom: isActive ? '3px solid var(--color-primary)' : '3px solid transparent',
                padding: '10px 20px', fontSize: '14px',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                cursor: 'pointer', fontFamily: 'var(--font-family)', marginBottom: '-1px',
              }}>
              {tab.label}
            </button>
          );
        })}
      </div>
      {activeTab === 'system' && <SystemSettings />}
      {activeTab === 'lifecycle' && <LifecycleSettings />}
      {activeTab === 'processes' && <ProcessesSettings />}
      {activeTab === 'notifications' && <NotificationSettings />}
      {activeTab === 'payment-methods' && <PaymentMethodsSettings />}
      {activeTab === 'integrations' && <IntegrationsSettings />}
    </div>
  );
}


// ============================================================
// System Settings
// ============================================================

function SystemSettings() {
  const businessId = localStorage.getItem('business_id') || '';
  const { refresh: refreshBusinessSettings } = useBusinessSettings();
  const [schedulingMode, setSchedulingMode] = useState<string>('availability');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    apiClient.get(`/v1/admin/businesses/${businessId}/settings`)
      .then((res) => {
        const data = res.data.data;
        if (data) setSchedulingMode(data.scheduling_mode || 'availability');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [businessId]);

  const handleToggle = async (checked: boolean) => {
    const newMode = checked ? 'schedule' : 'availability';
    setSchedulingMode(newMode);
    setSaving(true);
    try {
      await apiClient.put(`/v1/admin/businesses/${businessId}/settings`, { scheduling_mode: newMode });
      refreshBusinessSettings(); // Update sidebar and dashboard immediately
    } catch { alert('Failed to save setting'); setSchedulingMode(schedulingMode); }
    finally { setSaving(false); }
  };

  if (loading) return <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>Loading...</p>;

  return (
    <div style={settingStyles.section}>
      <h3 style={settingStyles.sectionTitle}>Scheduling</h3>
      <div style={settingStyles.settingRow}>
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
            checked={schedulingMode === 'schedule'}
            onChange={(e) => handleToggle(e.target.checked)}
            disabled={saving}
            style={{ width: '18px', height: '18px' }}
          />
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', marginLeft: '8px' }}>
            {schedulingMode === 'schedule' ? 'Enabled' : 'Disabled'}
          </span>
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
  const [config, setConfig] = useState({
    enabled: true,
    at_risk_days: 30,
    churned_days: 60,
    run_time: '02:00',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    apiClient.get(`/v1/customers/lifecycle-config?business_id=${businessId}`)
      .then((res) => {
        const d = res.data.data;
        if (d) {
          setConfig({
            enabled: d.enabled ?? true,
            at_risk_days: d.at_risk_days ?? 30,
            churned_days: d.churned_days ?? 60,
            run_time: d.run_time || '02:00',
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [businessId]);

  const handleSave = async () => {
    setSaving(true); setMessage(null);
    try {
      await apiClient.put(`/v1/customers/lifecycle-config?business_id=${businessId}`, config);
      setMessage('Lifecycle settings saved.');
    } catch { setMessage('Failed to save.'); }
    finally { setSaving(false); }
  };

  if (loading) return <p style={styles.muted}>Loading...</p>;

  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>Customer Lifecycle Automation</h2>
      <p style={styles.description}>
        Configure how customers automatically transition between lifecycle stages based on inactivity.
        When enabled, the system will evaluate customer activity daily and move them through stages.
      </p>

      <div style={styles.field}>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={config.enabled} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} />
          <span>Enable automatic lifecycle transitions</span>
        </label>
      </div>

      {config.enabled && (
        <>
          <div style={styles.fieldRow}>
            <div style={styles.field}>
              <label style={styles.label}>Days before "Active" → "At Risk"</label>
              <input style={styles.input} type="number" min={1} value={config.at_risk_days}
                onChange={(e) => setConfig({ ...config, at_risk_days: parseInt(e.target.value) || 30 })} />
              <span style={styles.helper}>Customer has no bookings or activity for this many days</span>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Days before "At Risk" → "Churned"</label>
              <input style={styles.input} type="number" min={1} value={config.churned_days}
                onChange={(e) => setConfig({ ...config, churned_days: parseInt(e.target.value) || 60 })} />
              <span style={styles.helper}>Customer remains at-risk with no activity for this many additional days</span>
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Daily evaluation time</label>
            <input style={styles.input} type="time" value={config.run_time}
              onChange={(e) => setConfig({ ...config, run_time: e.target.value })} />
            <span style={styles.helper}>Time of day when the lifecycle evaluation runs (server timezone)</span>
          </div>
        </>
      )}

      {message && <p style={styles.message}>{message}</p>}
      <div style={styles.actions}>
        <Button onClick={handleSave} loading={saving}>Save Settings</Button>
      </div>
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
      if (runForm.postingDate) body.posting_date = runForm.postingDate;
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
                  <span style={{ marginLeft: '12px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>{proc.description}</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                  {job && (
                    <span style={{ fontSize: '11px', color: job.enabled ? 'var(--color-success)' : 'var(--color-text-muted)', marginRight: '4px' }}>
                      {job.enabled ? `● ${job.frequency} at ${job.schedule_time}` : '○ Disabled'}
                    </span>
                  )}
                  <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: '12px' }} onClick={() => handleRunNow(proc.type)}>Run</button>
                  <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: '12px' }} onClick={() => { setExpandedProcess(expandedProcess === proc.type ? null : proc.type); if (!job && expandedProcess !== proc.type) handleScheduleToggle(proc.type); }}>Schedule</button>
                  <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: '12px' }} onClick={() => handleViewHistory(proc.type)}>History</button>
                </div>
              </div>

              {runPanel === proc.type && (
                <div style={{ padding: '8px 16px 12px', borderTop: '1px solid var(--color-border)', background: 'var(--color-background)' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>From
                      <input style={{ ...styles.input, marginLeft: '4px', maxWidth: '150px' }} type="date" value={runForm.dateFrom} onChange={(e) => setRunForm({ ...runForm, dateFrom: e.target.value })} />
                    </label>
                    <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>To
                      <input style={{ ...styles.input, marginLeft: '4px', maxWidth: '150px' }} type="date" value={runForm.dateTo} onChange={(e) => setRunForm({ ...runForm, dateTo: e.target.value })} />
                    </label>
                    {(proc.type === 'revenue_recognition' || proc.type === 'billing_process') && (
                      <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Posting Date
                        <input style={{ ...styles.input, marginLeft: '4px', maxWidth: '150px' }} type="date" value={runForm.postingDate} onChange={(e) => setRunForm({ ...runForm, postingDate: e.target.value })} />
                      </label>
                    )}
                    <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 14px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: 'var(--color-primary)' }} onClick={executeRun} disabled={running}>
                      {running ? 'Running...' : 'Execute'}
                    </button>
                  </div>
                  {runResult && (
                    <div style={{ marginTop: '8px', fontSize: '12px', padding: '8px', borderRadius: '4px', background: runResult.status === 'failed' ? 'var(--color-error-bg, #fff0f0)' : 'var(--color-success-bg, #f0fff0)', color: runResult.status === 'failed' ? 'var(--color-error)' : 'var(--color-success)' }}>
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
                  {selectedHistory.entries.length === 0 ? <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: 0 }}>No execution history</p> : (
                    selectedHistory.entries.slice(0, 10).map((e: any) => (
                      <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '4px 0', borderBottom: '1px solid var(--color-border)' }}>
                        <span>{new Date(e.started_at).toLocaleString()}</span>
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
                      <span style={{ fontSize: '13px', color: 'var(--color-text)' }}>
                        Schedule: <strong>{job.frequency}</strong> at <strong>{job.schedule_time}</strong>
                        {job.frequency === 'weekly' && job.day_of_week != null && <> on <strong>{(Array.isArray(job.day_of_week) ? job.day_of_week : [job.day_of_week]).map((d: number) => DAYS_OF_WEEK[d]?.slice(0, 3)).join(', ')}</strong></>}
                        {job.frequency === 'monthly' && job.day_of_month != null && <> on day <strong>{job.day_of_month === -1 ? 'Last day' : job.day_of_month}</strong></>}
                      </span>
                      <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', color: job.enabled ? 'var(--color-success)' : 'var(--color-text-secondary)' }} onClick={() => handleScheduleToggle(proc.type)}>
                        {job.enabled ? '● Enabled' : '○ Disabled'}
                      </button>
                      <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', color: 'var(--color-error)' }} onClick={() => handleDeleteSchedule(proc.type)}>Remove Schedule</button>
                      {job.last_run_at && (
                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Last: {new Date(job.last_run_at).toLocaleString()} ({job.last_run_status})</span>
                      )}
                    </div>
                  ) : scheduleForm?.type === proc.type ? (
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <div>
                        <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Frequency</label>
                        <select style={{ ...styles.input, marginLeft: '4px' }} value={scheduleForm.frequency} onChange={(e) => setScheduleForm({ ...scheduleForm, frequency: e.target.value })}>
                          <option value="every_15min">Every 15 min</option>
                          <option value="hourly">Hourly</option>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Time</label>
                        <input style={{ ...styles.input, marginLeft: '4px', maxWidth: '100px' }} type="time" value={scheduleForm.schedule_time} onChange={(e) => setScheduleForm({ ...scheduleForm, schedule_time: e.target.value })} />
                      </div>
                      {scheduleForm.frequency === 'weekly' && (
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginRight: '4px' }}>Days</label>
                          {DAYS_OF_WEEK.map((d, i) => {
                            const selected = (scheduleForm.day_of_week || []).includes(i);
                            return (
                              <button key={i} type="button" style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer', borderRadius: '4px', border: '1px solid var(--color-border)', background: selected ? 'var(--color-primary)' : 'transparent', color: selected ? '#fff' : 'var(--color-text-secondary)' }}
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
                          <label style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Day of Month</label>
                          <select style={{ ...styles.input, marginLeft: '4px' }} value={scheduleForm.day_of_month} onChange={(e) => setScheduleForm({ ...scheduleForm, day_of_month: parseInt(e.target.value) })}>
                            {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                            <option value={-1}>Last day</option>
                          </select>
                        </div>
                      )}
                      <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: 'var(--color-primary)' }} onClick={saveSchedule}>Save</button>
                      <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: '12px' }} onClick={() => setScheduleForm(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 12px', cursor: 'pointer', fontSize: '12px' }} onClick={() => handleScheduleToggle(proc.type)}>
                      Add Schedule
                    </button>
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

const METHOD_INFO: { method: string; label: string; description: string; integrationOnly?: boolean }[] = [
  { method: 'cash', label: 'Cash', description: 'Accept cash payments in person' },
  { method: 'card', label: 'Card', description: 'Accept credit/debit card payments' },
  { method: 'bank_transfer', label: 'Bank Transfer', description: 'Accept payments via bank routing and account number' },
  { method: 'check', label: 'Check', description: 'Accept check payments' },
  { method: 'gift_card', label: 'Gift Card', description: 'Accept gift card codes as payment' },
  { method: 'google_pay', label: 'Google Pay', description: 'Accept Google Pay (requires integration)', integrationOnly: true },
  { method: 'apple_pay', label: 'Apple Pay', description: 'Accept Apple Pay (requires integration)', integrationOnly: true },
  { method: 'other', label: 'Other', description: 'Miscellaneous payment methods' },
];

function PaymentMethodsSettings() {
  const businessId = localStorage.getItem('business_id') || '';
  const [methods, setMethods] = useState<{ method: string; enabled: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    apiClient.get(`/v1/payments/methods?business_id=${businessId}`)
      .then((res) => setMethods(res.data.data || []))
      .catch(() => {
        // Default all manual methods to enabled if API fails
        setMethods(METHOD_INFO.map((m) => ({ method: m.method, enabled: !m.integrationOnly })));
      })
      .finally(() => setLoading(false));
  }, [businessId]);

  const toggleMethod = (method: string) => {
    setMethods(methods.map((m) => m.method === method ? { ...m, enabled: !m.enabled } : m));
    setMessage(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await apiClient.put('/v1/payments/methods', { business_id: businessId, methods });
      setMessage('Payment methods saved.');
    } catch {
      setMessage('Failed to save payment methods.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p style={styles.muted}>Loading...</p>;

  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>Accepted Payment Methods</h2>
      <p style={styles.description}>
        Choose which payment methods your business accepts. Disabled methods will not appear as options when recording payments.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
        {METHOD_INFO.map((info) => {
          const current = methods.find((m) => m.method === info.method);
          const enabled = current?.enabled ?? !info.integrationOnly;
          return (
            <div key={info.method} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', border: '1px solid var(--color-border)', borderRadius: '8px', background: enabled ? 'var(--color-surface)' : 'var(--color-background)' }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--color-text)' }}>{info.label}</span>
                {info.integrationOnly && <span style={{ marginLeft: '8px', fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'var(--color-warning-bg, #fff3cd)', color: 'var(--color-warning-text, #856404)' }}>Integration</span>}
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>{info.description}</p>
              </div>
              <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px', cursor: 'pointer' }}>
                <input type="checkbox" checked={enabled} onChange={() => toggleMethod(info.method)}
                  style={{ opacity: 0, width: 0, height: 0 }} />
                <span style={{
                  position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: enabled ? 'var(--color-primary)' : 'var(--color-border)',
                  borderRadius: '12px', transition: 'background-color 0.2s',
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

      {message && <p style={{ fontSize: '13px', color: message.includes('Failed') ? 'var(--color-error)' : 'var(--color-success)', marginBottom: '12px' }}>{message}</p>}
      <div style={styles.actions}>
        <Button onClick={handleSave} loading={saving}>Save Payment Methods</Button>
      </div>
    </div>
  );
}


// ============================================================
// Integrations Settings (placeholder)
// ============================================================

function IntegrationsSettings() {
  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>Integrations</h2>
      <p style={styles.description}>
        Connect external services to your business. Payment processors, calendars, accounting systems, and more will be configured here.
      </p>
      <p style={styles.muted}>No integrations configured yet. Integration options will be available as they are developed.</p>
    </div>
  );
}


// ============================================================
// Styles
// ============================================================

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '900px', margin: '0 auto' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-lg)' },
  tabBar: { display: 'flex', gap: '0', borderBottom: '1px solid var(--color-border)', marginBottom: '24px' },
  tab: { background: 'none', border: 'none', borderBottom: '2px solid transparent', padding: '10px 16px', fontSize: '14px', fontWeight: 500, color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  tabActive: { color: 'var(--color-primary)', borderBottomColor: 'var(--color-primary)' },
  section: { marginBottom: '32px' },
  sectionTitle: { fontSize: '18px', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 8px 0' },
  description: { fontSize: '14px', color: 'var(--color-text-secondary)', marginBottom: '20px' },
  fieldRow: { display: 'flex', gap: '24px', marginBottom: '16px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px', marginBottom: '16px', flex: 1 },
  label: { fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 },
  input: { backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '8px 12px', color: 'var(--color-text)', fontSize: '14px', fontFamily: 'var(--font-family)', maxWidth: '200px' },
  helper: { fontSize: '11px', color: 'var(--color-text-muted)' },
  checkLabel: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--color-text)', cursor: 'pointer' },
  actions: { marginTop: '16px' },
  message: { fontSize: '13px', color: 'var(--color-success)', marginTop: '8px' },
  muted: { fontSize: '14px', color: 'var(--color-text-secondary)' },
};
