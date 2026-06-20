import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';

interface Flag {
  key: string;
  enabled: boolean;
  description?: string;
}

export function FeatureFlags() {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.get('/v1/admin/feature-flags')
      .then((res) => {
        const data = res.data.data;
        // Data comes as object { key: boolean } or array
        if (Array.isArray(data)) {
          setFlags(data);
        } else if (typeof data === 'object') {
          setFlags(Object.entries(data).map(([key, enabled]) => ({ key, enabled: Boolean(enabled) })));
        }
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

  if (loading) return <div style={{ color: 'var(--color-text)' }}>Loading...</div>;

  return (
    <div>
      <h2 style={styles.heading}>Feature Flags</h2>
      <p style={styles.subtext}>Enable or disable platform features globally.</p>

      {flags.length === 0 ? (
        <p style={styles.empty}>No feature flags configured.</p>
      ) : (
        <div style={styles.list}>
          {flags.map((flag) => (
            <div key={flag.key} style={styles.flagRow}>
              <div style={styles.flagInfo}>
                <span style={styles.flagKey}>{flag.key}</span>
                {flag.description && <span style={styles.flagDesc}>{flag.description}</span>}
              </div>
              <label style={styles.toggle}>
                <input
                  type="checkbox"
                  checked={flag.enabled}
                  onChange={() => toggleFlag(flag.key, flag.enabled)}
                  style={styles.checkbox}
                />
                <span style={{ ...styles.toggleLabel, color: flag.enabled ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>
                  {flag.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: '24px', fontWeight: 300, margin: '0 0 8px 0', color: 'var(--color-text)' },
  subtext: { color: 'var(--color-text-secondary)', fontSize: '14px', marginBottom: '24px' },
  empty: { color: 'var(--color-text-secondary)', fontSize: '14px' },
  list: { border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' },
  flagRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', borderBottom: '1px solid var(--color-border)' },
  flagInfo: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  flagKey: { fontSize: '14px', fontWeight: 500, color: 'var(--color-text)', fontFamily: 'monospace' },
  flagDesc: { fontSize: '12px', color: 'var(--color-text-secondary)' },
  toggle: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' },
  checkbox: { width: '18px', height: '18px', cursor: 'pointer' },
  toggleLabel: { fontSize: '13px', fontWeight: 500 },
};
