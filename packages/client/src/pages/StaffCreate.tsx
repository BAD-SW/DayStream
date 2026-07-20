import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Alert } from '../design-system/components/feedback/Alert';
import * as staffApi from '../api/staff';

export function StaffCreate() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    mobile_phone: '',
    employment_type: 'full_time',
    role: 'business_staff',
    hire_date: '',
    bio: '',
    languages: '',
    show_on_directory: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.first_name || !form.last_name) {
      setError('First and last name are required');
      return;
    }
    if (!form.email) {
      setError('Email is required');
      return;
    }
    if (!form.password || form.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const businessId = localStorage.getItem('business_id') || '';
      const staff = await staffApi.createStaff({ ...form, business_id: businessId });
      navigate(`/staff/${staff.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create staff');
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/business?tab=staff')}>← Back to Business Setup</button>
      <h1 style={styles.title}>Add Staff Member</h1>

      {error && <Alert variant="error">{error}</Alert>}

      <form onSubmit={handleSubmit} autoComplete="off">
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Personal Information</h3>
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>First Name *</label>
              <input style={styles.input} value={form.first_name} autoComplete="off"
                onChange={(e) => updateField('first_name', e.target.value)} />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Last Name *</label>
              <input style={styles.input} value={form.last_name} autoComplete="off"
                onChange={(e) => updateField('last_name', e.target.value)} />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Email *</label>
              <input type="email" style={styles.input} value={form.email} autoComplete="new-email"
                onChange={(e) => updateField('email', e.target.value)} />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Mobile Phone</label>
              <input style={styles.input} value={form.mobile_phone} autoComplete="off"
                onChange={(e) => updateField('mobile_phone', e.target.value)} placeholder="Optional" />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Languages</label>
              <input style={styles.input} value={form.languages} autoComplete="off"
                onChange={(e) => updateField('languages', e.target.value)} placeholder="e.g., English, Spanish" />
            </div>
          </div>
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Account & Role</h3>
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Password *</label>
              <input type="password" style={styles.input} value={form.password} autoComplete="new-password"
                onChange={(e) => updateField('password', e.target.value)} placeholder="Min 8 characters" />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Role</label>
              <select style={styles.input} value={form.role}
                onChange={(e) => updateField('role', e.target.value)}>
                <option value="business_staff">Staff</option>
                <option value="business_manager">Manager</option>
                <option value="business_owner">Owner</option>
              </select>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Employment Type</label>
              <select style={styles.input} value={form.employment_type}
                onChange={(e) => updateField('employment_type', e.target.value)}>
                <option value="full_time">Full-time</option>
                <option value="part_time">Part-time</option>
                <option value="contractor">Contractor</option>
              </select>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Hire Date</label>
              <input type="date" style={styles.input} value={form.hire_date}
                onChange={(e) => updateField('hire_date', e.target.value)} />
              <span style={styles.helper}>Optional</span>
            </div>
          </div>
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Public Profile</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Bio</label>
              <textarea style={{ ...styles.input, minHeight: '100px', resize: 'vertical' }} value={form.bio}
                onChange={(e) => updateField('bio', e.target.value)} placeholder="Public-facing bio shown to customers..." />
            </div>
            <div style={styles.formGroup}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.show_on_directory}
                  onChange={(e) => updateField('show_on_directory', e.target.checked)} style={{ width: '16px', height: '16px' }} />
                Show on public directory
              </label>
            </div>
          </div>
        </div>

        <div style={styles.actions}>
          <Button variant="secondary" type="button" onClick={() => navigate('/business?tab=staff')}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Staff Member'}</Button>
        </div>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '800px', margin: '0 auto' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-lg)', marginTop: 'var(--space-sm)' },
  card: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)', marginBottom: 'var(--space-md)' },
  cardTitle: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-text)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text-secondary)' },
  input: { background: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', width: '100%', boxSizing: 'border-box' as const },
  helper: { fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' },
  actions: { display: 'flex', gap: 'var(--space-md)', justifyContent: 'flex-end', marginTop: 'var(--space-lg)' },
};
