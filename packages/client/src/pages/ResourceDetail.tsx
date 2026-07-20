import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { Alert } from '../design-system/components/feedback/Alert';
import * as resourcesApi from '../api/resources';
import type { Resource } from '../api/resources';

type Tab = 'details' | 'schedule' | 'maintenance';

export function ResourceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const businessId = localStorage.getItem('business_id') || '';
  const [resource, setResource] = useState<Resource | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('details');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    resourcesApi.getResource(id, businessId).then(setResource).catch(() => navigate('/business?tab=resources')).finally(() => setLoading(false));
  }, [id, navigate, businessId]);

  if (loading) return <div style={styles.loading}>Loading...</div>;
  if (!resource) return <div style={styles.loading}>Resource not found</div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'details', label: 'Details' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'maintenance', label: 'Maintenance' },
  ];

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/business?tab=resources')}>← Back to Business Setup</button>
      <div style={styles.headerRow}>
        <div>
          <h1 style={styles.title}>{resource.name}</h1>
          <span style={styles.subtitle}>{resource.category ? resource.category.charAt(0).toUpperCase() + resource.category.slice(1) : ''}{resource.type_name ? ` · ${resource.type_name}` : ''}</span>
        </div>
        <Badge variant={resource.status === 'active' ? 'success' : resource.status === 'maintenance' ? 'warning' : 'neutral'}>{resource.status}</Badge>
      </div>

      <div style={styles.tabBar}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              style={{
                background: 'none', border: 'none', outline: 'none',
                borderBottom: isActive ? '3px solid var(--color-primary)' : '3px solid transparent',
                padding: '10px 16px', fontSize: 'var(--font-size-sm)',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                cursor: 'pointer', fontFamily: 'var(--font-family)', marginBottom: '-1px',
              }}>
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'details' && <DetailsTab resource={resource} businessId={businessId} onUpdate={setResource} />}
      {activeTab === 'schedule' && <ScheduleTab resourceId={resource.id} />}
      {activeTab === 'maintenance' && <MaintenanceTab resourceId={resource.id} />}
    </div>
  );
}

// --- Details Tab (Editable) ---

