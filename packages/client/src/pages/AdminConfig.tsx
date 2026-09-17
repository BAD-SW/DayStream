import { useState, useEffect, useCallback } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { ThemeGallery } from './settings/ThemeGallery';
import { apiClient } from '../api/client';

type Tab = 'settings' | 'feature-flags' | 'api-keys' | 'email' | 'storage' | 'notifications' | 'logs' | 'query-history' | 'platform-billing' | 'default-theme';

export function AdminConfig() {
  const [activeTab, setActiveTab] = useState<Tab>('settings');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'settings', label: 'Settings' },
    { key: 'feature-flags', label: 'Feature Flags' },
    { key: 'api-keys', label: 'API Keys' },
    { key: 'email', label: 'Email Server' },
    { key: 'storage', label: 'Storage' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'logs', label: 'Server Logs' },
    { key: 'query-history', label: 'Query Log' },
    { key: 'platform-billing', label: 'Platform Billing' },
    { key: 'default-theme', label: 'Themes' },
  ];

  return (
    <div>
      <h2 style={styles.heading}>Configuration</h2>
      <p style={styles.subtext}>Manage system settings, integrations, and platform configuration.</p>

      <div style={styles.tabs}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              ...styles.tab,
              ...(activeTab === tab.key ? styles.tabActive : {}),
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'settings' && <><SettingsPanel /><ProspectSettingsPanel /></>}
      {activeTab === 'feature-flags' && <FeatureFlagsPanel />}
      {activeTab === 'api-keys' && <ApiKeysPanel />}
      {activeTab === 'email' && <EmailServerPanel />}
      {activeTab === 'storage' && <StoragePanel />}
      {activeTab === 'notifications' && <NotificationsPanel />}
      {activeTab === 'logs' && <LogsPanel />}
      {activeTab === 'query-history' && <QueryHistoryPanel />}
      {activeTab === 'platform-billing' && <PlatformBillingPanel />}
      {activeTab === 'default-theme' && <DefaultThemePanel />}
    </div>
  );
}


// ============================================================
// Settings Panel
// ============================================================

