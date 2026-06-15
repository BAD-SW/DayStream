import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Tabs } from '../design-system/components/navigation/Tabs';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import * as servicesApi from '../api/services';
import type { Service, ServiceVariant, AvailabilityRule } from '../api/services';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success', draft: 'neutral', paused: 'warning', archived: 'error',
};

export function ServiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);

  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!id || !businessId) return;
    setLoading(true);
    servicesApi.getService(id, businessId).then(setService).catch(() => setService(null)).finally(() => setLoading(false));
  }, [id, businessId]);

  if (loading) return <div style={styles.loading}>Loading...</div>;
  if (!service) return <div style={styles.loading}>Service not found</div>;

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/services')}>← Back to Services</button>

      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>{service.name}</h1>
          <span style={styles.slug}>/{service.slug}</span>
        </div>
        <Badge variant={STATUS_VARIANTS[service.status] || 'neutral'}>{service.status}</Badge>
      </div>

      <Tabs items={[
        { id: 'details', label: 'Details', content: <DetailsTab service={service} businessId={businessId} onUpdate={setService} /> },
        { id: 'variants', label: 'Variants', content: <VariantsTab service={service} /> },
        { id: 'images', label: 'Images', content: <ImagesTab service={service} businessId={businessId} /> },
        { id: 'staff', label: 'Staff', content: <StaffTab service={service} /> },
        { id: 'availability', label: 'Availability', content: <AvailabilityTab service={service} /> },
        { id: 'policy', label: 'Policy', content: <PolicyTab service={service} businessId={businessId} /> },
      ]} />
    </div>
  );
}

// --- Tabs ---

function DetailsTab({ service, businessId, onUpdate }: { service: Service; businessId: string; onUpdate: (s: Service) => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: service.name,
    description: service.description || '',
    short_description: service.short_description || '',
    default_duration: service.default_duration,
    buffer_before: service.buffer_before,
    buffer_after: service.buffer_after,
    max_capacity: service.max_capacity,
    online_booking_enabled: service.online_booking_enabled,
  });

  const handleSave = async () => {
    const updated = await servicesApi.updateService(service.id, businessId, form);
    onUpdate(updated);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div style={styles.tabContent}>
        <Button onClick={() => setEditing(true)}>Edit</Button>
        <div style={styles.fieldGrid}>
          <Field label="Duration" value={`${service.default_duration} min`} />
          <Field label="Buffer Before" value={`${service.buffer_before} min`} />
          <Field label="Buffer After" value={`${service.buffer_after} min`} />
          <Field label="Capacity" value={String(service.max_capacity)} />
          <Field label="Booking Type" value={service.booking_type} />
          <Field label="Online Booking" value={service.online_booking_enabled ? 'Yes' : 'No'} />
        </div>
        {service.description && <p style={styles.description}>{service.description}</p>}
      </div>
    );
  }

  return (
    <div style={styles.tabContent}>
      <div style={styles.formGrid}>
        <FormField label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <FormField label="Duration (min)" type="number" value={String(form.default_duration)} onChange={(v) => setForm({ ...form, default_duration: parseInt(v) || 60 })} />
        <FormField label="Buffer Before (min)" type="number" value={String(form.buffer_before)} onChange={(v) => setForm({ ...form, buffer_before: parseInt(v) || 0 })} />
        <FormField label="Buffer After (min)" type="number" value={String(form.buffer_after)} onChange={(v) => setForm({ ...form, buffer_after: parseInt(v) || 0 })} />
        <FormField label="Capacity" type="number" value={String(form.max_capacity)} onChange={(v) => setForm({ ...form, max_capacity: parseInt(v) || 1 })} />
      </div>
      <div style={styles.actions}>
        <Button onClick={() => setEditing(false)}>Cancel</Button>
        <Button onClick={handleSave}>Save</Button>
      </div>
    </div>
  );
}

