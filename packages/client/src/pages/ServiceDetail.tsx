import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { MultiSelect } from '../design-system/components/forms/MultiSelect';
import * as servicesApi from '../api/services';
import type { Service, ServiceVariant, ServiceCategory, AvailabilityRule } from '../api/services';
import { formatCurrency } from '../utils/currency';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success', draft: 'neutral', paused: 'warning', archived: 'error',
};

export function ServiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [taxCategories, setTaxCategories] = useState<any[]>([]);

  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!id || !businessId) return;
    setLoading(true);
    Promise.all([
      servicesApi.getService(id, businessId),
      servicesApi.getCategories(businessId),
      servicesApi.getTaxCategories(businessId),
    ]).then(([svc, cats, tax]) => {
      setService(svc);
      setCategories(cats);
      setTaxCategories(tax);
    }).catch(() => setService(null)).finally(() => setLoading(false));
  }, [id, businessId]);

  if (loading) return <div style={styles.loading}>Loading...</div>;
  if (!service) return <div style={styles.loading}>Service not found</div>;

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/offers?tab=services')}>← Back to Offerings</button>

      {/* Header Card */}
      <div style={styles.headerCard}>
        <div style={styles.headerInfo}>
          <h1 style={styles.name}>{service.name}</h1>
          <span style={styles.slug}>/{service.slug}</span>
          {service.category_name && <span style={styles.categoryLabel}>{service.category_name}</span>}
        </div>
        <div style={styles.headerRight}>
          <Badge variant={STATUS_VARIANTS[service.status] || 'neutral'}>{service.status}</Badge>
          <span style={styles.duration}>{service.default_duration} min</span>
        </div>
      </div>

      {/* Content */}
      <ServiceForm service={service} categories={categories} taxCategories={taxCategories} businessId={businessId} onUpdate={setService} />
      <VariantsCard service={service} onUpdate={setService} />
      <ImagesCard service={service} businessId={businessId} />
      <AvailabilityCard service={service} businessId={businessId} />
    </div>
  );
}

// --- Service Form (always editable with save bar) ---