function DetailsTab({ resource, businessId, onUpdate }: { resource: Resource; businessId: string; onUpdate: (r: Resource) => void }) {
  const [form, setForm] = useState({
    name: resource.name,
    description: resource.description || '',
    category: resource.category || '',
    capacity: resource.capacity,
    buffer_minutes: resource.buffer_minutes,
    is_24_7: resource.is_24_7,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isDirty = form.name !== resource.name || form.description !== (resource.description || '') ||
    form.category !== (resource.category || '') || form.capacity !== resource.capacity ||
    form.buffer_minutes !== resource.buffer_minutes || form.is_24_7 !== resource.is_24_7;

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const updated = await resourcesApi.updateResource(resource.id, form, businessId);
      onUpdate(updated);
    } catch (err: any) { setError(err.response?.data?.error || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const handleDiscard = () => {
    setForm({
      name: resource.name, description: resource.description || '',
      category: resource.category || '', capacity: resource.capacity,
      buffer_minutes: resource.buffer_minutes, is_24_7: resource.is_24_7,
    });
  };

  const handleDeactivate = async () => {
    if (!confirm('Deactivate this resource? It will no longer be available for booking.')) return;
    try {
      const updated = await resourcesApi.deactivateResource(resource.id, businessId);
      onUpdate(updated);
    } catch { /* silent */ }
  };

  return (
    <>
      {error && <Alert variant="error">{error}</Alert>}
      {isDirty && (
        <div style={styles.saveBar}>
          <span style={{ fontSize: '13px', color: 'var(--color-text)' }}>You have unsaved changes</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="outline" size="sm" onClick={handleDiscard}>Discard</Button>
            <Button size="sm" onClick={handleSave} loading={saving}>Save Changes</Button>
          </div>
        </div>
      )}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Resource Information</h3>
        <div style={styles.formGrid}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Name *</label>
            <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Category</label>
            <select style={styles.input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">— Select —</option>
              <option value="room">Room</option>
              <option value="equipment">Equipment</option>
              <option value="facility">Facility</option>
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Capacity</label>
            <input style={styles.input} type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
            <span style={styles.helper}>{form.capacity > 1 ? 'Concurrent users allowed' : 'Exclusive (one booking at a time)'}</span>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Buffer (minutes)</label>
            <input style={styles.input} type="number" min={0} value={form.buffer_minutes} onChange={(e) => setForm({ ...form, buffer_minutes: Number(e.target.value) })} />
            <span style={styles.helper}>Time between bookings for cleanup/prep</span>
          </div>
          <div style={styles.formGroup}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer', paddingTop: '20px' }}>
              <input type="checkbox" checked={form.is_24_7} onChange={(e) => setForm({ ...form, is_24_7: e.target.checked })} style={{ width: '16px', height: '16px' }} />
              Available 24/7 (no schedule restrictions)
            </label>
          </div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
            <label style={styles.label}>Description</label>
            <textarea style={{ ...styles.input, minHeight: '80px', resize: 'vertical' }} value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional description..." />
          </div>
        </div>
      </div>

      {resource.status === 'active' && (
        <div style={{ marginTop: 'var(--space-lg)' }}>
          <Button variant="destructive" onClick={handleDeactivate}>Deactivate Resource</Button>
        </div>
      )}
    </>
  );
}

// --- Schedule Tab ---

function ScheduleTab({ resourceId }: { resourceId: string }) {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    resourcesApi.getSchedules(resourceId).then(setSchedules).finally(() => setLoading(false));
  }, [resourceId]);

  if (loading) return <div style={styles.loading}>Loading...</div>;

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>Operating Hours</h3>
      {schedules.length === 0 ? (
        <p style={styles.emptyText}>No schedules defined. If the resource is marked 24/7, it's always available. Otherwise, add a schedule to define operating hours.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {schedules.map((s: any) => (
            <div key={s.id} style={styles.listItem}>
              <div style={{ flex: 1 }}>
                <strong style={{ color: 'var(--color-text)' }}>{s.name}</strong>
                <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                  {s.effective_from ? new Date(s.effective_from).toLocaleDateString() : ''} → {s.effective_to ? new Date(s.effective_to).toLocaleDateString() : 'Ongoing'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Maintenance Tab ---

function MaintenanceTab({ resourceId }: { resourceId: string }) {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ maintenance_type: 'weekly', day_of_week: '1', start_time: '06:00', end_time: '07:00', description: '' });

  const fetchMaintenance = useCallback(async () => {
    setLoading(true);
    resourcesApi.getMaintenance(resourceId).then(setRecords).finally(() => setLoading(false));
  }, [resourceId]);

  useEffect(() => { fetchMaintenance(); }, [fetchMaintenance]);

  const handleCreate = async () => {
    await resourcesApi.createMaintenance(resourceId, {
      maintenance_type: form.maintenance_type,
      day_of_week: form.maintenance_type === 'weekly' ? Number(form.day_of_week) : undefined,
      start_time: form.start_time,
      end_time: form.end_time,
      description: form.description || undefined,
    });
    setShowForm(false);
    setForm({ maintenance_type: 'weekly', day_of_week: '1', start_time: '06:00', end_time: '07:00', description: '' });
    fetchMaintenance();
  };

  const handleDelete = async (maintenanceId: string) => {
    if (!confirm('Remove this maintenance window?')) return;
    await resourcesApi.deleteMaintenance(resourceId, maintenanceId);
    fetchMaintenance();
  };

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (loading) return <div style={styles.loading}>Loading...</div>;

  return (
    <>
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ ...styles.cardTitle, margin: 0 }}>Maintenance Windows</h3>
          <Button variant="secondary" size="sm" onClick={() => setShowForm(true)}>Add Maintenance</Button>
        </div>

        {showForm && (
          <div style={{ ...styles.card, background: 'var(--color-background)', marginBottom: 'var(--space-md)' }}>
            <div style={styles.formGrid}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Type</label>
                <select style={styles.input} value={form.maintenance_type} onChange={(e) => setForm({ ...form, maintenance_type: e.target.value })}>
                  <option value="weekly">Weekly</option>
                  <option value="daily">Daily</option>
                </select>
              </div>
              {form.maintenance_type === 'weekly' && (
                <div style={styles.formGroup}>
                  <label style={styles.label}>Day of Week</label>
                  <select style={styles.input} value={form.day_of_week} onChange={(e) => setForm({ ...form, day_of_week: e.target.value })}>
                    {dayLabels.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}
                  </select>
                </div>
              )}
              <div style={styles.formGroup}>
                <label style={styles.label}>Start Time</label>
                <input type="time" style={styles.input} value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>End Time</label>
                <input type="time" style={styles.input} value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
              </div>
              <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
                <label style={styles.label}>Description</label>
                <input style={styles.input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g., Weekly deep clean" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: 'var(--space-md)' }}>
              <Button size="sm" onClick={handleCreate}>Add</Button>
              <Button variant="secondary" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {records.length === 0 && !showForm && <p style={styles.emptyText}>No maintenance windows scheduled. Add recurring maintenance to block booking time for cleaning or upkeep.</p>}
        {records.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {records.map((r: any) => (
              <div key={r.id} style={styles.listItem}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Badge variant="neutral">{r.maintenance_type === 'weekly' ? dayLabels[r.day_of_week] : 'Daily'}</Badge>
                  <span style={{ fontSize: '13px', color: 'var(--color-text)' }}>{formatTime(r.start_time)}–{formatTime(r.end_time)}</span>
                  {r.description && <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>— {r.description}</span>}
                </div>
                <button style={styles.iconBtn} onClick={() => handleDelete(r.id)} title="Remove">🗑️</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/** Format a time string (HH:mm or HH:mm:ss) to locale format */
function formatTime(time: string): string {
  const [h, m] = time.split(':');
  const date = new Date();
  date.setHours(parseInt(h), parseInt(m), 0);
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// --- Styles ---

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '900px', margin: '0 auto' },
  loading: { padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--color-text-secondary)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { margin: 0, fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)' },
  subtitle: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginTop: '4px' },
  tabBar: { display: 'flex', gap: '0', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--space-lg)' },
  card: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)', marginBottom: 'var(--space-md)' },
  cardTitle: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-text)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text-secondary)' },
  input: { background: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', width: '100%', boxSizing: 'border-box' as const },
  helper: { fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' },
  saveBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-sm) var(--space-md)', background: 'var(--color-surface)', border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-md)' },
  listItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)' },
  emptyText: { color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', margin: 0 },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '4px' },
};