function VariantsTab({ service }: { service: Service }) {
  const [variants, setVariants] = useState<ServiceVariant[]>(service.variants || []);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', duration: 60, price: 0, pricing_model: 'per_session', billing_interval: 'monthly', included_sessions: '' });

  const handleAdd = async () => {
    const data: any = { name: form.name, duration: form.duration, price: form.price, pricing_model: form.pricing_model };
    if (form.pricing_model === 'subscription') {
      data.billing_interval = form.billing_interval;
      data.included_sessions = form.included_sessions ? parseInt(form.included_sessions) : null;
    }
    const variant = await servicesApi.createVariant(service.id, data);
    setVariants([...variants, variant]);
    setShowAdd(false);
    setForm({ name: '', duration: 60, price: 0, pricing_model: 'per_session', billing_interval: 'monthly', included_sessions: '' });
  };

  const handleDelete = async (variantId: string) => {
    try {
      await servicesApi.deleteVariant(service.id, variantId);
      setVariants(variants.filter((v) => v.id !== variantId));
    } catch { /* silent */ }
  };

  return (
    <div style={styles.tabContent}>
      <Button onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'Cancel' : 'Add Variant'}</Button>
      {showAdd && (
        <div style={styles.addForm}>
          <FormField label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <FormField label="Duration (min)" type="number" value={String(form.duration)} onChange={(v) => setForm({ ...form, duration: parseInt(v) || 60 })} />
          <FormField label="Price (cents)" type="number" value={String(form.price)} onChange={(v) => setForm({ ...form, price: parseInt(v) || 0 })} />
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Pricing Model</label>
            <select value={form.pricing_model} onChange={(e) => setForm({ ...form, pricing_model: e.target.value })} style={styles.input}>
              <option value="per_session">Per Session</option>
              <option value="subscription">Subscription</option>
            </select>
          </div>
          {form.pricing_model === 'subscription' && (
            <>
              <div style={styles.fieldWrapper}>
                <label style={styles.label}>Billing Interval</label>
                <select value={form.billing_interval} onChange={(e) => setForm({ ...form, billing_interval: e.target.value })} style={styles.input}>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annually">Annually</option>
                </select>
              </div>
              <FormField label="Included Sessions (blank = unlimited)" value={form.included_sessions} onChange={(v) => setForm({ ...form, included_sessions: v })} />
            </>
          )}
          <Button onClick={handleAdd}>Save Variant</Button>
        </div>
      )}
      <div style={styles.variantList}>
        {variants.map((v) => (
          <div key={v.id} style={styles.variantCard}>
            <div>
              <strong>{v.name}</strong> — {v.duration} min — €{(v.price / 100).toFixed(2)}
              {v.pricing_model === 'subscription' && <Badge variant="info">Sub: {v.billing_interval}</Badge>}
            </div>
            <button style={styles.deleteBtn} onClick={() => handleDelete(v.id)}>×</button>
          </div>
        ))}
        {variants.length === 0 && <p style={styles.empty}>No variants yet</p>}
      </div>
    </div>
  );
}

function ImagesTab({ service, businessId }: { service: Service; businessId: string }) {
  const [images, setImages] = useState(service.images || []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = await servicesApi.uploadImage(service.id, businessId, file);
    setImages([...images, img]);
  };

  const handleDelete = async (imageId: string) => {
    await servicesApi.deleteImage(service.id, imageId);
    setImages(images.filter((i) => i.id !== imageId));
  };

  return (
    <div style={styles.tabContent}>
      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleUpload} />
      <div style={styles.imageGrid}>
        {images.map((img) => (
          <div key={img.id} style={styles.imageCard}>
            <img src={img.urls?.thumbnail || ''} alt={img.alt_text || ''} style={styles.imageThumbnail} />
            <div style={styles.imageInfo}>
              {img.is_primary && <Badge variant="success">Primary</Badge>}
              <button style={styles.deleteBtn} onClick={() => handleDelete(img.id)}>×</button>
            </div>
          </div>
        ))}
        {images.length === 0 && <p style={styles.empty}>No images uploaded</p>}
      </div>
    </div>
  );
}

