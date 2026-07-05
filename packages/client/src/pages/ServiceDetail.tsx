import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Tabs } from '../design-system/components/navigation/Tabs';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import * as servicesApi from '../api/services';
import * as locationsApi from '../api/locations';
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
        { id: 'locations', label: 'Locations', content: <LocationsTab service={service} businessId={businessId} /> },
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
    booking_type: service.booking_type,
    default_duration: service.default_duration,
    buffer_before: service.buffer_before,
    buffer_after: service.buffer_after,
    max_capacity: service.max_capacity,
    min_advance_booking_hours: service.min_advance_booking_hours || 2,
    max_advance_booking_days: service.max_advance_booking_days || 30,
    online_booking_enabled: service.online_booking_enabled,
    preparation_notes: service.preparation_notes || '',
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
          <Field label="Name" value={service.name} />
          <Field label="Booking Type" value={service.booking_type} />
          <Field label="Duration" value={`${service.default_duration} min`} />
          <Field label="Buffer Before" value={`${service.buffer_before} min`} />
          <Field label="Buffer After" value={`${service.buffer_after} min`} />
          <Field label="Capacity" value={String(service.max_capacity)} />
          <Field label="Min Advance Booking" value={`${service.min_advance_booking_hours || 2} hours`} />
          <Field label="Max Advance Booking" value={`${service.max_advance_booking_days || 30} days`} />
          <Field label="Online Booking" value={service.online_booking_enabled ? 'Yes' : 'No'} />
        </div>
        {service.short_description && <p style={styles.description}><strong>Short:</strong> {service.short_description}</p>}
        {service.description && <p style={styles.description}>{service.description}</p>}
        {service.preparation_notes && <p style={styles.description}><strong>Preparation Notes:</strong> {service.preparation_notes}</p>}
      </div>
    );
  }

  return (
    <div style={styles.tabContent}>
      <div style={styles.formGrid}>
        <FormField label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <div style={styles.fieldWrapper}>
          <label style={styles.label}>Booking Type</label>
          <select value={form.booking_type} onChange={(e) => setForm({ ...form, booking_type: e.target.value })} style={styles.input}>
            <option value="individual">Individual</option>
            <option value="shared">Shared</option>
            <option value="group">Group</option>
            <option value="resource">Resource</option>
          </select>
        </div>
        <FormField label="Duration (min)" type="number" value={String(form.default_duration)} onChange={(v) => setForm({ ...form, default_duration: parseInt(v) || 60 })} />
        <FormField label="Max Capacity" type="number" value={String(form.max_capacity)} onChange={(v) => setForm({ ...form, max_capacity: parseInt(v) || 1 })} />
        <FormField label="Buffer Before (min)" type="number" value={String(form.buffer_before)} onChange={(v) => setForm({ ...form, buffer_before: parseInt(v) || 0 })} />
        <FormField label="Buffer After (min)" type="number" value={String(form.buffer_after)} onChange={(v) => setForm({ ...form, buffer_after: parseInt(v) || 0 })} />
        <FormField label="Min Advance Booking (hours)" type="number" value={String(form.min_advance_booking_hours)} onChange={(v) => setForm({ ...form, min_advance_booking_hours: parseInt(v) || 2 })} />
        <FormField label="Max Advance Booking (days)" type="number" value={String(form.max_advance_booking_days)} onChange={(v) => setForm({ ...form, max_advance_booking_days: parseInt(v) || 30 })} />
        <div style={{ gridColumn: '1 / -1' }}>
          <FormField label="Short Description" value={form.short_description} onChange={(v) => setForm({ ...form, short_description: v })} />
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={styles.label}>Description</label>
          <textarea style={{ ...styles.input, minHeight: '80px' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={styles.label}>Preparation Notes</label>
          <textarea style={{ ...styles.input, minHeight: '60px' }} value={form.preparation_notes} onChange={(e) => setForm({ ...form, preparation_notes: e.target.value })} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', gridColumn: '1 / -1' }}>
          <input type="checkbox" checked={form.online_booking_enabled} onChange={(e) => setForm({ ...form, online_booking_enabled: e.target.checked })} />
          Enable online booking
        </label>
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

function LocationsTab({ service, businessId }: { service: Service; businessId: string }) {
  const [allLocations, setAllLocations] = useState<locationsApi.Location[]>([]);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      locationsApi.getLocations(businessId),
      servicesApi.getServiceLocations(service.id),
    ]).then(([locs, ids]) => {
      setAllLocations(locs);
      setAssignedIds(ids);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, [businessId, service.id]);

  const toggleLocation = (id: string) => {
    setAssignedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await servicesApi.setServiceLocations(service.id, businessId, assignedIds);
    } catch { alert('Failed to save locations'); }
    finally { setSaving(false); }
  };

  if (loading) return <div style={styles.tabContent}><p style={styles.empty}>Loading...</p></div>;

  if (allLocations.length === 0) {
    return (
      <div style={styles.tabContent}>
        <p style={styles.empty}>No locations configured for this business. Add locations in Settings → Locations first.</p>
      </div>
    );
  }

  return (
    <div style={styles.tabContent}>
      <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-md) 0' }}>
        Select which locations offer this service. If none are selected, the service is available at all locations.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)' }}>
        {allLocations.map((loc) => (
          <label key={loc.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', cursor: 'pointer', padding: 'var(--space-sm)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
            <input
              type="checkbox"
              checked={assignedIds.includes(loc.id)}
              onChange={() => toggleLocation(loc.id)}
            />
            <span><strong>{loc.name}</strong></span>
            {loc.is_primary && <Badge variant="info">Primary</Badge>}
            {loc.city && <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)' }}>— {loc.city}{loc.state_province ? `, ${loc.state_province}` : ''}</span>}
          </label>
        ))}
      </div>
      <div style={{ marginTop: 'var(--space-md)' }}>
        <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Locations'}</Button>
      </div>
    </div>
  );
}

