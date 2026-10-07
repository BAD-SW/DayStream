import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import * as staffApi from '../api/staff';
import * as clockApi from '../api/clock';
import type { NotificationPreferences } from '../api/staff';
import type { MyPinStatus } from '../api/clock';

export function Profile() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [saving, setSaving] = useState(false);

  // Clock PIN self-service
  const [pinStatus, setPinStatus] = useState<MyPinStatus | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [pinSaving, setPinSaving] = useState(false);
  const [pinMsg, setPinMsg] = useState<string | null>(null);

  useEffect(() => {
    staffApi.getNotificationPreferences().then(setPrefs).catch(() => {}).finally(() => setLoadingPrefs(false));
    clockApi.getMyPinStatus().then(setPinStatus).catch(() => setPinStatus(null));
  }, []);

  const handleSavePin = async () => {
    if (!/^\d{4}$/.test(pinValue)) { setPinMsg('PIN must be exactly 4 digits.'); return; }
    setPinSaving(true);
    setPinMsg(null);
    try {
      await clockApi.setMyPin(pinValue);
      setPinValue('');
      setPinMsg('Clock PIN saved.');
      setPinStatus((s) => (s ? { ...s, hasPin: true } : s));
    } catch {
      setPinMsg('Could not save PIN.');
    } finally { setPinSaving(false); }
  };

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

      {pinStatus?.hasProfile && (
        <>
          <h2 style={{ ...styles.heading, marginTop: '32px' }}>Time Clock PIN</h2>
          <div style={styles.card}>
            <p style={styles.hint}>
              Use your staff number{pinStatus.staffRef ? ` (${pinStatus.staffRef})` : ''} and this 4-digit PIN at the Time Clock.
              {pinStatus.hasPin ? ' A PIN is set — enter a new one to change it.' : ' No PIN is set yet.'}
            </p>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="password"
                inputMode="numeric"
                value={pinValue}
                onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="4 digits"
                style={{ width: '120px', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)' }}
              />
              <button
                onClick={handleSavePin}
                disabled={pinSaving || pinValue.length !== 4}
                style={{ padding: '8px 16px', border: 'none', borderRadius: 'var(--button-radius, 8px)', background: 'var(--color-primary)', color: 'var(--color-primary-contrast, #fff)', cursor: pinValue.length === 4 ? 'pointer' : 'default', opacity: pinValue.length === 4 ? 1 : 0.6, fontFamily: 'var(--font-family)' }}
              >
                {pinStatus.hasPin ? 'Change PIN' : 'Set PIN'}
              </button>
              {pinMsg && <span style={styles.hint}>{pinMsg}</span>}
            </div>
          </div>
        </>
      )}

      <h2 style={{ ...styles.heading, marginTop: '32px' }}>Notification Preferences</h2>
      <div style={styles.card}>
        {loadingPrefs ? (
          <p style={styles.hint}>Loading preferences...</p>
        ) : prefs ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {(Object.keys(prefLabels) as Array<keyof NotificationPreferences>).map((key) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: 'var(--font-size-base)', color: 'var(--color-text)', cursor: 'pointer' }}>
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
  heading: { fontSize: 'var(--font-size-2xl)', fontWeight: 300, margin: '0 0 24px 0', color: 'var(--color-text)' },
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
  label: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  value: { fontSize: 'var(--font-size-base)', color: 'var(--color-text)' },
  hint: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginTop: '16px' },
};
