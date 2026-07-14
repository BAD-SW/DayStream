import { useState, useEffect } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { apiClient } from '../api/client';

type SettingsTab = 'lifecycle' | 'scheduled-jobs' | 'notifications' | 'payment-methods' | 'note-categories';

export function BusinessSettings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('lifecycle');

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'lifecycle', label: 'Customer Lifecycle' },
    { key: 'scheduled-jobs', label: 'Scheduled Jobs' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'payment-methods', label: 'Payment Methods' },
    { key: 'note-categories', label: 'Note Categories' },
  ];

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Settings</h1>
      <div style={styles.tabBar}>
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{ ...styles.tab, ...(activeTab === tab.key ? styles.tabActive : {}) }}>
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === 'lifecycle' && <LifecycleSettings />}
      {activeTab === 'scheduled-jobs' && <ScheduledJobsSettings />}
      {activeTab === 'notifications' && <NotificationSettings />}
      {activeTab === 'payment-methods' && <PaymentMethodsSettings />}
      {activeTab === 'note-categories' && <NoteCategoriesSettings />}
    </div>
  );
}


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
// Scheduled Jobs Settings
// ============================================================

function ScheduledJobsSettings() {
  const businessId = localStorage.getItem('business_id') || '';
  const [jobs, setJobs] = useState<any[]>([]);
  const [jobTypes, setJobTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ job_type: '', schedule_time: '02:00', schedule_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, frequency: 'daily' });
  const [selectedHistory, setSelectedHistory] = useState<{ jobId: string; entries: any[] } | null>(null);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    Promise.all([
      apiClient.get(`/v1/customers/scheduled-jobs?business_id=${businessId}`).then(r => r.data.data),
      apiClient.get(`/v1/customers/scheduled-jobs/types`).then(r => r.data.data),
    ]).then(([j, t]) => { setJobs(j || []); setJobTypes(t || []); }).catch(() => {}).finally(() => setLoading(false));
  }, [businessId]);

  const handleAdd = async () => {
    try {
      const res = await apiClient.post(`/v1/customers/scheduled-jobs?business_id=${businessId}`, addForm);
      setJobs([...jobs, res.data.data]);
      setShowAdd(false);
      setAddForm({ job_type: '', schedule_time: '02:00', schedule_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, frequency: 'daily' });
    } catch { alert('Failed to create job'); }
  };

  const handleToggle = async (id: string) => {
    const res = await apiClient.put(`/v1/customers/scheduled-jobs/${id}/toggle`);
    setJobs(jobs.map(j => j.id === id ? { ...j, enabled: res.data.data.enabled } : j));
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this scheduled job?')) return;
    await apiClient.delete(`/v1/customers/scheduled-jobs/${id}`);
    setJobs(jobs.filter(j => j.id !== id));
  };

  const handleViewHistory = async (jobId: string) => {
    if (selectedHistory?.jobId === jobId) { setSelectedHistory(null); return; }
    const res = await apiClient.get(`/v1/customers/scheduled-jobs/${jobId}/history`);
    setSelectedHistory({ jobId, entries: res.data.data || [] });
  };

  const getJobLabel = (type: string) => jobTypes.find(t => t.type === type)?.label || type;

  if (loading) return <p style={styles.muted}>Loading...</p>;

  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>Scheduled Jobs</h2>
      <p style={styles.description}>
        Configure automated processes that run on a schedule. Each job runs at the specified time in your business timezone.
      </p>

      <div style={{ marginBottom: '16px' }}>
        <Button onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'Cancel' : 'Add Job'}</Button>
      </div>

      {showAdd && (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
          <div style={styles.fieldRow}>
            <div style={styles.field}>
              <label style={styles.label}>Job Type</label>
              <select style={{ ...styles.input, maxWidth: '300px' }} value={addForm.job_type} onChange={(e) => setAddForm({ ...addForm, job_type: e.target.value })}>
                <option value="">Select...</option>
                {jobTypes.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Frequency</label>
              <select style={styles.input} value={addForm.frequency} onChange={(e) => setAddForm({ ...addForm, frequency: e.target.value })}>
                <option value="every_15min">Every 15 minutes</option>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>
          <div style={styles.fieldRow}>
            <div style={styles.field}>
              <label style={styles.label}>Run Time</label>
              <input style={styles.input} type="time" value={addForm.schedule_time} onChange={(e) => setAddForm({ ...addForm, schedule_time: e.target.value })} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Timezone</label>
              <input style={{ ...styles.input, maxWidth: '250px' }} value={addForm.schedule_timezone} onChange={(e) => setAddForm({ ...addForm, schedule_timezone: e.target.value })} />
            </div>
          </div>
          {addForm.job_type && (
            <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '12px' }}>
              {jobTypes.find(t => t.type === addForm.job_type)?.description}
            </p>
          )}
          <Button onClick={handleAdd}>Create Job</Button>
        </div>
      )}

      {jobs.length === 0 ? (
        <p style={styles.muted}>No scheduled jobs configured. Add a job to automate recurring tasks.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {jobs.map((job) => (
            <div key={job.id}>
              <div style={{ border: '1px solid var(--color-border)', borderRadius: '8px', padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{getJobLabel(job.job_type)}</span>
                  <span style={{ marginLeft: '12px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                    {job.frequency} at {job.schedule_time} ({job.schedule_timezone})
                  </span>
                  {job.last_run_at && (
                    <span style={{ marginLeft: '12px', fontSize: '11px', color: 'var(--color-text-muted)' }}>
                      Last: {new Date(job.last_run_at).toLocaleString()} ({job.last_run_status})
                    </span>
                  )}
                  {job.consecutive_failures > 0 && (
                    <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--color-error)' }}>
                      ⚠ {job.consecutive_failures} failure(s)
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: '12px' }} onClick={() => handleViewHistory(job.id)}>History</button>
                  <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', color: job.enabled ? 'var(--color-success)' : 'var(--color-text-secondary)' }} onClick={() => handleToggle(job.id)}>
                    {job.enabled ? '● Enabled' : '○ Disabled'}
                  </button>
                  <button style={{ ...styles.input, maxWidth: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', color: 'var(--color-error)' }} onClick={() => handleDelete(job.id)}>Delete</button>
                </div>
              </div>
              {selectedHistory?.jobId === job.id && selectedHistory && (
                <div style={{ marginLeft: '16px', marginTop: '4px', borderLeft: '2px solid var(--color-border)', paddingLeft: '12px', marginBottom: '8px' }}>
                  {selectedHistory.entries.length === 0 ? <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>No execution history</p> : (
                    selectedHistory.entries.slice(0, 10).map((e: any) => (
                      <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '4px 0', borderBottom: '1px solid var(--color-border)' }}>
                        <span>{new Date(e.started_at).toLocaleString()}</span>
                        <span style={{ color: e.status === 'success' ? 'var(--color-success)' : 'var(--color-error)' }}>{e.status} {e.duration_ms ? `(${e.duration_ms}ms)` : ''}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
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
// Note Categories Settings
// ============================================================

function NoteCategoriesSettings() {
  const businessId = localStorage.getItem('business_id') || '';
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', is_sensitive: false, customer_visible: false });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    apiClient.get(`/v1/customers/note-categories/list?business_id=${businessId}`)
      .then((res) => setCategories(res.data.data || []))
      .catch(() => setCategories([]))
      .finally(() => setLoading(false));
  }, [businessId]);

  const handleAdd = async () => {
    if (!addForm.name.trim()) return;
    setAdding(true);
    try {
      const res = await apiClient.post(`/v1/customers/note-categories?business_id=${businessId}`, addForm);
      setCategories([...categories, res.data.data]);
      setAddForm({ name: '', is_sensitive: false, customer_visible: false });
      setShowAdd(false);
    } catch { alert('Failed to create category'); }
    finally { setAdding(false); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete the "${name}" category? Notes using this category will not be deleted.`)) return;
    try {
      await apiClient.delete(`/v1/customers/note-categories/${id}?business_id=${businessId}`);
      setCategories(categories.filter((c) => c.id !== id));
    } catch { alert('Failed to delete category'); }
  };

  if (loading) return <p style={styles.muted}>Loading...</p>;

  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>Note Categories</h2>
      <p style={styles.description}>
        Define the categories available when adding notes to customer profiles. Sensitive categories encrypt their content and restrict access by role.
      </p>

      <div style={{ marginBottom: '16px' }}>
        <Button onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'Cancel' : 'Add Category'}</Button>
      </div>

      {showAdd && (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
          <div style={styles.fieldRow}>
            <div style={styles.field}>
              <label style={styles.label}>Category Name</label>
              <input style={styles.input} value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="e.g., Medical History" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--color-text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={addForm.is_sensitive} onChange={(e) => setAddForm({ ...addForm, is_sensitive: e.target.checked })} style={{ width: '16px', height: '16px' }} />
              Sensitive (encrypted, restricted access)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--color-text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={addForm.customer_visible} onChange={(e) => setAddForm({ ...addForm, customer_visible: e.target.checked })} style={{ width: '16px', height: '16px' }} />
              Visible to customer
            </label>
          </div>
          <Button onClick={handleAdd} loading={adding}>Create Category</Button>
        </div>
      )}

      {categories.length === 0 ? (
        <p style={styles.muted}>No note categories defined. Add a category to start using customer notes.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {categories.map((cat) => (
            <div key={cat.id} style={{ border: '1px solid var(--color-border)', borderRadius: '8px', padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{cat.name}</span>
                {cat.is_sensitive && <span style={{ marginLeft: '8px', fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'var(--color-error)', color: '#fff' }}>Sensitive</span>}
                {cat.customer_visible && <span style={{ marginLeft: '8px', fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'var(--color-info, #4A90A4)', color: '#fff' }}>Customer Visible</span>}
              </div>
              <button style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', color: 'var(--color-error)' }} onClick={() => handleDelete(cat.id, cat.name)}>Delete</button>
            </div>
          ))}
        </div>
      )}
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
