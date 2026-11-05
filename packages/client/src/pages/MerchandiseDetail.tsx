import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { StickyPageTop } from '../design-system/components/layout/StickyPageTop';
import { DraftSectionsProvider, useDraftSections, useDraft, useDraftList, fieldMark, draftBox, UnsavedTag, RowTag } from '../components/unsaved/DraftSections';
import { LeaveGuard, useGuardedNavigate } from '../components/unsaved/LeaveGuard';
import { SaveChanges } from '../components/unsaved/SaveChanges';
import { apiClient } from '../api/client';
import { formatCurrency } from '../utils/currency';
import * as servicesApi from '../api/services';
import type { ServiceCategory } from '../api/services';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success', draft: 'neutral', paused: 'warning', archived: 'error', inactive: 'neutral',
};

interface Merchandise {
  id: string;
  name: string;
  description?: string;
  short_description?: string;
  sku?: string;
  price: number;
  status: string;
  category_id?: string;
  category_name?: string;
  image_url?: string;
  display_order: number;
  tax_category_id?: string;
  created_at: string;
  updated_at: string;
}

interface MerchVariant {
  id: string;
  name: string;
  sku?: string;
  price: number;
  status: string;
  display_order: number;
}

// One Save for the product (David, 2026-11-02, as in Settings, Events and People): details,
// image and variants wait for Save changes; Pause, Activate, Archive and Restore act straight away.
export function MerchandiseDetail() {
  return (
    <DraftSectionsProvider>
      <MerchandiseDetailPage />
    </DraftSectionsProvider>
  );
}

function MerchandiseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useGuardedNavigate();
  const [item, setItem] = useState<Merchandise | null>(null);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const { dirtySections } = useDraftSections();

  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!id || !businessId) return;
    setLoading(true);
    Promise.all([
      apiClient.get(`/v1/merchandise/${id}?business_id=${businessId}`).then((r) => r.data.data),
      servicesApi.getCategories(businessId),
    ]).then(([merch, cats]) => {
      setItem(merch);
      setCategories(cats);
    }).catch(() => setItem(null)).finally(() => setLoading(false));
  }, [id, businessId]);

  if (loading) return <div style={styles.loading}>Loading...</div>;
  if (!item) return <div style={styles.loading}>Product not found</div>;

  return (
    <div style={styles.page}>
      <LeaveGuard when={dirtySections.length > 0} />
      <StickyPageTop>
        <button style={styles.back} onClick={() => navigate('/offers?tab=products')}>← Back to Offerings</button>

        {/* Header */}
        <div style={styles.profileHeader}>
          <div style={styles.headerInfo}>
            <h1 style={styles.name}>{item.name}</h1>
            {item.sku && <span style={styles.sku}>SKU: {item.sku}</span>}
          </div>
          <div style={styles.headerRight}>
            <div style={styles.saveRow}><SaveChanges /></div>
            <div style={styles.saveRow}>
              <Badge variant={STATUS_VARIANTS[item.status] || 'neutral'}>{item.status}</Badge>
              <span style={styles.price}>{formatCurrency(item.price)}</span>
            </div>
          </div>
        </div>
      </StickyPageTop>

      {/* Content */}
      <ProductForm item={item} categories={categories} businessId={businessId} onUpdate={setItem} />
      <ProductImage item={item} businessId={businessId} onUpdate={setItem} />
      <VariantsCard merchandiseId={item.id} />
    </div>
  );
}

// --- Product Form (always editable; saved with the page's Save changes) ---

