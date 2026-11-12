import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { CopyWidgetSnippetButton } from '../components/CopyWidgetSnippetButton';
import { MultiSelect } from '../design-system/components/forms/MultiSelect';
import { StickyPageTop } from '../design-system/components/layout/StickyPageTop';
import { DraftSectionsProvider, useDraftSections, useDraft, useDraftList, fieldMark, checkMark, draftBox, UnsavedTag, RowTag } from '../components/unsaved/DraftSections';
import { LeaveGuard, useGuardedNavigate } from '../components/unsaved/LeaveGuard';
import { SaveChanges } from '../components/unsaved/SaveChanges';
import * as servicesApi from '../api/services';
import type { Service, ServiceVariant, ServiceCategory, AvailabilityRule } from '../api/services';
import { formatCurrency } from '../utils/currency';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success', draft: 'neutral', paused: 'warning', archived: 'error',
};

// One Save for the service (David, 2026-11-02, as in Settings, Events and People): details,
// variants, images and availability rules wait for Save changes; Activate, Pause, Archive and
// Restore act straight away.
export function ServiceDetail() {
  return (
    <DraftSectionsProvider>
      <ServiceDetailPage />
    </DraftSectionsProvider>
  );
}

function ServiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useGuardedNavigate();
  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [taxCategories, setTaxCategories] = useState<any[]>([]);
  const { dirtySections } = useDraftSections();

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
      <LeaveGuard when={dirtySections.length > 0} />
      <StickyPageTop>
        <button style={styles.back} onClick={() => navigate('/offers?tab=services')}>← Back to Offerings</button>

        {/* Header Card */}
        <div style={styles.headerCard}>
          <div style={styles.headerInfo}>
            <h1 style={styles.name}>{service.name}</h1>
            <span style={styles.slug}>/{service.slug}</span>
            {service.category_name && <span style={styles.categoryLabel}>{service.category_name}</span>}
          </div>
          <div style={styles.headerRight}>
            <div style={styles.saveRow}><SaveChanges /></div>
            <div style={styles.saveRow}>
              <Badge variant={STATUS_VARIANTS[service.status] || 'neutral'}>{service.status}</Badge>
              <span style={styles.duration}>{service.default_duration} min</span>
              <CopyWidgetSnippetButton
                productId={service.id}
                productName={service.name}
                action="book"
                enabled={service.online_booking_enabled}
                disabledReason="Enable online booking to get a widget snippet"
              />
            </div>
          </div>
        </div>
      </StickyPageTop>

      {/* Content */}
      <ServiceForm service={service} categories={categories} taxCategories={taxCategories} businessId={businessId} onUpdate={setService} />
      <VariantsCard service={service} />
      <ImagesCard service={service} businessId={businessId} />
      <AvailabilityCard service={service} />
    </div>
  );
}

// --- Service Form (always editable; saved with the page's Save changes) ---