function StaffTab({ service }: { service: Service }) {
  const staff = service.staff || [];
  return (
    <div style={styles.tabContent}>
      {staff.length === 0 && <p style={styles.empty}>No staff assigned</p>}
      {staff.map((s) => (
        <div key={s.id} style={styles.staffRow}>
          <span>{s.first_name} {s.last_name}</span>
          {s.is_primary && <Badge variant="success">Primary</Badge>}
        </div>
      ))}
    </div>
  );
}

function AvailabilityTab({ service }: { service: Service }) {
  const rules = service.availability || [];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div style={styles.tabContent}>
      {rules.length === 0 && <p style={styles.empty}>No availability rules defined</p>}
      {rules.map((rule: AvailabilityRule) => (
        <div key={rule.id} style={styles.ruleCard}>
          <Badge variant="neutral">{rule.rule_type}</Badge>
          {rule.rule_type === 'recurring' && (
            <span>{rule.days_of_week?.map((d) => dayNames[d]).join(', ')} {rule.start_time}–{rule.end_time}</span>
          )}
          {rule.rule_type === 'seasonal' && (
            <span>{rule.effective_from} to {rule.effective_to}</span>
          )}
          {rule.rule_type === 'block' && (
            <span>{rule.blocked_dates?.length} date(s) blocked</span>
          )}
          {rule.description && <span style={styles.ruleDesc}>— {rule.description}</span>}
        </div>
      ))}
    </div>
  );
}

function PolicyTab({ service, businessId }: { service: Service; businessId: string }) {
  const [policies, setPolicies] = useState<any[]>([]);

  useEffect(() => {
    servicesApi.getPolicies(businessId).then(setPolicies).catch(() => {});
  }, [businessId]);

  return (
    <div style={styles.tabContent}>
      <p style={styles.label}>Assigned Policy: {(service as any).cancellation_policy_id ? 'Custom' : 'Business Default'}</p>
      <div style={styles.policyList}>
        {policies.map((p) => (
          <div key={p.id} style={styles.policyCard}>
            <strong>{p.name}</strong>
            {p.is_default && <Badge variant="info">Default</Badge>}
            <span>Free cancel: {p.free_cancellation_hours}h | Late: {p.late_cancel_fee_value}% | No-show: {p.noshow_fee_value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Helpers ---

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.fieldWrapper}>
      <span style={styles.label}>{label}</span>
      <span style={styles.fieldValue}>{value}</span>
    </div>
  );
}

function FormField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div style={styles.fieldWrapper}>
      <label style={styles.label}>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={styles.input} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1000px', margin: '0 auto' },
  loading: { padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--color-text-secondary)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { margin: 0, fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)' },
  slug: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  tabContent: { padding: 'var(--space-md) 0' },
  fieldGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--space-md)', marginTop: 'var(--space-md)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' },
  fieldWrapper: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontWeight: 'var(--font-weight-medium)' as any },
  fieldValue: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  input: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  description: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', marginTop: 'var(--space-md)' },
  actions: { display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-md)' },
  addForm: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)', padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginTop: 'var(--space-md)', marginBottom: 'var(--space-md)' },
  variantList: { marginTop: 'var(--space-md)', display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)' },
  variantCard: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-sm) var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)' },
  deleteBtn: { background: 'none', border: 'none', color: 'var(--color-error-light)', cursor: 'pointer', fontSize: '18px', padding: '2px 6px' },
  empty: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', textAlign: 'center', padding: 'var(--space-lg)' },
  imageGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 'var(--space-md)', marginTop: 'var(--space-md)' },
  imageCard: { position: 'relative' as const, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
  imageThumbnail: { width: '100%', height: '80px', objectFit: 'cover' as const },
  imageInfo: { display: 'flex', justifyContent: 'space-between', padding: '4px 6px' },
  staffRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm) 0', borderBottom: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)' },
  ruleCard: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm) 0', borderBottom: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)' },
  ruleDesc: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)' },
  policyList: { marginTop: 'var(--space-md)', display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)' },
  policyCard: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm) var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)' },
};