function StaffTab({ service }: { service: Service }) {
  const [staff, setStaff] = useState<any[]>(service.staff || []);
  const [availableStaff, setAvailableStaff] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);

  useEffect(() => {
    if (showAdd && availableStaff.length === 0) {
      import('../api/staff').then((staffApi) => {
        staffApi.getStaffList({ status: 'active' }).then((result) => {
          // Filter out already assigned staff (by user_id)
          const assignedUserIds = staff.map((s) => s.user_id);
          setAvailableStaff(result.data.filter((s: any) => !assignedUserIds.includes(s.user_id)));
        });
      });
    }
  }, [showAdd]);

  const handleAssign = async () => {
    if (!selectedUserId) return;
    try {
      const staffMember = availableStaff.find((s) => s.id === selectedUserId);
      if (!staffMember?.user_id) {
        alert('This staff member does not have a linked user account. Please add an email address on their profile to create one.');
        return;
      }
      const assignment = await servicesApi.assignStaff(service.id, { user_id: staffMember.user_id, is_primary: isPrimary });
      setStaff([...staff, { ...assignment, first_name: staffMember.first_name, last_name: staffMember.last_name }]);
      setSelectedUserId('');
      setIsPrimary(false);
      setShowAdd(false);
      setAvailableStaff(availableStaff.filter((s) => s.id !== selectedUserId));
    } catch { alert('Failed to assign staff'); }
  };

  const handleRemove = async (userId: string) => {
    if (!confirm('Remove this staff member from the service?')) return;
    try {
      await servicesApi.removeStaff(service.id, userId);
      setStaff(staff.filter((s) => s.user_id !== userId));
    } catch { alert('Failed to remove staff'); }
  };

  return (
    <div style={styles.tabContent}>
      <Button onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'Cancel' : 'Assign Staff'}</Button>
      {showAdd && (
        <div style={styles.addForm}>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Staff Member</label>
            <select style={styles.input} value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
              <option value="">— Select —</option>
              {availableStaff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.first_name} {s.last_name}{!s.user_id ? ' (no user account)' : ''}
                </option>
              ))}
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            Primary provider
          </label>
          <Button onClick={handleAssign}>Assign</Button>
        </div>
      )}
      {staff.length === 0 && !showAdd && <p style={styles.empty}>No staff assigned to this service</p>}
      {staff.map((s) => (
        <div key={s.id || s.user_id} style={styles.staffRow}>
          <span>{s.first_name} {s.last_name}</span>
          {s.is_primary && <Badge variant="success">Primary</Badge>}
          <button style={styles.deleteBtn} onClick={() => handleRemove(s.user_id)}>×</button>
        </div>
      ))}
    </div>
  );
}