function ServiceForm({ service, categories, taxCategories, businessId, onUpdate }: { service: Service; categories: ServiceCategory[]; taxCategories: any[]; businessId: string; onUpdate: (s: Service) => void }) {
  const [saving, setSaving] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [form, setForm] = useState({
    name: service.name,
    category_id: service.category_id || '',
    description: service.description || '',
    short_description: service.short_description || '',
    booking_type: service.booking_type,
    default_duration: service.default_duration,
    buffer_before: service.buffer_before,
    buffer_after: service.buffer_after,
    max_capacity: service.max_capacity,
    online_booking_enabled: service.online_booking_enabled,
    requires_dedicated_staff: service.requires_dedicated_staff !== false,
    is_taxable: (service as any).is_taxable || false,
    tax_category_id: (service as any).tax_category_id || '',
  });

  const isDirty = form.name !== service.name ||
    form.category_id !== (service.category_id || '') ||
    form.description !== (service.description || '') ||
    form.short_description !== (service.short_description || '') ||
    form.booking_type !== service.booking_type ||
    form.default_duration !== service.default_duration ||
    form.buffer_before !== service.buffer_before ||
    form.buffer_after !== service.buffer_after ||
    form.max_capacity !== service.max_capacity ||
    form.online_booking_enabled !== service.online_booking_enabled ||
    form.requires_dedicated_staff !== (service.requires_dedicated_staff !== false) ||
    form.is_taxable !== ((service as any).is_taxable || false) ||
    form.tax_category_id !== ((service as any).tax_category_id || '');

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await servicesApi.updateService(service.id, businessId, form);
      onUpdate(updated);
    } catch { alert('Failed to save changes'); }
    finally { setSaving(false); }
  };

  const handleDiscard = () => {
    setForm({
      name: service.name,
      category_id: service.category_id || '',
      description: service.description || '',
      short_description: service.short_description || '',
      booking_type: service.booking_type,
      default_duration: service.default_duration,
      buffer_before: service.buffer_before,
      buffer_after: service.buffer_after,
      max_capacity: service.max_capacity,
      online_booking_enabled: service.online_booking_enabled,
      is_taxable: (service as any).is_taxable || false,
      tax_category_id: (service as any).tax_category_id || '',
    });
  };

  const handleStatusAction = async (action: string) => {
    setStatusChanging(true);
    try {
      if (action === 'activate') await servicesApi.activateService(service.id, businessId);
      else if (action === 'pause') await servicesApi.pauseService(service.id, businessId);
      else if (action === 'archive') await servicesApi.archiveService(service.id, businessId);
      else if (action === 'restore') await servicesApi.restoreService(service.id, businessId);
      const updated = await servicesApi.getService(service.id, businessId);
      onUpdate(updated);
    } catch { alert(`Failed to ${action}`); }
    finally { setStatusChanging(false); }
  };

  return (
    <>
      {/* Actions bar */}
      <div style={styles.actionsBar}>
        <div style={{ display: 'flex', gap: '8px' }}>
          {service.status === 'draft' && <Button variant="secondary" size="sm" onClick={() => handleStatusAction('activate')} loading={statusChanging}>Activate</Button>}
          {service.status === 'active' && <Button variant="secondary" size="sm" onClick={() => handleStatusAction('pause')} loading={statusChanging}>Pause</Button>}
          {service.status === 'paused' && <Button variant="secondary" size="sm" onClick={() => handleStatusAction('activate')} loading={statusChanging}>Activate</Button>}
          {service.status !== 'archived' && <Button variant="destructive" size="sm" onClick={() => handleStatusAction('archive')} loading={statusChanging}>Archive</Button>}
          {service.status === 'archived' && <Button variant="secondary" size="sm" onClick={() => handleStatusAction('restore')} loading={statusChanging}>Restore</Button>}
        </div>
      </div>

      {/* Save bar */}
      {isDirty && (
        <div style={styles.saveBar}>
          <span style={{ fontSize: '13px', color: 'var(--color-text)' }}>You have unsaved changes</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="outline" size="sm" onClick={handleDiscard}>Discard</Button>
            <Button size="sm" onClick={handleSave} loading={saving}>Save Changes</Button>
          </div>
        </div>
      )}

      {/* Service Details Card */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ ...styles.cardTitle, margin: 0 }}>Service Details</h3>
          <Button size="sm" variant="secondary" onClick={() => { /* TODO: trigger translation */ }}>Translate</Button>
        </div>
        <div style={styles.formGrid}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Name *</label>
            <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Category</label>
            <select style={styles.input} value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">None</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Booking Type</label>
            <select style={styles.input} value={form.booking_type} onChange={(e) => setForm({ ...form, booking_type: e.target.value })}>
              <option value="individual">Individual</option>
              <option value="shared">Shared</option>
              <option value="group">Group</option>
              <option value="resource">Resource</option>
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Duration (min)</label>
            <input style={styles.input} type="number" min={5} value={form.default_duration} onChange={(e) => setForm({ ...form, default_duration: Number(e.target.value) })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Buffer Before (min)</label>
            <input style={styles.input} type="number" min={0} value={form.buffer_before} onChange={(e) => setForm({ ...form, buffer_before: Number(e.target.value) })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Buffer After (min)</label>
            <input style={styles.input} type="number" min={0} value={form.buffer_after} onChange={(e) => setForm({ ...form, buffer_after: Number(e.target.value) })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Max Capacity</label>
            <input style={styles.input} type="number" min={1} value={form.max_capacity} onChange={(e) => setForm({ ...form, max_capacity: Number(e.target.value) })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>&nbsp;</label>
            <div style={{ display: 'flex', gap: '24px', paddingTop: '4px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.online_booking_enabled} onChange={(e) => setForm({ ...form, online_booking_enabled: e.target.checked })} style={{ width: '16px', height: '16px' }} />
                Online Booking
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.requires_dedicated_staff} onChange={(e) => setForm({ ...form, requires_dedicated_staff: e.target.checked })} style={{ width: '16px', height: '16px' }} />
                Requires Dedicated Staff
              </label>
            </div>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Tax Category</label>
            <select style={styles.input} value={form.tax_category_id} onChange={(e) => setForm({ ...form, tax_category_id: e.target.value })}>
              <option value="">No tax</option>
              {taxCategories.map((tc: any) => <option key={tc.id} value={tc.id}>{tc.name} ({(tc.rate / 100).toFixed(2)}%)</option>)}
            </select>
          </div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
            <label style={styles.label}>Short Description</label>
            <input style={styles.input} value={form.short_description} onChange={(e) => setForm({ ...form, short_description: e.target.value })} />
          </div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
            <label style={styles.label}>Description</label>
            <textarea style={{ ...styles.input, minHeight: '80px', resize: 'vertical', maxWidth: '100%' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        </div>
      </div>
    </>
  );
}

// --- Variants Card (with modal add/edit) ---

function VariantsCard({ service }: { service: Service; onUpdate: (s: Service) => void }) {
  const [variants, setVariants] = useState<ServiceVariant[]>(service.variants || []);
  const [showModal, setShowModal] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ServiceVariant | undefined>(undefined);

  const handleDelete = async (variantId: string) => {
    if (!confirm('Delete this variant?')) return;
    try {
      await servicesApi.deleteVariant(service.id, variantId);
      setVariants(variants.filter((v) => v.id !== variantId));
    } catch { /* silent */ }
  };

  const handleSaved = async () => {
    setShowModal(false);
    setEditingVariant(undefined);
    const updated = await servicesApi.getVariants(service.id);
    setVariants(updated);
  };

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Variants</h3>
        <Button size="sm" variant="secondary" onClick={() => { setEditingVariant(undefined); setShowModal(true); }}>Add Variant</Button>
      </div>

      {variants.length === 0 && <p style={styles.muted}>No variants yet. Add at least one variant to activate this service.</p>}
      {variants.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {variants.map((v) => (
            <div key={v.id} style={styles.variantRow}>
              <div style={{ flex: 1 }}>
                <strong>{v.name}</strong> — {v.duration} min — {formatCurrency(v.price)}
                {v.pricing_model === 'subscription' && <Badge variant="info">{`Sub: ${v.billing_interval || 'monthly'}`}</Badge>}
              </div>
              <Badge variant={STATUS_VARIANTS[v.status] || 'neutral'}>{v.status}</Badge>
              <button style={styles.editBtn} onClick={() => { setEditingVariant(v); setShowModal(true); }} title="Edit">✏️</button>
              <button style={styles.deleteBtn} onClick={() => handleDelete(v.id)} title="Delete">×</button>
            </div>
          ))}
        </div>
      )}

      {/* Variant Modal */}
      {showModal && (
        <ServiceVariantModal
          serviceId={service.id}
          variant={editingVariant}
          onClose={() => { setShowModal(false); setEditingVariant(undefined); }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

function ServiceVariantModal({ serviceId, variant, onClose, onSaved }: { serviceId: string; variant?: ServiceVariant; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: variant?.name || '',
    duration: variant?.duration || 60,
    price: variant?.price || 0,
    pricing_model: variant?.pricing_model || 'per_session',
    billing_interval: variant?.billing_interval || 'monthly',
    included_sessions: variant?.included_sessions ? String(variant.included_sessions) : '',
  });
  const [priceDisplay, setPriceDisplay] = useState(variant ? (variant.price / 100).toFixed(2) : '0.00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const data: any = { name: form.name, duration: form.duration, price: form.price, pricing_model: form.pricing_model };
      if (form.pricing_model === 'subscription') {
        data.billing_interval = form.billing_interval;
        data.included_sessions = form.included_sessions ? parseInt(form.included_sessions) : null;
      }
      if (variant) {
        await servicesApi.updateVariant(serviceId, variant.id, data);
      } else {
        await servicesApi.createVariant(serviceId, data);
      }
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save variant');
    } finally { setSaving(false); }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>{variant ? 'Edit Variant' : 'Add Variant'}</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        {error && <p style={{ color: 'var(--color-error)', fontSize: '13px', margin: '0 0 8px 0' }}>{error}</p>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Name *</label>
            <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Duration (min) *</label>
            <input style={styles.input} type="number" min={5} value={form.duration} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Price *</label>
            <input style={styles.input} type="number" step="0.01" min="0" value={priceDisplay}
              onChange={(e) => setPriceDisplay(e.target.value)}
              onBlur={() => { const cents = Math.round(parseFloat(priceDisplay || '0') * 100); setForm({ ...form, price: cents }); setPriceDisplay((cents / 100).toFixed(2)); }}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Pricing Model</label>
            <select style={styles.input} value={form.pricing_model} onChange={(e) => setForm({ ...form, pricing_model: e.target.value })}>
              <option value="per_session">Per Session</option>
              <option value="subscription">Subscription</option>
            </select>
          </div>
          {form.pricing_model === 'subscription' && (
            <>
              <div style={styles.formGroup}>
                <label style={styles.label}>Billing Interval</label>
                <select style={styles.input} value={form.billing_interval} onChange={(e) => setForm({ ...form, billing_interval: e.target.value })}>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annually">Annually</option>
                </select>
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Included Sessions (blank = unlimited)</label>
                <input style={styles.input} value={form.included_sessions} onChange={(e) => setForm({ ...form, included_sessions: e.target.value })} />
              </div>
            </>
          )}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={saving}>{variant ? 'Save Changes' : 'Add Variant'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Images Card ---

function ImagesCard({ service, businessId }: { service: Service; businessId: string }) {
  const [images, setImages] = useState(service.images || []);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const img = await servicesApi.uploadImage(service.id, businessId, file);
      setImages([...images, img]);
    } catch { alert('Failed to upload image'); }
    finally { setUploading(false); }
  };

  const handleDelete = async (imageId: string) => {
    if (!confirm('Delete this image?')) return;
    await servicesApi.deleteImage(service.id, imageId);
    setImages(images.filter((i) => i.id !== imageId));
  };

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Images</h3>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '13px', cursor: 'pointer', color: 'var(--color-text)' }}>
          {uploading ? 'Uploading...' : 'Upload Image'}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleUpload} style={{ display: 'none' }} disabled={uploading} />
        </label>
      </div>
      {images.length === 0 && <p style={styles.muted}>No images uploaded</p>}
      {images.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 'var(--space-md)' }}>
          {images.map((img) => (
            <div key={img.id} style={{ position: 'relative', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              <img src={img.urls?.thumbnail || ''} alt={img.alt_text || ''} style={{ width: '100%', height: '80px', objectFit: 'cover' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px' }}>
                {img.is_primary && <Badge variant="success">Primary</Badge>}
                <button style={styles.deleteBtn} onClick={() => handleDelete(img.id)}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', margin: '8px 0 0' }}>Accepted: JPEG, PNG, or WebP. Max 5MB. Min 400×300px.</p>
    </div>
  );
}

// --- Availability Card ---

function AvailabilityCard({ service }: { service: Service; businessId: string }) {
  const [rules, setRules] = useState<AvailabilityRule[]>(service.availability || []);
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<AvailabilityRule | undefined>(undefined);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const handleDelete = async (ruleId: string) => {
    if (!confirm('Delete this availability rule?')) return;
    try {
      await servicesApi.deleteAvailabilityRule(service.id, ruleId);
      setRules(rules.filter((r) => r.id !== ruleId));
    } catch { alert('Failed to delete rule'); }
  };

  const handleSaved = async () => {
    setShowModal(false);
    setEditingRule(undefined);
    const updated = await servicesApi.getAvailability(service.id);
    setRules(updated);
  };

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Availability</h3>
        <Button size="sm" variant="secondary" onClick={() => { setEditingRule(undefined); setShowModal(true); }}>Add Rule</Button>
      </div>
      {rules.length === 0 && <p style={styles.muted}>No availability rules. Service is available anytime.</p>}
      {rules.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {rules.map((rule) => (
            <div key={rule.id} style={styles.variantRow}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <Badge variant="neutral">{rule.rule_type}</Badge>
                {rule.rule_type === 'recurring' && <span>{[...(rule.days_of_week || [])].sort((a, b) => a - b).map((d) => dayNames[d]).join(', ')} {rule.start_time}–{rule.end_time}</span>}
                {rule.rule_type === 'seasonal' && <span>{rule.effective_from} to {rule.effective_to} {rule.start_time}–{rule.end_time}</span>}
                {rule.description && <span style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>— {rule.description}</span>}
              </div>
              <button style={styles.editBtn} onClick={() => { setEditingRule(rule); setShowModal(true); }} title="Edit">✏️</button>
              <button style={styles.deleteBtn} onClick={() => handleDelete(rule.id)} title="Delete">×</button>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <AvailabilityModal
          serviceId={service.id}
          rule={editingRule}
          onClose={() => { setShowModal(false); setEditingRule(undefined); }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

function AvailabilityModal({ serviceId, rule, onClose, onSaved }: { serviceId: string; rule?: AvailabilityRule; onClose: () => void; onSaved: () => void }) {
  const businessId = localStorage.getItem('business_id') || '';
  const [form, setForm] = useState({
    rule_type: rule?.rule_type || 'recurring',
    days_of_week: rule?.days_of_week || [] as number[],
    start_time: rule?.start_time || '09:00',
    end_time: rule?.end_time || '17:00',
    effective_from: rule?.effective_from ? rule.effective_from.split('T')[0] : '',
    effective_to: rule?.effective_to ? rule.effective_to.split('T')[0] : '',
    description: rule?.description || '',
    location_ids: (rule as any)?.location_ids || [] as string[],
    staff_ids: (rule as any)?.staff_ids || [] as string[],
    resource_ids: (rule as any)?.resource_ids || [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [allLocations, setAllLocations] = useState<any[]>([]);
  const [allStaff, setAllStaff] = useState<any[]>([]);
  const [allResources, setAllResources] = useState<any[]>([]);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  useEffect(() => {
    import('../api/locations').then((locApi) => { locApi.getLocations(businessId).then(setAllLocations).catch(() => {}); });
    import('../api/staff').then((staffApi) => { staffApi.getStaffList({ business_id: businessId, status: 'active' }).then((res) => setAllStaff(res.data)).catch(() => {}); });
    import('../api/resources').then((resApi) => { resApi.getResources({ business_id: businessId, status: 'active' }).then((res) => setAllResources(res.data)).catch(() => {}); });
  }, [businessId]);

  const toggleDay = (day: number) => {
    setForm({ ...form, days_of_week: form.days_of_week.includes(day) ? form.days_of_week.filter((d) => d !== day) : [...form.days_of_week, day] });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const data: any = { rule_type: form.rule_type, description: form.description || undefined };
      if (form.rule_type === 'recurring') { data.days_of_week = form.days_of_week; data.start_time = form.start_time; data.end_time = form.end_time; }
      else if (form.rule_type === 'seasonal') { data.days_of_week = form.days_of_week.length > 0 ? form.days_of_week : undefined; data.start_time = form.start_time; data.end_time = form.end_time; data.effective_from = form.effective_from; data.effective_to = form.effective_to; }
      if (form.location_ids.length > 0) data.location_ids = form.location_ids;
      if (form.staff_ids.length > 0) data.staff_ids = form.staff_ids;
      if (form.resource_ids.length > 0) data.resource_ids = form.resource_ids;
      if (rule) { await servicesApi.updateAvailabilityRule(serviceId, rule.id, data); }
      else { await servicesApi.createAvailabilityRule(serviceId, data); }
      onSaved();
    } catch (err: any) { setError(err.response?.data?.error || 'Failed to save rule'); }
    finally { setSaving(false); }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>{rule ? 'Edit Availability Rule' : 'Add Availability Rule'}</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        {error && <p style={{ color: 'var(--color-error)', fontSize: '13px', margin: '0 0 8px 0' }}>{error}</p>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Rule Type</label>
            <select style={styles.input} value={form.rule_type} onChange={(e) => setForm({ ...form, rule_type: e.target.value })}>
              <option value="recurring">Recurring (weekly)</option>
              <option value="seasonal">Seasonal (date range)</option>
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Days of Week</label>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {dayNames.map((name, idx) => (
                <button key={idx} type="button" onClick={() => toggleDay(idx)}
                  style={{ padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: form.days_of_week.includes(idx) ? 'var(--color-accent, #C9A96E)' : 'var(--color-background)', color: form.days_of_week.includes(idx) ? '#1A1A1A' : 'var(--color-text)', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}>
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={styles.formGroup}><label style={styles.label}>Start Time</label><input type="time" style={styles.input} value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
            <div style={styles.formGroup}><label style={styles.label}>End Time</label><input type="time" style={styles.input} value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div>
          </div>
          {form.rule_type === 'seasonal' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={styles.formGroup}><label style={styles.label}>Effective From</label><input type="date" style={styles.input} value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} /></div>
              <div style={styles.formGroup}><label style={styles.label}>Effective To</label><input type="date" style={styles.input} value={form.effective_to} onChange={(e) => setForm({ ...form, effective_to: e.target.value })} /></div>
            </div>
          )}
          {allLocations.length > 0 && (
            <MultiSelect
              label="Locations (leave empty for all)"
              options={allLocations.map((loc: any) => ({ id: loc.id, label: loc.name }))}
              selected={form.location_ids}
              onChange={(ids) => setForm({ ...form, location_ids: ids })}
              placeholder="All locations"
            />
          )}
          {allStaff.length > 0 && (
            <MultiSelect
              label="Staff (leave empty for all)"
              options={allStaff.map((s: any) => ({ id: s.user_id || s.id, label: `${s.first_name} ${s.last_name}` }))}
              selected={form.staff_ids}
              onChange={(ids) => setForm({ ...form, staff_ids: ids })}
              placeholder="All staff"
            />
          )}
          {allResources.length > 0 && (
            <MultiSelect
              label="Required Resources (leave empty for none)"
              options={allResources.map((r: any) => ({ id: r.id, label: r.name }))}
              selected={form.resource_ids}
              onChange={(ids) => setForm({ ...form, resource_ids: ids })}
              placeholder="No resource requirements"
            />
          )}
          <div style={styles.formGroup}><label style={styles.label}>Description (optional)</label><input style={styles.input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={saving}>{rule ? 'Save Changes' : 'Add Rule'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
// --- Styles ---

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '900px', margin: '0 auto' },
  loading: { padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--color-text-secondary)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  headerCard: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-lg)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-md)' },
  headerInfo: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  name: { margin: 0, fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)' },
  slug: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  categoryLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  headerRight: { display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', gap: '4px' },
  duration: { fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)' },
  actionsBar: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: 'var(--space-md)' },
  saveBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-sm) var(--space-md)', marginBottom: 'var(--space-md)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-primary)' },
  card: { padding: 'var(--space-lg)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-md)' },
  cardTitle: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' },
  input: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: '14px', width: '100%', boxSizing: 'border-box' as const, fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)' },
  muted: { fontSize: '14px', color: 'var(--color-text-secondary)', margin: 0 },
  variantRow: { display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '14px' },
  editBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '2px 4px' },
  deleteBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: 'var(--color-error)', padding: '2px 6px', lineHeight: 1 },
  overlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '500px', maxHeight: '85vh', overflow: 'auto', border: '1px solid var(--color-border)', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--color-text)' },
  closeBtn: { background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--color-text-secondary)' },
};