function SettingsPanel() {
  const [config, setConfig] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [sortKey, setSortKey] = useState<'key' | 'value' | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    apiClient.get('/v1/admin/config')
      .then((res) => setConfig(res.data.data || {}))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (key: string) => {
    setSaving(true);
    try {
      await apiClient.put(`/v1/admin/config/${key}`, { value: editValue });
      setConfig((prev) => ({ ...prev, [key]: editValue }));
      setEditKey(null);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  function handleSort(col: 'key' | 'value') {
    if (sortKey === col) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    else { setSortKey(col); setSortOrder('asc'); }
  }

  if (loading) return <p style={styles.loading}>Loading...</p>;
  let entries = Object.entries(config);
  if (entries.length === 0) return <p style={styles.empty}>No configuration entries found.</p>;
  if (sortKey) {
    entries = [...entries].sort((a, b) => {
      const aVal = sortKey === 'key' ? a[0] : String(a[1]);
      const bVal = sortKey === 'key' ? b[0] : String(b[1]);
      const cmp = aVal.toLowerCase().localeCompare(bVal.toLowerCase());
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }

  return (
    <div style={styles.table}>
      <div style={styles.tableHeader}>
        <span style={{ ...styles.colKey, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('key')}>
          Key {sortKey === 'key' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}
        </span>
        <span style={{ ...styles.colValue, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('value')}>
          Value {sortKey === 'value' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}
        </span>
        <span style={styles.colAction}>Action</span>
      </div>
      {entries.map(([key, value]) => (
        <div key={key} style={styles.tableRow}>
          <span style={styles.colKey}>{key}</span>
          {editKey === key ? (
            <span style={styles.colValue}>
              <input style={styles.input} value={editValue} onChange={(e) => setEditValue(e.target.value)} />
            </span>
          ) : (
            <span style={styles.colValue}>{String(value)}</span>
          )}
          <span style={styles.colAction}>
            {editKey === key ? (
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button size="sm" onClick={() => handleSave(key)} disabled={saving}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditKey(null)}>Cancel</Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => { setEditKey(key); setEditValue(String(value)); }}>Edit</Button>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function ProspectSettingsPanel() {
  const [resolution, setResolution] = useState(5);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient.get('/v1/admin/system-config/prospects')
      .then((res) => { setResolution(res.data.data?.h3_resolution || 5); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.put('/v1/admin/system-config/prospects', { h3_resolution: resolution });
      alert('Prospect settings saved. Re-save territories to apply new resolution.');
    } catch { alert('Failed to save'); }
    finally { setSaving(false); }
  };

  if (loading) return <p style={styles.loading}>Loading...</p>;

  return (
    <div style={{ marginTop: '24px', padding: '16px', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
      <h3 style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' }}>Prospect Search Settings</h3>
      <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: '0 0 12px' }}>
        Search resolution determines how territory hexagons are collapsed for API searches. Lower = fewer, larger search areas (fewer API calls, cheaper). Coverage map always uses resolution 7 for sharp borders.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <label style={{ fontSize: '13px', color: 'var(--color-text)' }}>Search Resolution:</label>
        <select style={{ padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '13px' }} value={resolution} onChange={(e) => setResolution(parseInt(e.target.value))}>
          <option value={4}>4 — ~22km edge (country-level, fewest calls)</option>
          <option value={5}>5 — ~8km edge (regional, balanced)</option>
          <option value={6}>6 — ~7km edge (city-level, precise borders)</option>
          <option value={7}>7 — ~2.6km edge (neighborhood, most calls)</option>
        </select>
        <button onClick={handleSave} disabled={saving} style={{ padding: '6px 16px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}


// ============================================================
// Feature Flags Panel
// ============================================================

interface Flag { key: string; enabled: boolean; }

function FeatureFlagsPanel() {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<'key' | 'enabled' | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    apiClient.get('/v1/admin/feature-flags')
      .then((res) => {
        const data = res.data.data;
        if (Array.isArray(data)) setFlags(data);
        else if (typeof data === 'object') setFlags(Object.entries(data).map(([key, enabled]) => ({ key, enabled: Boolean(enabled) })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggleFlag = async (key: string, currentValue: boolean) => {
    try {
      await apiClient.put(`/v1/admin/feature-flags/${key}`, { enabled: !currentValue });
      setFlags((prev) => prev.map((f) => f.key === key ? { ...f, enabled: !currentValue } : f));
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to toggle flag');
    }
  };

  function handleSort(col: 'key' | 'enabled') {
    if (sortKey === col) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    else { setSortKey(col); setSortOrder('asc'); }
  }

  if (loading) return <p style={styles.loading}>Loading...</p>;
  if (flags.length === 0) return <p style={styles.empty}>No feature flags configured.</p>;

  let sortedFlags = flags;
  if (sortKey) {
    sortedFlags = [...flags].sort((a, b) => {
      if (sortKey === 'key') {
        const cmp = a.key.toLowerCase().localeCompare(b.key.toLowerCase());
        return sortOrder === 'asc' ? cmp : -cmp;
      }
      const aVal = a.enabled ? 1 : 0;
      const bVal = b.enabled ? 1 : 0;
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }

  return (
    <div style={styles.table}>
      <div style={styles.tableHeader}>
        <span style={{ flex: 3, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('key')}>
          Flag {sortKey === 'key' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}
        </span>
        <span style={{ flex: 1, textAlign: 'right' as const, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('enabled')}>
          Status {sortKey === 'enabled' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </div>
      {sortedFlags.map((flag) => (
        <div key={flag.key} style={styles.tableRow}>
          <span style={{ flex: 3, fontFamily: 'monospace', fontSize: '13px', color: 'var(--color-text)' }}>{flag.key}</span>
          <span style={{ flex: 1, textAlign: 'right' as const }}>
            <label style={styles.toggle}>
              <input type="checkbox" checked={flag.enabled} onChange={() => toggleFlag(flag.key, flag.enabled)} style={styles.checkbox} />
              <Badge variant={flag.enabled ? 'success' : 'neutral'}>{flag.enabled ? 'Enabled' : 'Disabled'}</Badge>
            </label>
          </span>
        </div>
      ))}
    </div>
  );
}


// ============================================================
// Email Server Panel
// ============================================================

interface EmailConfig {
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string;
  from_email: string;
  from_name: string;
  rate_limit_per_hour: number;
}

const EMPTY_EMAIL: EmailConfig = {
  smtp_host: '', smtp_port: 587, smtp_secure: false,
  smtp_user: '', smtp_password: '',
  from_email: '', from_name: '', rate_limit_per_hour: 100,
};

function ApiKeysPanel() {
  const [keys, setKeys] = useState<Record<string, string>>({ google_places: '' });
  const [masked, setMasked] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient.get('/v1/admin/system-config/api-keys')
      .then((res) => {
        const data = res.data.data;
        setMasked(data?.keys || {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, string> = {};
      // Only send non-empty values that aren't the masked placeholder
      for (const [key, val] of Object.entries(keys)) {
        if (val && !val.includes('...')) body[key] = val;
      }
      if (Object.keys(body).length === 0) { alert('No changes to save'); setSaving(false); return; }
      await apiClient.put('/v1/admin/system-config/api-keys', body);
      alert('API keys saved');
      setKeys({ google_places: '' });
      // Refresh masked display
      const res = await apiClient.get('/v1/admin/system-config/api-keys');
      setMasked(res.data.data?.keys || {});
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to save'); }
    finally { setSaving(false); }
  };

  if (loading) return <p style={styles.loading}>Loading...</p>;

  return (
    <div>
      <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
        Platform-level API keys for third-party integrations. Keys are stored securely and masked after saving.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '600px' }}>
        <div>
          <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)', display: 'block', marginBottom: '4px' }}>Google Places API Key</label>
          <input
            style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '13px', color: 'var(--color-text)', background: 'var(--color-background)', fontFamily: 'monospace' }}
            type="text"
            placeholder={masked.google_places || 'Enter API key...'}
            value={keys.google_places}
            onChange={(e) => setKeys({ ...keys, google_places: e.target.value })}
          />
          {masked.google_places && <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '2px', display: 'block' }}>Current: {masked.google_places}</span>}
        </div>
      </div>
      <div style={{ marginTop: '16px' }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ padding: '8px 20px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
        >
          {saving ? 'Saving...' : 'Save API Keys'}
        </button>
      </div>
    </div>
  );
}

function EmailServerPanel() {
  const [form, setForm] = useState<EmailConfig>(EMPTY_EMAIL);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get('/v1/admin/system-config/email')
      .then((res) => {
        if (res.data.data) {
          const d = res.data.data;
          setForm({
            smtp_host: d.smtp_host || '',
            smtp_port: d.smtp_port ?? 587,
            smtp_secure: d.smtp_secure ?? false,
            smtp_user: d.smtp_user || '',
            smtp_password: d.smtp_password || '',
            from_email: d.from_email || '',
            from_name: d.from_name || '',
            rate_limit_per_hour: d.rate_limit_per_hour ?? 100,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true); setMessage(null);
    try {
      await apiClient.put('/v1/admin/system-config/email', form);
      setMessage('Email configuration saved.');
    } catch (err: any) { setMessage(err.response?.data?.message || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await apiClient.post('/v1/admin/system-config/email/test', form);
      setTestResult({ ok: true, msg: res.data.message || 'Connection successful' });
    } catch (err: any) {
      setTestResult({ ok: false, msg: err.response?.data?.message || 'Connection failed' });
    } finally { setTesting(false); }
  };

  if (loading) return <p style={styles.loading}>Loading...</p>;

  return (
    <div style={styles.panel}>
      <h3 style={styles.panelTitle}>Email Server (SMTP)</h3>
      <p style={styles.panelSubtext}>Configure the SMTP server used for transactional emails (booking confirmations, password resets, etc.)</p>
      {message && <div style={styles.successMsg}>{message}</div>}
      <div style={styles.formSection}>
        <div style={styles.formRow}>
          <div style={styles.formGroup}>
            <label style={styles.label}>SMTP Host</label>
            <input style={styles.input} value={form.smtp_host} onChange={(e) => setForm({ ...form, smtp_host: e.target.value })} placeholder="smtp.example.com" />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Port</label>
            <input style={styles.input} type="number" value={form.smtp_port} onChange={(e) => setForm({ ...form, smtp_port: Number(e.target.value) })} />
          </div>
        </div>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={form.smtp_secure} onChange={(e) => setForm({ ...form, smtp_secure: e.target.checked })} />
          <span style={{ marginLeft: '8px' }}>Use SSL (port 465)</span>
        </label>
      </div>

      <div style={styles.formSection}>
        <div style={styles.formRow}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Username</label>
            <input style={styles.input} value={form.smtp_user} onChange={(e) => setForm({ ...form, smtp_user: e.target.value })} placeholder="user@example.com" />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Password</label>
            <div style={{ position: 'relative' }}>
              <input style={styles.input} type={showPassword ? 'text' : 'password'} value={form.smtp_password} onChange={(e) => setForm({ ...form, smtp_password: e.target.value })} placeholder="••••••••" />
              <button type="button" style={styles.eyeBtn} onClick={() => setShowPassword(!showPassword)}>{showPassword ? '🙈' : '👁️'}</button>
            </div>
          </div>
        </div>
      </div>
      <div style={styles.formSection}>
        <div style={styles.formRow}>
          <div style={styles.formGroup}>
            <label style={styles.label}>From Email</label>
            <input style={styles.input} type="email" value={form.from_email} onChange={(e) => setForm({ ...form, from_email: e.target.value })} placeholder="noreply@yourdomain.com" />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>From Name</label>
            <input style={styles.input} value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} placeholder="DayStream" />
          </div>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Rate Limit (emails/hour)</label>
          <input style={{ ...styles.input, maxWidth: '160px' }} type="number" value={form.rate_limit_per_hour} onChange={(e) => setForm({ ...form, rate_limit_per_hour: Number(e.target.value) })} min={0} />
          <span style={styles.helper}>0 = unlimited</span>
        </div>
      </div>
      {testResult && (
        <div style={{ ...styles.testResult, borderColor: testResult.ok ? 'var(--color-success)' : 'var(--color-error)' }}>
          {testResult.ok ? '✅' : '❌'} {testResult.msg}
        </div>
      )}
      <div style={styles.formActions}>
        <Button variant="outline" onClick={handleTest} loading={testing}>Test Connection</Button>
        <Button onClick={handleSave} loading={saving}>Save Configuration</Button>
      </div>
    </div>
  );
}


// ============================================================
// Storage Panel
// ============================================================

interface StorageConfig {
  storage_type: 'local' | 'aws_s3';
  local_path: string;
  s3_bucket: string;
  s3_region: string;
  s3_access_key: string;
  s3_secret_key: string;
}

const EMPTY_STORAGE: StorageConfig = {
  storage_type: 'local', local_path: '', s3_bucket: '',
  s3_region: 'us-east-1', s3_access_key: '', s3_secret_key: '',
};

function StoragePanel() {
  const [form, setForm] = useState<StorageConfig>(EMPTY_STORAGE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    apiClient.get('/v1/admin/system-config/storage')
      .then((res) => {
        if (res.data.data) {
          const d = res.data.data;
          setForm({
            storage_type: d.storage_type || 'local',
            local_path: d.local_path || '',
            s3_bucket: d.s3_bucket || '',
            s3_region: d.s3_region || 'us-east-1',
            s3_access_key: d.s3_access_key || '',
            s3_secret_key: d.s3_secret_key || '',
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true); setMessage(null);
    try {
      await apiClient.put('/v1/admin/system-config/storage', form);
      setMessage('Storage configuration saved.');
    } catch (err: any) { setMessage(err.response?.data?.message || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await apiClient.post('/v1/admin/system-config/storage/test', form);
      setTestResult({ ok: true, msg: res.data.message || 'Storage connection successful' });
    } catch (err: any) {
      setTestResult({ ok: false, msg: err.response?.data?.message || 'Connection failed' });
    } finally { setTesting(false); }
  };

  if (loading) return <p style={styles.loading}>Loading...</p>;

  return (
    <div style={styles.panel}>
      <h3 style={styles.panelTitle}>File Storage</h3>
      <p style={styles.panelSubtext}>Configure where uploaded files (images, documents, media) are stored.</p>
      {message && <div style={styles.successMsg}>{message}</div>}
      <div style={styles.formSection}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Storage Provider</label>
          <select style={styles.input} value={form.storage_type} onChange={(e) => setForm({ ...form, storage_type: e.target.value as 'local' | 'aws_s3' })}>
            <option value="local">Local File System</option>
            <option value="aws_s3">AWS S3</option>
          </select>
        </div>
      </div>

      {form.storage_type === 'local' && (
        <div style={styles.formSection}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Storage Path</label>
            <input style={styles.input} value={form.local_path} onChange={(e) => setForm({ ...form, local_path: e.target.value })} placeholder="/var/data/daystream/uploads" />
            <span style={styles.helper}>Absolute path on the server where files will be stored</span>
          </div>
        </div>
      )}

      {form.storage_type === 'aws_s3' && (
        <div style={styles.formSection}>
          <div style={styles.formRow}>
            <div style={styles.formGroup}>
              <label style={styles.label}>S3 Bucket</label>
              <input style={styles.input} value={form.s3_bucket} onChange={(e) => setForm({ ...form, s3_bucket: e.target.value })} placeholder="my-daystream-bucket" />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Region</label>
              <select style={styles.input} value={form.s3_region} onChange={(e) => setForm({ ...form, s3_region: e.target.value })}>
                <option value="us-east-1">US East (N. Virginia)</option>
                <option value="us-east-2">US East (Ohio)</option>
                <option value="us-west-1">US West (N. California)</option>
                <option value="us-west-2">US West (Oregon)</option>
                <option value="eu-west-1">EU (Ireland)</option>
                <option value="eu-central-1">EU (Frankfurt)</option>
                <option value="ap-southeast-1">Asia Pacific (Singapore)</option>
                <option value="ap-northeast-1">Asia Pacific (Tokyo)</option>
              </select>
            </div>
          </div>
          <div style={styles.formRow}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Access Key ID</label>
              <input style={styles.input} value={form.s3_access_key} onChange={(e) => setForm({ ...form, s3_access_key: e.target.value })} placeholder="AKIA..." />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Secret Access Key</label>
              <div style={{ position: 'relative' }}>
                <input style={styles.input} type={showSecret ? 'text' : 'password'} value={form.s3_secret_key} onChange={(e) => setForm({ ...form, s3_secret_key: e.target.value })} placeholder="••••••••" />
                <button type="button" style={styles.eyeBtn} onClick={() => setShowSecret(!showSecret)}>{showSecret ? '🙈' : '👁️'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {testResult && (
        <div style={{ ...styles.testResult, borderColor: testResult.ok ? 'var(--color-success)' : 'var(--color-error)' }}>
          {testResult.ok ? '✅' : '❌'} {testResult.msg}
        </div>
      )}
      <div style={styles.formActions}>
        <Button variant="outline" onClick={handleTest} loading={testing}>Test Connection</Button>
        <Button onClick={handleSave} loading={saving}>Save Configuration</Button>
      </div>
    </div>
  );
}


// ============================================================
// Notifications Panel
// ============================================================

interface NotificationConfig {
  email_enabled: boolean;
  sms_enabled: boolean;
  push_enabled: boolean;
  sms_provider: 'twilio' | 'none';
  twilio_account_sid: string;
  twilio_auth_token: string;
  twilio_from_number: string;
  push_vapid_public_key: string;
  push_vapid_private_key: string;
}

const EMPTY_NOTIF: NotificationConfig = {
  email_enabled: true, sms_enabled: false, push_enabled: false,
  sms_provider: 'none', twilio_account_sid: '', twilio_auth_token: '', twilio_from_number: '',
  push_vapid_public_key: '', push_vapid_private_key: '',
};

function NotificationsPanel() {
  const [form, setForm] = useState<NotificationConfig>(EMPTY_NOTIF);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get('/v1/admin/system-config/notifications')
      .then((res) => {
        if (res.data.data) {
          const d = res.data.data;
          setForm({
            email_enabled: d.email_enabled ?? true,
            sms_enabled: d.sms_enabled ?? false,
            push_enabled: d.push_enabled ?? false,
            sms_provider: d.sms_provider || 'none',
            twilio_account_sid: d.twilio_account_sid || '',
            twilio_auth_token: d.twilio_auth_token || '',
            twilio_from_number: d.twilio_from_number || '',
            push_vapid_public_key: d.push_vapid_public_key || '',
            push_vapid_private_key: d.push_vapid_private_key || '',
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true); setMessage(null);
    try {
      await apiClient.put('/v1/admin/system-config/notifications', form);
      setMessage('Notification configuration saved.');
    } catch (err: any) { setMessage(err.response?.data?.message || 'Failed to save'); }
    finally { setSaving(false); }
  };

  if (loading) return <p style={styles.loading}>Loading...</p>;

  return (
    <div style={styles.panel}>
      <h3 style={styles.panelTitle}>Notification Channels</h3>
      <p style={styles.panelSubtext}>Configure how the system sends notifications to users (booking reminders, marketing, etc.)</p>
      {message && <div style={styles.successMsg}>{message}</div>}

      <div style={styles.formSection}>
        <label style={styles.checkLabel}><input type="checkbox" checked={form.email_enabled} onChange={(e) => setForm({ ...form, email_enabled: e.target.checked })} /><span style={{ marginLeft: '8px' }}>Email notifications enabled</span></label>
        <label style={styles.checkLabel}><input type="checkbox" checked={form.sms_enabled} onChange={(e) => setForm({ ...form, sms_enabled: e.target.checked })} /><span style={{ marginLeft: '8px' }}>SMS notifications enabled</span></label>
        <label style={styles.checkLabel}><input type="checkbox" checked={form.push_enabled} onChange={(e) => setForm({ ...form, push_enabled: e.target.checked })} /><span style={{ marginLeft: '8px' }}>Push notifications enabled</span></label>
      </div>

      {form.sms_enabled && (
        <div style={styles.formSection}>
          <h4 style={styles.sectionLabel}>SMS Provider (Twilio)</h4>
          <div style={styles.formRow}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Account SID</label>
              <input style={styles.input} value={form.twilio_account_sid} onChange={(e) => setForm({ ...form, twilio_account_sid: e.target.value })} placeholder="AC..." />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Auth Token</label>
              <input style={styles.input} type="password" value={form.twilio_auth_token} onChange={(e) => setForm({ ...form, twilio_auth_token: e.target.value })} placeholder="••••••••" />
            </div>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>From Number</label>
            <input style={{ ...styles.input, maxWidth: '200px' }} value={form.twilio_from_number} onChange={(e) => setForm({ ...form, twilio_from_number: e.target.value })} placeholder="+1234567890" />
          </div>
        </div>
      )}

      {form.push_enabled && (
        <div style={styles.formSection}>
          <h4 style={styles.sectionLabel}>Web Push (VAPID Keys)</h4>
          <div style={styles.formGroup}>
            <label style={styles.label}>Public Key</label>
            <input style={styles.input} value={form.push_vapid_public_key} onChange={(e) => setForm({ ...form, push_vapid_public_key: e.target.value })} placeholder="BNy..." />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Private Key</label>
            <input style={styles.input} type="password" value={form.push_vapid_private_key} onChange={(e) => setForm({ ...form, push_vapid_private_key: e.target.value })} placeholder="••••••••" />
          </div>
        </div>
      )}

      <div style={styles.formActions}>
        <Button onClick={handleSave} loading={saving}>Save Configuration</Button>
      </div>
    </div>
  );
}


// ============================================================
// Logs Panel
// ============================================================

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  meta?: string;
}

function LogsPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetchLogs = async () => {
    try {
      const params: Record<string, any> = { limit: 100 };
      if (levelFilter !== 'all') params.level = levelFilter;
      const res = await apiClient.get('/v1/admin/system-config/logs', { params });
      setLogs(res.data.data || []);
    } catch {
      setLogs([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchLogs(); }, [levelFilter]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, levelFilter]);

  const levelColor = (level: string) => {
    switch (level) {
      case 'error': return 'var(--color-error)';
      case 'warn': return 'var(--color-warning)';
      case 'info': return 'var(--color-info)';
      default: return 'var(--color-text-secondary)';
    }
  };

  return (
    <div style={styles.panel}>
      <h3 style={styles.panelTitle}>Server Logs</h3>
      <p style={styles.panelSubtext}>View recent application logs for debugging and monitoring.</p>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
        <select style={{ ...styles.input, maxWidth: '140px' }} value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
          <option value="all">All Levels</option>
          <option value="error">Error</option>
          <option value="warn">Warning</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
        </select>
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          <span style={{ marginLeft: '8px' }}>Auto-refresh (5s)</span>
        </label>
        <Button variant="ghost" size="sm" onClick={fetchLogs}>Refresh</Button>
      </div>

      {loading ? (
        <p style={styles.loading}>Loading...</p>
      ) : logs.length === 0 ? (
        <p style={styles.empty}>No log entries found.</p>
      ) : (
        <div style={styles.logContainer}>
          {logs.map((entry, i) => (
            <div key={i} style={styles.logEntry}>
              <span style={{ ...styles.logLevel, color: levelColor(entry.level) }}>{entry.level.toUpperCase()}</span>
              <span style={styles.logTime}>{new Date(entry.timestamp).toLocaleTimeString()}</span>
              <span style={styles.logMsg}>{entry.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ============================================================
// Platform Billing Panel (DayStream's receiving account)
// ============================================================

interface PlatformBillingConfig {
  bank_name: string;
  account_holder: string;
  account_number: string;
  routing_number: string;
  iban: string;
  swift: string;
}

const EMPTY_PLATFORM_BILLING: PlatformBillingConfig = {
  bank_name: '', account_holder: '', account_number: '',
  routing_number: '', iban: '', swift: '',
};

function PlatformBillingPanel() {
  const [form, setForm] = useState<PlatformBillingConfig>(EMPTY_PLATFORM_BILLING);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get('/v1/admin/system-config/platform-billing')
      .then((res) => {
        if (res.data.data) {
          const d = res.data.data;
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
      await apiClient.put('/v1/admin/system-config/platform-billing', form);
      setMessage('Platform billing account saved.');
    } catch (err: any) { setMessage(err.response?.data?.message || 'Failed to save'); }
    finally { setSaving(false); }
  };

  if (loading) return <p style={styles.loading}>Loading...</p>;

  return (
    <div style={styles.panel}>
      <h3 style={styles.panelTitle}>Platform Receiving Account</h3>
      <p style={styles.panelSubtext}>DayStream bank account where all tenant payments are deposited.</p>
      {message && <div style={styles.successMsg}>{message}</div>}
      <div style={styles.formSection}>
        <div style={styles.formRow}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Bank Name</label>
            <input style={styles.input} value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} placeholder="Bank Name" />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Account Holder</label>
            <input style={styles.input} value={form.account_holder} onChange={(e) => setForm({ ...form, account_holder: e.target.value })} placeholder="DayStream Inc." />
          </div>
        </div>
        <div style={styles.formRow}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Account Number</label>
            <input style={styles.input} value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} placeholder="••••••1234" />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Routing Number</label>
            <input style={styles.input} value={form.routing_number} onChange={(e) => setForm({ ...form, routing_number: e.target.value })} placeholder="021000021" />
          </div>
        </div>
        <div style={styles.formRow}>
          <div style={styles.formGroup}>
            <label style={styles.label}>IBAN (international)</label>
            <input style={styles.input} value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} placeholder="GB29 NWBK 6016 1331 9268 19" />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>SWIFT/BIC</label>
            <input style={styles.input} value={form.swift} onChange={(e) => setForm({ ...form, swift: e.target.value })} placeholder="NWBKGB2L" />
          </div>
        </div>
      </div>
      <div style={styles.formActions}>
        <Button onClick={handleSave} loading={saving}>Save Configuration</Button>
      </div>
    </div>
  );
}

// ============================================================
// Themes Panel — Theme Setup module (spec 37): pick, customise, and apply named
// themes at system scope. Supersedes the old flat "Platform Default Theme" panel.
// ============================================================

function DefaultThemePanel() {
  // Deliberately does NOT use styles.panel (maxWidth: 720px) — the theme gallery/editor's
  // multi-column layout needs real width; that cap was squeezing it into 2 narrow columns.
  return <ThemeGallery persona="system" />;
}

// ============================================================
// Query History Panel
// ============================================================

interface RequestLog {
  id: string;
  method: string;
  path: string;
  status_code: number;
  duration_ms: number | null;
  user_email: string | null;
  tenant_name: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

function QueryHistoryPanel() {
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [methodFilter, setMethodFilter] = useState('');
  const [pathFilter, setPathFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedLog, setSelectedLog] = useState<RequestLog | null>(null);
  const limit = 50;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, limit };
      if (methodFilter) params.method = methodFilter;
      if (pathFilter) params.path = pathFilter;
      if (statusFilter) params.status_code = statusFilter;
      const res = await apiClient.get('/v1/admin/system-config/query-history', { params });
      setLogs(res.data.data || []);
      setTotal(res.data.meta?.total || 0);
    } catch {
      setLogs([]);
    } finally { setLoading(false); }
  }, [page, methodFilter, pathFilter, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalPages = Math.ceil(total / limit);

  const methodBadge = (m: string) => {
    const variants: Record<string, 'success' | 'info' | 'warning' | 'error' | 'neutral'> = {
      GET: 'info', POST: 'success', PUT: 'warning', PATCH: 'warning', DELETE: 'error',
    };
    return <Badge variant={variants[m] || 'neutral'}>{m}</Badge>;
  };

  const statusBadge = (code: number) => {
    const variant = code < 300 ? 'success' : code < 400 ? 'info' : code < 500 ? 'warning' : 'error';
    return <Badge variant={variant}>{code}</Badge>;
  };

  return (
    <div style={styles.panel}>
      <h3 style={styles.panelTitle}>Query Log</h3>
      <p style={styles.panelSubtext}>All front-end API requests made to the server.</p>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' as const, marginBottom: '16px' }}>
        <select style={{ ...styles.input, maxWidth: '120px' }} value={methodFilter} onChange={(e) => { setMethodFilter(e.target.value); setPage(1); }}>
          <option value="">All Methods</option>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="DELETE">DELETE</option>
        </select>
        <input style={{ ...styles.input, maxWidth: '200px' }} placeholder="Filter path..." value={pathFilter} onChange={(e) => { setPathFilter(e.target.value); setPage(1); }} />
        <select style={{ ...styles.input, maxWidth: '140px' }} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All Status</option>
          <option value="200">200 OK</option>
          <option value="201">201 Created</option>
          <option value="400">400 Bad Request</option>
          <option value="401">401 Unauthorized</option>
          <option value="403">403 Forbidden</option>
          <option value="404">404 Not Found</option>
          <option value="500">500 Server Error</option>
        </select>
        <Button variant="ghost" size="sm" onClick={fetchData}>Refresh</Button>
      </div>

      {loading ? <p style={styles.loading}>Loading...</p> : logs.length === 0 ? <p style={styles.empty}>No requests logged yet.</p> : (
        <>
          <div style={{ ...styles.table, maxWidth: 'none' }}>
            <div style={styles.tableHeader}>
              <span style={{ width: '100px', flexShrink: 0 }}>Time</span>
              <span style={{ width: '70px', flexShrink: 0 }}>Method</span>
              <span style={{ flex: 1, minWidth: 0 }}>Path</span>
              <span style={{ width: '55px', flexShrink: 0, textAlign: 'center' as const }}>Status</span>
              <span style={{ width: '60px', flexShrink: 0, textAlign: 'right' as const }}>Duration</span>
              <span style={{ width: '60px', flexShrink: 0, textAlign: 'center' as const }}>Details</span>
            </div>
            {logs.map((log) => (
              <div key={log.id} style={{ ...styles.tableRow, cursor: 'pointer' }} onClick={() => setSelectedLog(log)}>
                <span style={{ width: '100px', flexShrink: 0, fontSize: '12px' }}>{new Date(log.created_at).toLocaleTimeString()}</span>
                <span style={{ width: '70px', flexShrink: 0 }}>{methodBadge(log.method)}</span>
                <span style={{ flex: 1, minWidth: 0, fontFamily: 'monospace', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{log.path}</span>
                <span style={{ width: '55px', flexShrink: 0, textAlign: 'center' as const }}>{statusBadge(log.status_code)}</span>
                <span style={{ width: '60px', flexShrink: 0, textAlign: 'right' as const, fontSize: '12px' }}>{log.duration_ms != null ? `${log.duration_ms}ms` : '—'}</span>
                <span style={{ width: '60px', flexShrink: 0, textAlign: 'center' as const }}>
                  <Button variant="ghost" size="sm" onClick={(e: React.MouseEvent) => { e.stopPropagation(); setSelectedLog(log); }}>View</Button>
                </span>
              </div>
            ))}
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', alignItems: 'center', marginTop: '12px' }}>
              <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>Page {page} of {totalPages}</span>
              <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </>
      )}

      {/* Detail Modal */}
      {selectedLog && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Request Detail</h3>
              <button style={styles.closeBtn} onClick={() => setSelectedLog(null)}>&times;</button>
            </div>
            <div style={styles.detailBody}>
              <div style={styles.detailRow}><span style={styles.detailLabel}>Date/Time</span><span style={styles.detailValue}>{new Date(selectedLog.created_at).toLocaleString()}</span></div>
              <div style={styles.detailRow}><span style={styles.detailLabel}>Method</span><span style={styles.detailValue}>{selectedLog.method}</span></div>
              <div style={styles.detailRow}><span style={styles.detailLabel}>Path</span><span style={{ ...styles.detailValue, wordBreak: 'break-all' as const }}>{selectedLog.path}</span></div>
              <div style={styles.detailRow}><span style={styles.detailLabel}>Status Code</span><span style={styles.detailValue}>{selectedLog.status_code}</span></div>
              <div style={styles.detailRow}><span style={styles.detailLabel}>Duration</span><span style={styles.detailValue}>{selectedLog.duration_ms != null ? `${selectedLog.duration_ms}ms` : '—'}</span></div>
              <div style={styles.detailRow}><span style={styles.detailLabel}>User</span><span style={styles.detailValue}>{selectedLog.user_email || '—'}</span></div>
              <div style={styles.detailRow}><span style={styles.detailLabel}>Tenant</span><span style={styles.detailValue}>{selectedLog.tenant_name || '—'}</span></div>
              <div style={styles.detailRow}><span style={styles.detailLabel}>IP Address</span><span style={styles.detailValue}>{selectedLog.ip_address || '—'}</span></div>
              <div style={styles.detailRow}><span style={styles.detailLabel}>User Agent</span><span style={{ ...styles.detailValue, fontSize: '11px', wordBreak: 'break-all' as const }}>{selectedLog.user_agent || '—'}</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Styles
// ============================================================

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: '24px', fontWeight: 300, margin: '0 0 8px 0', color: 'var(--color-text)' },
  subtext: { color: 'var(--color-text-secondary)', fontSize: '14px', marginBottom: '24px' },
  loading: { color: 'var(--color-text-secondary)', fontSize: '14px' },
  empty: { color: 'var(--color-text-secondary)', fontSize: '14px' },

  // Tabs
  tabs: { display: 'flex', gap: '0', borderBottom: '1px solid var(--color-border)', marginBottom: '24px', flexWrap: 'wrap' as const },
  tab: {
    background: 'none', border: 'none', borderBottom: '2px solid transparent',
    padding: '10px 16px', fontSize: '14px', fontWeight: 500,
    color: 'var(--color-text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' as const,
  },
  tabActive: { color: 'var(--color-primary)', borderBottomColor: 'var(--color-primary)' },

  // Table (Settings + Feature Flags)
  table: { border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' },
  tableHeader: { display: 'flex', padding: '12px 16px', backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, gap: '12px' },
  tableRow: { display: 'flex', padding: '12px 16px', borderBottom: '1px solid var(--color-border)', alignItems: 'center', fontSize: '14px', color: 'var(--color-text)', gap: '12px' },
  colKey: { flex: 2, fontFamily: 'monospace', fontSize: '13px' },
  colValue: { flex: 3 },
  colAction: { flex: 1, textAlign: 'right' as const },
  toggle: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', justifyContent: 'flex-end' },
  checkbox: { width: '16px', height: '16px', cursor: 'pointer' },

  // Panel (shared for Email, Storage, Notifications, Logs)
  panel: { maxWidth: '720px' },
  panelTitle: { fontSize: '18px', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 4px 0' },
  panelSubtext: { fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '24px' },
  successMsg: { padding: '8px 12px', borderRadius: '6px', background: 'var(--color-surface)', border: '1px solid var(--color-success)', color: 'var(--color-success)', fontSize: '13px', marginBottom: '16px' },
  testResult: { padding: '10px 14px', borderRadius: '6px', border: '1px solid', fontSize: '13px', marginBottom: '16px', color: 'var(--color-text)' },

  // Form elements
  formSection: { marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid var(--color-border)' },
  formRow: { display: 'flex', gap: '16px', marginBottom: '12px' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px', flex: 1, minWidth: 0 },
  formActions: { display: 'flex', gap: '12px', paddingTop: '8px' },
  label: { fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 },
  sectionLabel: { fontSize: '14px', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 12px 0' },
  input: { backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '8px 12px', color: 'var(--color-text)', fontSize: '14px', fontFamily: 'var(--font-family)', outline: 'none', width: '100%', boxSizing: 'border-box' as const },
  helper: { fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' },
  checkLabel: { display: 'flex', alignItems: 'center', fontSize: '14px', color: 'var(--color-text)', cursor: 'pointer', marginBottom: '8px' },
  eyeBtn: { position: 'absolute' as const, right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' },

  // Logs
  logContainer: { border: '1px solid var(--color-border)', borderRadius: '8px', maxHeight: '400px', overflowY: 'auto' as const, fontFamily: 'monospace', fontSize: '12px', backgroundColor: 'var(--color-surface)' },
  logEntry: { display: 'flex', gap: '12px', padding: '6px 12px', borderBottom: '1px solid var(--color-border)', alignItems: 'baseline' },
  logLevel: { fontWeight: 700, fontSize: '10px', width: '50px', textTransform: 'uppercase' as const, flexShrink: 0 },
  logTime: { color: 'var(--color-text-muted)', fontSize: '11px', flexShrink: 0, width: '80px' },
  logMsg: { color: 'var(--color-text)', wordBreak: 'break-word' as const, flex: 1 },

  // Modal / Detail (shared)
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '560px', maxHeight: '80vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { fontSize: '18px', fontWeight: 600, color: 'var(--color-text)', margin: 0 },
  closeBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: '24px', cursor: 'pointer', padding: '4px 8px', lineHeight: 1 },
  detailBody: { display: 'flex', flexDirection: 'column' as const, gap: '8px' },
  detailRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid var(--color-border)' },
  detailLabel: { fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500, flexShrink: 0, width: '100px' },
  detailValue: { fontSize: '13px', color: 'var(--color-text)', fontFamily: 'monospace', textAlign: 'right' as const, flex: 1 },
};