function ProductForm({ item, categories, businessId, onUpdate }: { item: Merchandise; categories: ServiceCategory[]; businessId: string; onUpdate: (m: Merchandise) => void }) {
  const fromItem = (m: Merchandise) => ({
    name: m.name,
    description: m.description || '',
    short_description: m.short_description || '',
    sku: m.sku || '',
    price: m.price,
    category_id: m.category_id || '',
    display_order: m.display_order,
    is_taxable: (m as any).is_taxable || false,
    tax_category_id: m.tax_category_id || '',
  });
  const draft = useDraft('product-details', 'Product details', fromItem(item), async (form) => {
    const payload = {
      ...form,
      category_id: form.category_id || null,
      tax_category_id: form.tax_category_id || null,
      sku: form.sku || null,
      description: form.description || null,
      short_description: form.short_description || null,
    };
    const res = await apiClient.put(`/v1/merchandise/${item.id}?business_id=${businessId}`, payload);
    onUpdate({ ...item, ...res.data.data });
    return fromItem({ ...item, ...res.data.data });
  });
  const form = draft.value;
  const setForm = draft.setValue;
  const mark = (key: keyof typeof form) => fieldMark(draft.changed((v) => v[key]));
  const [priceDisplay, setPriceDisplay] = useState((item.price / 100).toFixed(2));
  // The price box follows the stored price after a save.
  useEffect(() => { setPriceDisplay((draft.saved.price / 100).toFixed(2)); }, [draft.saved.price]);
  const [statusChanging, setStatusChanging] = useState(false);
  const [taxCategories, setTaxCategories] = useState<any[]>([]);

  // Fetch tax categories
  useEffect(() => {
    servicesApi.getTaxCategories(businessId).then(setTaxCategories).catch(() => []);
  }, [businessId]);

  const handleStatusAction = async (action: string) => {
    setStatusChanging(true);
    try {
      await apiClient.put(`/v1/merchandise/${item.id}/${action}?business_id=${businessId}`);
      const res = await apiClient.get(`/v1/merchandise/${item.id}?business_id=${businessId}`);
      onUpdate(res.data.data);
    } catch { alert(`Failed to ${action}`); }
    finally { setStatusChanging(false); }
  };

  return (
    <>
      {/* Actions bar */}
      <div style={styles.actionsBar}>
        <div style={{ display: 'flex', gap: '8px' }}>
          {item.status === 'active' && <Button variant="secondary" size="sm" onClick={() => handleStatusAction('pause')} loading={statusChanging}>Pause</Button>}
          {item.status === 'paused' && <Button variant="secondary" size="sm" onClick={() => handleStatusAction('activate')} loading={statusChanging}>Activate</Button>}
          {item.status !== 'archived' && <Button variant="destructive" size="sm" onClick={() => handleStatusAction('archive')} loading={statusChanging}>Archive</Button>}
          {item.status === 'archived' && <Button variant="secondary" size="sm" onClick={() => handleStatusAction('restore')} loading={statusChanging}>Restore</Button>}
        </div>
      </div>

      {/* Details card */}
      <div style={{ ...styles.card, ...draftBox(draft.dirty) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ ...styles.cardTitle, margin: 0 }}>Product Details<UnsavedTag dirty={draft.dirty} /></h3>
          <Button size="sm" variant="secondary" onClick={() => { /* TODO: trigger translation for short_description and description */ }}>Translate</Button>
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
            <label style={styles.label}>Price *</label>
            <input style={{ ...styles.input, ...mark('price') }} type="number" step="0.01" min="0" value={priceDisplay}
              onChange={(e) => { setPriceDisplay(e.target.value); setForm({ ...form, price: Math.round(parseFloat(e.target.value || '0') * 100) || 0 }); }}
              onBlur={() => setPriceDisplay((form.price / 100).toFixed(2))}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>SKU</label>
            <input style={{ ...styles.input, ...mark('sku') }} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
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

// --- Product Image (a new or removed image waits for the page's Save changes) ---

function ProductImage({ item, businessId, onUpdate }: { item: Merchandise; businessId: string; onUpdate: (m: Merchandise) => void }) {
  type Pending = { file: File | null; url: string; remove: boolean };
  const none: Pending = { file: null, url: '', remove: false };
  const draft = useDraft<Pending>('product-image', 'Product image', none, async (d) => {
    if (d.file) {
      const formData = new FormData();
      formData.append('image', d.file);
      await apiClient.post(`/v1/merchandise/${item.id}/image?business_id=${businessId}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // Refresh item to get updated image_url
      const res = await apiClient.get(`/v1/merchandise/${item.id}?business_id=${businessId}`);
      onUpdate(res.data.data);
    } else if (d.remove) {
      await apiClient.delete(`/v1/merchandise/${item.id}/image?business_id=${businessId}`);
      onUpdate({ ...item, image_url: undefined });
    }
    return none;
  });
  const pending = draft.value;

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    draft.setValue({ file, url: URL.createObjectURL(file), remove: false });
    e.target.value = '';
  };
  const shown = pending.file ? pending.url : item.image_url && !pending.remove ? `/storage/${item.image_url}` : '';

  return (
    <div style={{ ...styles.card, ...draftBox(draft.dirty) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Product Image<UnsavedTag dirty={draft.dirty} /></h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', cursor: 'pointer', color: 'var(--color-text)' }}>
            {shown ? 'Replace' : 'Upload'}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePick} style={{ display: 'none' }} />
          </label>
          {draft.dirty
            ? <button onClick={() => draft.setValue(none)} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 12px', fontSize: 'var(--font-size-sm)', cursor: 'pointer', color: 'var(--color-text)' }}>Undo</button>
            : item.image_url && (
              <button onClick={() => draft.setValue({ ...none, remove: true })} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 12px', fontSize: 'var(--font-size-sm)', cursor: 'pointer', color: 'var(--color-error)' }}>Remove</button>
            )}
        </div>
      </div>
      {shown ? (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
          <img src={shown} alt={item.name} style={{ maxWidth: '200px', maxHeight: '200px', borderRadius: 'var(--radius-md)', objectFit: 'cover', border: '1px solid var(--color-border)' }} />
          {pending.file && <RowTag>New image · saved with Save changes</RowTag>}
        </div>
      ) : (
        <p style={styles.muted}>{pending.remove ? <RowTag>Image removed when you save</RowTag> : 'No image uploaded'}</p>
      )}
      <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', margin: '8px 0 0' }}>Accepted: JPEG, PNG, or WebP. Max 5MB. Recommended: at least 600×600px.</p>
    </div>
  );
}

// --- Variants Card (add/edit in a window; saved with the page's Save changes) ---

type VariantData = Pick<MerchVariant, 'name' | 'sku' | 'price'>;
const variantData = (v: VariantData) => ({ name: v.name, sku: v.sku || undefined, price: v.price });

function VariantsCard({ merchandiseId }: { merchandiseId: string }) {
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ key?: string; variant?: MerchVariant } | null>(null);
  const list = useDraftList<MerchVariant>('product-variants', 'Variants', {
    create: (v) => apiClient.post(`/v1/merchandise/${merchandiseId}/variants`, variantData(v)).then((r) => r.data.data),
    update: (v) => apiClient.put(`/v1/merchandise/${merchandiseId}/variants/${v.id}`, variantData(v)).then((r) => r.data.data),
    remove: (v) => apiClient.delete(`/v1/merchandise/${merchandiseId}/variants/${v.id}`).then(() => undefined),
  });

  const fetchVariants = useCallback(async () => {
    try {
      const res = await apiClient.get(`/v1/merchandise/${merchandiseId}/variants`);
      list.load(res.data.data || []);
    } catch { list.load([]); }
    finally { setLoading(false); }
  }, [merchandiseId, list.load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchVariants(); }, [fetchVariants]);

  return (
    <div style={{ ...styles.card, ...draftBox(list.dirty) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Variants<UnsavedTag dirty={list.dirty} /></h3>
        <Button size="sm" variant="secondary" onClick={() => setEditing({})}>Add Variant</Button>
      </div>

      {/* Add/Edit Variant Modal */}
      {editing && (
        <VariantModal
          variant={editing.variant}
          onClose={() => setEditing(null)}
          onDone={(data) => {
            if (editing.key) list.edit(editing.key, data);
            else list.add({ ...data, status: 'active' } as MerchVariant);
            setEditing(null);
          }}
        />
      )}

      {loading && <p style={styles.muted}>Loading...</p>}
      {!loading && list.rows.length === 0 && <p style={styles.muted}>No variants defined. Product uses its base price.</p>}
      {list.rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {list.rows.map((r) => {
            const v = r.item;
            const edited = !r.isNew && !r.deleted && list.changed(r, (x) => variantData(x));
            return (
              <div key={r.key} style={{ ...styles.variantRow, opacity: r.deleted ? 0.6 : 1, ...(edited ? fieldMark(true) : {}) }}>
                <div style={{ flex: 1, textDecoration: r.deleted ? 'line-through' : 'none' }}>
                  <strong>{v.name}</strong>
                  {v.sku && <span style={{ marginLeft: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>SKU: {v.sku}</span>}
                  {r.isNew && <> <RowTag>New</RowTag></>}
                  {edited && <> <RowTag>Changed</RowTag></>}
                  {r.deleted && <> <RowTag>Deleted when you save</RowTag></>}
                </div>
                <span style={{ fontWeight: 600 }}>{formatCurrency(v.price)}</span>
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
    </div>
  );
}

// --- Variant Modal ---

function VariantModal({ variant, onClose, onDone }: { variant?: MerchVariant; onClose: () => void; onDone: (data: VariantData) => void }) {
  const [form, setForm] = useState({
    name: variant?.name || '',
    sku: variant?.sku || '',
  });
  const [priceDisplay, setPriceDisplay] = useState(variant ? (variant.price / 100).toFixed(2) : '0.00');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) { setError('Name is required'); return; }
    onDone({ name: form.name, sku: form.sku || undefined, price: Math.round(parseFloat(priceDisplay || '0') * 100) });
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
            <label style={styles.label}>Name * (e.g., "Small", "Red", "500ml")</label>
            <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Price *</label>
            <input style={styles.input} type="number" step="0.01" min="0" value={priceDisplay}
              onChange={(e) => setPriceDisplay(e.target.value)}
              onBlur={() => setPriceDisplay((Math.round(parseFloat(priceDisplay || '0') * 100) / 100).toFixed(2))}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>SKU</label>
            <input style={styles.input} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="Optional" />
          </div>
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

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '900px', margin: '0 auto' },
  loading: { padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--color-text-secondary)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  profileHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-lg)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-md)' },
  headerInfo: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  name: { margin: 0, fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)' },
  sku: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  headerRight: { display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', gap: '6px' },
  saveRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' },
  price: { fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)' },
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
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '450px', maxHeight: '85vh', overflow: 'auto', border: '1px solid var(--color-border)', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)' },
  closeBtn: { background: 'none', border: 'none', fontSize: 'var(--font-size-xl)', cursor: 'pointer', color: 'var(--color-text-secondary)' },
};