function AvailabilityTab({ service }: { service: Service }) {
  const [rules, setRules] = useState<AvailabilityRule[]>(service.availability || []);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    rule_type: 'recurring' as string,
    days_of_week: [] as number[],
    start_time: '09:00',
    end_time: '17:00',
    effective_from: '',
    effective_to: '',
    description: '',
  });

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const toggleDay = (day: number) => {
    setForm({
      ...form,
      days_of_week: form.days_of_week.includes(day)
        ? form.days_of_week.filter((d) => d !== day)
        : [...form.days_of_week, day],
    });
  };

  const handleAdd = async () => {
    try {
      const data: any = { rule_type: form.rule_type, description: form.description || undefined };
      if (form.rule_type === 'recurring') {
        data.days_of_week = form.days_of_week;
        data.start_time = form.start_time;
        data.end_time = form.end_time;
      } else if (form.rule_type === 'seasonal') {
        data.days_of_week = form.days_of_week.length > 0 ? form.days_of_week : undefined;
        data.start_time = form.start_time;
        data.end_time = form.end_time;
        data.effective_from = form.effective_from;
        data.effective_to = form.effective_to;
      }
      const rule = await servicesApi.createAvailabilityRule(service.id, data);
      setRules([...rules, rule]);
      setShowAdd(false);
      setForm({ rule_type: 'recurring', days_of_week: [], start_time: '09:00', end_time: '17:00', effective_from: '', effective_to: '', description: '' });
    } catch { alert('Failed to create rule'); }
  };

  const handleDelete = async (ruleId: string) => {
    if (!confirm('Delete this availability rule?')) return;
    try {
      await servicesApi.deleteAvailabilityRule(service.id, ruleId);
      setRules(rules.filter((r) => r.id !== ruleId));
    } catch { alert('Failed to delete rule'); }
  };

  return (
    <div style={styles.tabContent}>
      <Button onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'Cancel' : 'Add Rule'}</Button>
      {showAdd && (
        <div style={styles.addForm}>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Rule Type</label>
            <select style={styles.input} value={form.rule_type} onChange={(e) => setForm({ ...form, rule_type: e.target.value })}>
              <option value="recurring">Recurring (weekly)</option>
              <option value="seasonal">Seasonal (date range)</option>
            </select>
          </div>
          <div style={styles.fieldWrapper}>
            <label style={styles.label}>Days of Week</label>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {dayNames.map((name, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => toggleDay(idx)}
                  style={{ ...styles.filterBtn, ...(form.days_of_week.includes(idx) ? styles.filterBtnActive : {}) }}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
            <div style={styles.fieldWrapper}>
              <label style={styles.label}>Start Time</label>
              <input type="time" style={styles.input} value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
            </div>
            <div style={styles.fieldWrapper}>
              <label style={styles.label}>End Time</label>
              <input type="time" style={styles.input} value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
            </div>
          </div>
          {form.rule_type === 'seasonal' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
              <div style={styles.fieldWrapper}>
                <label style={styles.label}>Effective From</label>
                <input type="date" style={styles.input} value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
              </div>
              <div style={styles.fieldWrapper}>
                <label style={styles.label}>Effective To</label>
                <input type="date" style={styles.input} value={form.effective_to} onChange={(e) => setForm({ ...form, effective_to: e.target.value })} />
              </div>
            </div>
          )}
          <FormField label="Description (optional)" value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
          <Button onClick={handleAdd}>Save Rule</Button>
        </div>
      )}
      {rules.length === 0 && !showAdd && <p style={styles.empty}>No availability rules. Service uses business operating hours.</p>}
      {rules.map((rule: AvailabilityRule) => (
        <div key={rule.id} style={styles.ruleCard}>
          <Badge variant="neutral">{rule.rule_type}</Badge>
          {rule.rule_type === 'recurring' && (
            <span>{rule.days_of_week?.map((d) => dayNames[d]).join(', ')} {rule.start_time}–{rule.end_time}</span>
          )}
          {rule.rule_type === 'seasonal' && (
            <span>{rule.effective_from} to {rule.effective_to} {rule.start_time}–{rule.end_time}</span>
          )}
          {rule.rule_type === 'block' && (
            <span>{rule.blocked_dates?.length} date(s) blocked</span>
          )}
          {rule.description && <span style={styles.ruleDesc}>— {rule.description}</span>}
          <button style={styles.deleteBtn} onClick={() => handleDelete(rule.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

function PolicyTab({ service, businessId }: { service: Service; businessId: string }) {
  const [policies, setPolicies] = useState<any[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [taxCategories, setTaxCategories] = useState<any[]>([]);
  const [editingTax, setEditingTax] = useState<string | null>(null);
  const [taxForm, setTaxForm] = useState<any>({});

  useEffect(() => {
    servicesApi.getPolicies(businessId).then(setPolicies).catch(() => {});
    servicesApi.getTaxCategories(businessId).then(setTaxCategories).catch(() => {});
  }, [businessId]);

  const handleEditPolicy = (policy: any) => {
    setEditing(policy.id);
    setEditForm({
      name: policy.name,
      free_cancellation_hours: policy.free_cancellation_hours,
      late_cancel_fee_type: policy.late_cancel_fee_type,
      late_cancel_fee_value: policy.late_cancel_fee_value,
      noshow_fee_type: policy.noshow_fee_type,
      noshow_fee_value: policy.noshow_fee_value,
    });
  };

  const handleSavePolicy = async (id: string) => {
    try {
      const updated = await servicesApi.updatePolicy(id, businessId, editForm);
      setPolicies(policies.map((p) => (p.id === id ? updated : p)));
      setEditing(null);
    } catch {
      alert('Failed to update policy');
    }
  };

  const handleDeletePolicy = async (id: string) => {
    if (!confirm('Delete this cancellation policy? Services using it will revert to the default policy.')) return;
    try {
      await servicesApi.deletePolicy(id, businessId);
      setPolicies(policies.filter((p) => p.id !== id));
    } catch {
      alert('Failed to delete policy. It may be in use.');
    }
  };

  const handleEditTax = (tax: any) => {
    setEditingTax(tax.id);
    setTaxForm({ name: tax.name, rate: tax.rate, is_default: tax.is_default });
  };

  const handleSaveTax = async (id: string) => {
    try {
      const updated = await servicesApi.updateTaxCategory(id, businessId, taxForm);
      setTaxCategories(taxCategories.map((t) => (t.id === id ? updated : t)));
      setEditingTax(null);
    } catch {
      alert('Failed to update tax category');
    }
  };

  return (
    <div style={styles.tabContent}>
      {/* Cancellation Policies */}
      <h3 style={{ fontSize: 'var(--font-size-md)', color: 'var(--color-text)', marginBottom: 'var(--space-sm)' }}>Cancellation Policies</h3>
      <p style={styles.label}>Assigned Policy: {(service as any).cancellation_policy_id ? 'Custom' : 'Business Default'}</p>
      <div style={styles.policyList}>
        {policies.map((p) => (
          <div key={p.id} style={styles.policyCard}>
            {editing === p.id ? (
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)', width: '100%' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-sm)' }}>
                  <div style={styles.fieldWrapper}>
                    <label style={styles.label}>Name</label>
                    <input style={styles.input} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                  </div>
                  <div style={styles.fieldWrapper}>
                    <label style={styles.label}>Free Cancel (hours)</label>
                    <input type="number" style={styles.input} value={editForm.free_cancellation_hours} onChange={(e) => setEditForm({ ...editForm, free_cancellation_hours: parseInt(e.target.value) || 0 })} />
                  </div>
                  <div style={styles.fieldWrapper}>
                    <label style={styles.label}>Late Cancel Fee (%)</label>
                    <input type="number" style={styles.input} value={editForm.late_cancel_fee_value} onChange={(e) => setEditForm({ ...editForm, late_cancel_fee_value: parseInt(e.target.value) || 0 })} />
                  </div>
                  <div style={styles.fieldWrapper}>
                    <label style={styles.label}>No-show Fee (%)</label>
                    <input type="number" style={styles.input} value={editForm.noshow_fee_value} onChange={(e) => setEditForm({ ...editForm, noshow_fee_value: parseInt(e.target.value) || 0 })} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                  <Button onClick={() => handleSavePolicy(p.id)}>Save</Button>
                  <Button onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flex: 1 }}>
                  <strong>{p.name}</strong>
                  {p.is_default && <Badge variant="info">Default</Badge>}
                  <span>Free cancel: {p.free_cancellation_hours}h | Late: {p.late_cancel_fee_value}% | No-show: {p.noshow_fee_value}%</span>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button style={styles.deleteBtn} onClick={() => handleEditPolicy(p)} title="Edit">✎</button>
                  {!p.is_default && <button style={styles.deleteBtn} onClick={() => handleDeletePolicy(p.id)} title="Delete">×</button>}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Tax Categories */}
      <h3 style={{ fontSize: 'var(--font-size-md)', color: 'var(--color-text)', marginTop: 'var(--space-xl)', marginBottom: 'var(--space-sm)' }}>Tax Categories</h3>
      <div style={styles.policyList}>
        {taxCategories.map((t) => (
          <div key={t.id} style={styles.policyCard}>
            {editingTax === t.id ? (
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)', width: '100%' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
                  <div style={styles.fieldWrapper}>
                    <label style={styles.label}>Name</label>
                    <input style={styles.input} value={taxForm.name} onChange={(e) => setTaxForm({ ...taxForm, name: e.target.value })} />
                  </div>
                  <div style={styles.fieldWrapper}>
                    <label style={styles.label}>Rate (%)</label>
                    <input type="number" step="0.01" style={styles.input} value={taxForm.rate} onChange={(e) => setTaxForm({ ...taxForm, rate: parseFloat(e.target.value) || 0 })} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                  <Button onClick={() => handleSaveTax(t.id)}>Save</Button>
                  <Button onClick={() => setEditingTax(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flex: 1 }}>
                  <strong>{t.name}</strong>
                  {t.is_default && <Badge variant="info">Default</Badge>}
                  <span>{t.rate}%</span>
                </div>
                <button style={styles.deleteBtn} onClick={() => handleEditTax(t)} title="Edit">✎</button>
              </>
            )}
          </div>
        ))}
        {taxCategories.length === 0 && <p style={styles.empty}>No tax categories configured</p>}
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
