import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import * as staffApi from '../api/staff';
import type { NotificationPreferences } from '../api/staff';

export function Profile() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    staffApi.getNotificationPreferences().then(setPrefs).catch(() => {}).finally(() => setLoadingPrefs(false));
  }, []);

  const handleToggle = async (key: keyof NotificationPreferences) => {
    if (!prefs) return;
    const previousPrefs = { ...prefs };
    const newPrefs = { ...prefs, [key]: !prefs[key] };
    setPrefs(newPrefs); // Optimistic update
    setSaving(true);
    try {
      const updated = await staffApi.updateNotificationPreferences({ [key]: newPrefs[key] });
      setPrefs(updated);
    } catch {
      setPrefs(previousPrefs); // Revert on failure
      alert('Unable to save preference. You may not have a staff profile linked to your account.');
    }
    setSaving(false);
  };

  const prefLabels: Record<keyof NotificationPreferences, string> = {
    booking_confirmed: 'Booking confirmed',
    booking_cancelled: 'Booking cancelled',
    booking_reminder: 'Booking reminder',
    schedule_changed: 'Schedule changed',
    leave_approved: 'Leave approved',
    leave_rejected: 'Leave rejected',
    new_review: 'New review received',
    payroll_ready: 'Payroll ready',
  };

  return (
    <div>
      <h2 style={styles.heading}>Profile</h2>
      <div style={styles.card}>
        <div style={styles.field}>
          <span style={styles.label}>Name</span>
          <span style={styles.value}>{user?.first_name} {user?.last_name}</span>
        </div>
        <div style={styles.field}>
          <span style={styles.label}>Email</span>
          <span style={styles.value}>{user?.email}</span>
        </div>
        <div style={styles.field}>
          <span style={styles.label}>Role</span>
          <span style={styles.value}>{user?.role}</span>
        </div>
      </div>

      <h2 style={{ ...styles.heading, marginTop: '32px' }}>Notification Preferences</h2>
      <div style={styles.card}>
        {loadingPrefs ? (
          <p style={styles.hint}>Loading preferences...</p>
        ) : prefs ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {(Object.keys(prefLabels) as Array<keyof NotificationPreferences>).map((key) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: 'var(--color-text)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={prefs[key]}
                  disabled={saving}
                  onChange={() => handleToggle(key)}
                  style={{ width: '16px', height: '16px' }}
                />
                {prefLabels[key]}
              </label>
            ))}
          </div>
        ) : (
          <p style={styles.hint}>Unable to load notification preferences.</p>
        )}
      </div>

    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  heading: { fontSize: '24px', fontWeight: 300, margin: '0 0 24px 0', color: 'var(--color-text)' },
  card: {
    backgroundColor: 'var(--color-surface)',
    borderRadius: '8px',
    border: '1px solid var(--color-border)',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: '12px', color: '#8A8A8A', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  value: { fontSize: '14px', color: 'var(--color-text)' },
  hint: { fontSize: '13px', color: '#8A8A8A', marginTop: '16px' },
};