function ServiceForm({ service, categories, taxCategories, businessId, onUpdate }: { service: Service; categories: ServiceCategory[]; taxCategories: any[]; businessId: string; onUpdate: (s: Service) => void }) {
  const [statusChanging, setStatusChanging] = useState(false);
  const fromService = (s: Service) => ({
    name: s.name,
    category_id: s.category_id || '',
    description: s.description || '',
    short_description: s.short_description || '',
    booking_type: s.booking_type,
    default_duration: s.default_duration,
    buffer_before: s.buffer_before,
    buffer_after: s.buffer_after,
    max_capacity: s.max_capacity,
    online_booking_enabled: s.online_booking_enabled,
    requires_dedicated_staff: s.requires_dedicated_staff !== false,
    is_taxable: (s as any).is_taxable || false,
    tax_category_id: (s as any).tax_category_id || '',
    calendar_color: (s as any).calendar_color || '',
  });
  const draft = useDraft('service-details', 'Service details', fromService(service), async (values) => {
    await servicesApi.updateService(service.id, businessId, { ...values, calendar_color: values.calendar_color || null } as any);
    // Read it back whole: the update's reply leaves out the category name shown in the header.
    const updated = await servicesApi.getService(service.id, businessId);
    onUpdate(updated);
    return fromService(updated);
  });
  const form = draft.value;
  const setForm = draft.setValue;
  const mark = (key: keyof typeof form) => fieldMark(draft.changed((v) => v[key]));

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

      {/* Service Details Card */}
      <div style={{ ...styles.card, ...draftBox(draft.dirty) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ ...styles.cardTitle, margin: 0 }}>Service Details<UnsavedTag dirty={draft.dirty} /></h3>
          <Button size="sm" variant="secondary" onClick={() => { /* TODO: trigger translation */ }}>Translate</Button>
        </div>
        <div style={styles.formGrid}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Name *</label>
            <input style={{ ...styles.input, ...mark('name') }} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Category</label>
            <select style={{ ...styles.input, ...mark('category_id') }} value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">None</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Booking Type</label>
            <select style={{ ...styles.input, ...mark('booking_type') }} value={form.booking_type} onChange={(e) => setForm({ ...form, booking_type: e.target.value })}>
              <option value="individual">Individual</option>
              <option value="shared">Shared</option>
              <option value="group">Group</option>
              <option value="resource">Resource</option>
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Duration (min)</label>
            <input style={{ ...styles.input, ...mark('default_duration') }} type="number" min={5} value={form.default_duration} onChange={(e) => setForm({ ...form, default_duration: Number(e.target.value) })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Buffer Before (min)</label>
            <input style={{ ...styles.input, ...mark('buffer_before') }} type="number" min={0} value={form.buffer_before} onChange={(e) => setForm({ ...form, buffer_before: Number(e.target.value) })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Buffer After (min)</label>
            <input style={{ ...styles.input, ...mark('buffer_after') }} type="number" min={0} value={form.buffer_after} onChange={(e) => setForm({ ...form, buffer_after: Number(e.target.value) })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Max Capacity</label>
            <input style={{ ...styles.input, ...mark('max_capacity') }} type="number" min={1} value={form.max_capacity} onChange={(e) => setForm({ ...form, max_capacity: Number(e.target.value) })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>&nbsp;</label>
            <div style={{ display: 'flex', gap: '24px', paddingTop: '4px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.online_booking_enabled} onChange={(e) => setForm({ ...form, online_booking_enabled: e.target.checked })} style={{ width: '16px', height: '16px', ...checkMark(draft.changed((v) => v.online_booking_enabled)) }} />
                Online Booking
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.requires_dedicated_staff} onChange={(e) => setForm({ ...form, requires_dedicated_staff: e.target.checked })} style={{ width: '16px', height: '16px', ...checkMark(draft.changed((v) => v.requires_dedicated_staff)) }} />
                Requires Dedicated Staff
              </label>
            </div>
          </div>
          <div style={styles.formGroup}>
            {/* CAL-11: a colour per service by default; the owner can choose another */}
            <label style={styles.label}>Calendar colour</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', ...mark('calendar_color') }}>
              <input type="color" aria-label="Calendar colour" value={form.calendar_color || '#2F7A91'} onChange={(e) => setForm({ ...form, calendar_color: e.target.value })} style={{ width: '44px', height: '34px', padding: 0, border: '1px solid var(--color-border)', borderRadius: '6px', background: 'none', cursor: 'pointer' }} />
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{form.calendar_color ? form.calendar_color.toUpperCase() : 'Default colour (from the calendar palette)'}</span>
              {form.calendar_color && <button type="button" onClick={() => setForm({ ...form, calendar_color: '' })} style={{ background: 'none', border: 0, color: 'var(--color-primary-hover, #1B3597)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', textDecoration: 'underline', fontFamily: 'var(--font-family)' }}>Use the default</button>}
            </div>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Tax Category</label>
            <select style={{ ...styles.input, ...mark('tax_category_id') }} value={form.tax_category_id} onChange={(e) => setForm({ ...form, tax_category_id: e.target.value })}>
              <option value="">No tax</option>
              {taxCategories.map((tc: any) => <option key={tc.id} value={tc.id}>{tc.name} ({(tc.rate / 100).toFixed(2)}%)</option>)}
            </select>
          </div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
            <label style={styles.label}>Short Description</label>
            <input style={{ ...styles.input, ...mark('short_description') }} value={form.short_description} onChange={(e) => setForm({ ...form, short_description: e.target.value })} />
          </div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
            <label style={styles.label}>Description</label>
            <textarea style={{ ...styles.input, minHeight: '80px', resize: 'vertical', maxWidth: '100%', ...mark('description') }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        </div>
      </div>
    </>
  );
}

// --- Variants Card (add/edit in a window; saved with the page's Save changes) ---

type VariantData = Pick<ServiceVariant, 'name' | 'duration' | 'price' | 'pricing_model' | 'billing_interval' | 'included_sessions' | 'no_show_fee'>;
const variantData = (v: VariantData): VariantData => ({
  name: v.name, duration: v.duration, price: v.price, pricing_model: v.pricing_model,
  billing_interval: v.pricing_model === 'subscription' ? v.billing_interval : undefined,
  included_sessions: v.pricing_model === 'subscription' ? v.included_sessions ?? null : undefined,
  no_show_fee: v.no_show_fee ?? null,
} as VariantData);

function VariantsCard({ service }: { service: Service }) {
  const list = useDraftList<ServiceVariant>('service-variants', 'Variants', {
    create: (v) => servicesApi.createVariant(service.id, variantData(v)),
    update: (v) => servicesApi.updateVariant(service.id, v.id, variantData(v)),
    remove: (v) => servicesApi.deleteVariant(service.id, v.id),
  });
  const [editing, setEditing] = useState<{ key?: string; variant?: ServiceVariant } | null>(null);
  useEffect(() => { list.load(service.variants || []); }, [service.id, list.load]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = list.rows.filter((r) => !r.deleted);
  return (
    <div style={{ ...styles.card, ...draftBox(list.dirty) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Variants<UnsavedTag dirty={list.dirty} /></h3>
        <Button size="sm" variant="secondary" onClick={() => setEditing({})}>Add Variant</Button>
      </div>

      {shown.length === 0 && <p style={styles.muted}>No variants yet. Add at least one variant to activate this service.</p>}
      {list.rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {list.rows.map((r) => {
            const v = r.item;
            const edited = !r.isNew && !r.deleted && list.changed(r, (x) => variantData(x));
            return (
              <div key={r.key} style={{ ...styles.variantRow, opacity: r.deleted ? 0.6 : 1, ...(edited ? fieldMark(true) : {}) }}>
                <div style={{ flex: 1 }}>
                  {r.deleted ? <s><strong>{v.name}</strong> — {v.duration} min — {formatCurrency(v.price)}</s>
                    : <><strong>{v.name}</strong> — {v.duration} min — {formatCurrency(v.price)}</>}
                  {v.pricing_model === 'subscription' && <Badge variant="info">{`Sub: ${v.billing_interval || 'monthly'}`}</Badge>}
                  {v.no_show_fee != null && v.no_show_fee > 0 && <Badge variant="neutral">{`No-show: ${formatCurrency(v.no_show_fee)}`}</Badge>}
                  {r.isNew && <> <RowTag>New</RowTag></>}
                  {edited && <> <RowTag>Changed</RowTag></>}
                  {r.deleted && <> <RowTag>Deleted when you save</RowTag></>}
                </div>
                {!r.isNew && <Badge variant={STATUS_VARIANTS[v.status] || 'neutral'}>{v.status}</Badge>}
                {r.deleted ? <Button size="sm" variant="ghost" onClick={() => list.undo(r.key)}>Undo</Button> : <>
                  <button style={styles.editBtn} onClick={() => setEditing({ key: r.key, variant: v })} title="Edit">✏️</button>
                  <button style={styles.deleteBtn} onClick={() => list.remove(r.key)} title="Delete">×</button>
                </>}
              </div>
            );
          })}
        </div>
      )}

      {/* Variant Modal */}
      {editing && (
        <ServiceVariantModal
          variant={editing.variant}
          onClose={() => setEditing(null)}
          onDone={(data) => {
            if (editing.key) list.edit(editing.key, data);
            else list.add({ ...data, status: 'active' } as ServiceVariant);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ServiceVariantModal({ variant, onClose, onDone }: { variant?: ServiceVariant; onClose: () => void; onDone: (data: VariantData) => void }) {
  const [form, setForm] = useState({
    name: variant?.name || '',
    duration: variant?.duration || 60,
    pricing_model: variant?.pricing_model || 'per_session',
    billing_interval: variant?.billing_interval || 'monthly',
    included_sessions: variant?.included_sessions ? String(variant.included_sessions) : '',
  });
  const [priceDisplay, setPriceDisplay] = useState(variant ? (variant.price / 100).toFixed(2) : '0.00');
  const [noShowFeeDisplay, setNoShowFeeDisplay] = useState(
    variant?.no_show_fee != null ? (variant.no_show_fee / 100).toFixed(2) : '',
  );
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) { setError('Name is required'); return; }
    onDone(variantData({
      name: form.name, duration: form.duration, pricing_model: form.pricing_model,
      price: Math.round(parseFloat(priceDisplay || '0') * 100),
      billing_interval: form.billing_interval,
      included_sessions: form.included_sessions ? parseInt(form.included_sessions) : null,
      // No-show fee: blank = null (no fee); otherwise cents
      no_show_fee: noShowFeeDisplay.trim() === '' ? null : Math.round(parseFloat(noShowFeeDisplay) * 100),
    } as VariantData));
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>{variant ? 'Edit Variant' : 'Add Variant'}</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        {error && <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: '0 0 8px 0' }}>{error}</p>}
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
              onBlur={() => setPriceDisplay((Math.round(parseFloat(priceDisplay || '0') * 100) / 100).toFixed(2))}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>No-Show Fee (blank = none)</label>
            <input style={styles.input} type="number" step="0.01" min="0" placeholder="0.00" value={noShowFeeDisplay}
              onChange={(e) => setNoShowFeeDisplay(e.target.value)}
              onBlur={() => { if (noShowFeeDisplay.trim() !== '') setNoShowFeeDisplay((Math.round(parseFloat(noShowFeeDisplay || '0') * 100) / 100).toFixed(2)); }}
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
          <p style={{ ...styles.muted, fontSize: 'var(--font-size-xs)' }}>Saved with the page's Save changes.</p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit">{variant ? 'Done' : 'Add Variant'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Images Card (uploads and deletions wait for the page's Save changes) ---

function ImagesCard({ service, businessId }: { service: Service; businessId: string }) {
  const [images, setImages] = useState(service.images || []);
  type Pending = { added: Array<{ key: string; file: File; url: string }>; removed: string[] };
  const draft = useDraft<Pending>('service-images', 'Images', { added: [], removed: [] }, async (d) => {
    const left: Pending = { added: [...d.added], removed: [...d.removed] };
    let now = images;
    try {
      for (const a of d.added) { const img = await servicesApi.uploadImage(service.id, businessId, a.file); now = [...now, img]; left.added.shift(); }
      for (const id of d.removed) { await servicesApi.deleteImage(service.id, id); now = now.filter((i) => i.id !== id); left.removed.shift(); }
    } catch (err) { setImages(now); draft.rebase({ added: [], removed: [] }, left); throw err; }
    setImages(now);
    return { added: [], removed: [] };
  });

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    draft.setValue({ ...draft.value, added: [...draft.value.added, { key: `${Date.now()}-${file.name}`, file, url: URL.createObjectURL(file) }] });
    e.target.value = '';
  };
  const toggleRemove = (id: string) => draft.setValue({ ...draft.value, removed: draft.value.removed.includes(id) ? draft.value.removed.filter((x) => x !== id) : [...draft.value.removed, id] });

  return (
    <div style={{ ...styles.card, ...draftBox(draft.dirty) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Images<UnsavedTag dirty={draft.dirty} /></h3>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', cursor: 'pointer', color: 'var(--color-text)' }}>
          Upload Image
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePick} style={{ display: 'none' }} />
        </label>
      </div>
      {images.length === 0 && draft.value.added.length === 0 && <p style={styles.muted}>No images uploaded</p>}
      {(images.length > 0 || draft.value.added.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 'var(--space-md)' }}>
          {images.map((img) => {
            const gone = draft.value.removed.includes(img.id);
            return (
              <div key={img.id} style={{ position: 'relative', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', opacity: gone ? 0.5 : 1 }}>
                <img src={img.urls?.thumbnail || ''} alt={img.alt_text || ''} style={{ width: '100%', height: '80px', objectFit: 'cover' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px', padding: '4px 6px', flexWrap: 'wrap' }}>
                  {gone ? <RowTag>Deleted when you save</RowTag> : img.is_primary && <Badge variant="success">Primary</Badge>}
                  {gone ? <Button size="sm" variant="ghost" onClick={() => toggleRemove(img.id)}>Undo</Button>
                    : <button style={styles.deleteBtn} title="Delete" onClick={() => toggleRemove(img.id)}>×</button>}
                </div>
              </div>
            );
          })}
          {draft.value.added.map((a) => (
            <div key={a.key} style={{ position: 'relative', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              <img src={a.url} alt={a.file.name} style={{ width: '100%', height: '80px', objectFit: 'cover' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px' }}>
                <RowTag>New</RowTag>
                <button style={styles.deleteBtn} title="Remove" onClick={() => draft.setValue({ ...draft.value, added: draft.value.added.filter((x) => x.key !== a.key) })}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', margin: '8px 0 0' }}>Accepted: JPEG, PNG, or WebP. Max 5MB. Min 400×300px. Uploaded when you press Save changes.</p>
    </div>
  );
}

// --- Availability Card (add/edit in a window; saved with the page's Save changes) ---

type RuleData = Partial<AvailabilityRule> & { location_ids?: string[]; staff_ids?: string[]; resource_ids?: string[] };

function AvailabilityCard({ service }: { service: Service }) {
  const list = useDraftList<AvailabilityRule & RuleData>('service-availability', 'Availability', {
    create: (r) => servicesApi.createAvailabilityRule(service.id, ruleData(r)),
    update: (r) => servicesApi.updateAvailabilityRule(service.id, r.id, ruleData(r)),
    remove: (r) => servicesApi.deleteAvailabilityRule(service.id, r.id),
  });
  const [editing, setEditing] = useState<{ key?: string; rule?: AvailabilityRule } | null>(null);
  useEffect(() => { list.load((service.availability || []) as any); }, [service.id, list.load]); // eslint-disable-line react-hooks/exhaustive-deps
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div style={{ ...styles.card, ...draftBox(list.dirty) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Availability<UnsavedTag dirty={list.dirty} /></h3>
        <Button size="sm" variant="secondary" onClick={() => setEditing({})}>Add Rule</Button>
      </div>
      {list.rows.length === 0 && <p style={styles.muted}>No availability rules. Service is available anytime.</p>}
      {list.rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {list.rows.map((r) => {
            const rule = r.item;
            const edited = !r.isNew && !r.deleted && list.changed(r, (x) => ruleData(x));
            return (
              <div key={r.key} style={{ ...styles.variantRow, opacity: r.deleted ? 0.6 : 1, ...(edited ? fieldMark(true) : {}) }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', textDecoration: r.deleted ? 'line-through' : 'none' }}>
                  <Badge variant="neutral">{rule.rule_type}</Badge>
                  {rule.rule_type === 'recurring' && <span>{[...(rule.days_of_week || [])].sort((a, b) => a - b).map((d) => dayNames[d]).join(', ')} {rule.start_time}–{rule.end_time}</span>}
                  {rule.rule_type === 'seasonal' && <span>{rule.effective_from} to {rule.effective_to} {rule.start_time}–{rule.end_time}</span>}
                  {rule.description && <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>— {rule.description}</span>}
                  {r.isNew && <RowTag>New</RowTag>}
                  {edited && <RowTag>Changed</RowTag>}
                  {r.deleted && <RowTag>Deleted when you save</RowTag>}
                </div>
                {r.deleted ? <Button size="sm" variant="ghost" onClick={() => list.undo(r.key)}>Undo</Button> : <>
                  <button style={styles.editBtn} onClick={() => setEditing({ key: r.key, rule })} title="Edit">✏️</button>
                  <button style={styles.deleteBtn} onClick={() => list.remove(r.key)} title="Delete">×</button>
                </>}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <AvailabilityModal
          rule={editing.rule}
          onClose={() => setEditing(null)}
          onDone={(data) => {
            if (editing.key) list.edit(editing.key, data as any);
            else list.add(data as any);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// What is sent for a rule: the fields of its type only; empty lists are left out.
function ruleData(r: RuleData): RuleData {
  const data: RuleData = { rule_type: r.rule_type, description: r.description || undefined };
  if (r.rule_type === 'recurring') { data.days_of_week = r.days_of_week; data.start_time = r.start_time; data.end_time = r.end_time; }
  else if (r.rule_type === 'seasonal') { data.days_of_week = r.days_of_week && r.days_of_week.length > 0 ? r.days_of_week : undefined; data.start_time = r.start_time; data.end_time = r.end_time; data.effective_from = r.effective_from; data.effective_to = r.effective_to; }
  if (r.location_ids && r.location_ids.length > 0) data.location_ids = r.location_ids;
  if (r.staff_ids && r.staff_ids.length > 0) data.staff_ids = r.staff_ids;
  if (r.resource_ids && r.resource_ids.length > 0) data.resource_ids = r.resource_ids;
  return data;
}

function AvailabilityModal({ rule, onClose, onDone }: { rule?: AvailabilityRule; onClose: () => void; onDone: (data: RuleData) => void }) {
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onDone({ ...form, rule_type: form.rule_type as AvailabilityRule['rule_type'] });
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>{rule ? 'Edit Availability Rule' : 'Add Availability Rule'}</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
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
                  style={{ padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: form.days_of_week.includes(idx) ? 'var(--color-accent, #C9A96E)' : 'var(--color-background)', color: form.days_of_week.includes(idx) ? '#1A1A1A' : 'var(--color-text)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
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
          <p style={{ ...styles.muted, fontSize: 'var(--font-size-xs)' }}>Saved with the page's Save changes.</p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit">{rule ? 'Done' : 'Add Rule'}</Button>
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
  name: { margin: 0, fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)' },
  slug: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  categoryLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  headerRight: { display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', gap: '6px' },
  saveRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' },
  duration: { fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)' },
  actionsBar: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: 'var(--space-md)' },
  saveBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-sm) var(--space-md)', marginBottom: 'var(--space-md)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-primary)' },
  card: { padding: 'var(--space-lg)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-md)' },
  cardTitle: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)' },
  input: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 'var(--font-size-base)', width: '100%', boxSizing: 'border-box' as const, fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)' },
  muted: { fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)', margin: 0 },
  variantRow: { display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-base)' },
  editBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-base)', padding: '2px 4px', borderRadius: 'var(--button-radius)', minHeight: 'var(--button-height-sm)' },
  deleteBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-lg)', color: 'var(--color-error)', padding: '2px 6px', lineHeight: 1, borderRadius: 'var(--button-radius)', minHeight: 'var(--button-height-sm)' },
  overlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '500px', maxHeight: '85vh', overflow: 'auto', border: '1px solid var(--color-border)', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)' },
  closeBtn: { background: 'none', border: 'none', fontSize: 'var(--font-size-xl)', cursor: 'pointer', color: 'var(--color-text-secondary)' },
};
