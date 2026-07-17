import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
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

export function MerchandiseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [item, setItem] = useState<Merchandise | null>(null);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);

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
      <button style={styles.back} onClick={() => navigate('/offers')}>← Back to Offerings</button>

      {/* Header */}
      <div style={styles.profileHeader}>
        <div style={styles.headerInfo}>
          <h1 style={styles.name}>{item.name}</h1>
          {item.sku && <span style={styles.sku}>SKU: {item.sku}</span>}
        </div>
        <div style={styles.headerRight}>
          <Badge variant={STATUS_VARIANTS[item.status] || 'neutral'}>{item.status}</Badge>
          <span style={styles.price}>{formatCurrency(item.price)}</span>
        </div>
      </div>

      {/* Content */}
      <ProductForm item={item} categories={categories} businessId={businessId} onUpdate={setItem} />
      <ProductImage item={item} businessId={businessId} onUpdate={setItem} />
      <VariantsCard merchandiseId={item.id} />
    </div>
  );
}

// --- Product Form (always editable) ---

function ProductForm({ item, categories, businessId, onUpdate }: { item: Merchandise; categories: ServiceCategory[]; businessId: string; onUpdate: (m: Merchandise) => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: item.name,
    description: item.description || '',
    short_description: item.short_description || '',
    sku: item.sku || '',
    price: item.price,
    category_id: item.category_id || '',
    display_order: item.display_order,
    is_taxable: (item as any).is_taxable || false,
    tax_category_id: item.tax_category_id || '',
  });
  const [priceDisplay, setPriceDisplay] = useState((item.price / 100).toFixed(2));
  const [statusChanging, setStatusChanging] = useState(false);
  const [taxCategories, setTaxCategories] = useState<any[]>([]);

  // Fetch tax categories
  useEffect(() => {
    servicesApi.getTaxCategories(businessId).then(setTaxCategories).catch(() => []);
  }, [businessId]);

  const isDirty = form.name !== item.name ||
    form.description !== (item.description || '') ||
    form.short_description !== (item.short_description || '') ||
    form.sku !== (item.sku || '') ||
    form.price !== item.price ||
    form.category_id !== (item.category_id || '') ||
    form.display_order !== item.display_order ||
    form.is_taxable !== ((item as any).is_taxable || false) ||
    form.tax_category_id !== (item.tax_category_id || '');

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiClient.put(`/v1/merchandise/${item.id}?business_id=${businessId}`, form);
      onUpdate(res.data.data);
    } catch { alert('Failed to save changes'); }
    finally { setSaving(false); }
  };

  const handleDiscard = () => {
    setForm({
      name: item.name,
      description: item.description || '',
      short_description: item.short_description || '',
      sku: item.sku || '',
      price: item.price,
      category_id: item.category_id || '',
      display_order: item.display_order,
      is_taxable: (item as any).is_taxable || false,
      tax_category_id: item.tax_category_id || '',
    });
    setPriceDisplay((item.price / 100).toFixed(2));
  };

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

      {/* Details card */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ ...styles.cardTitle, margin: 0 }}>Product Details</h3>
          <Button size="sm" variant="secondary" onClick={() => { /* TODO: trigger translation for short_description and description */ }}>Translate</Button>
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
            <label style={styles.label}>Price *</label>
            <input style={styles.input} type="number" step="0.01" min="0" value={priceDisplay}
              onChange={(e) => setPriceDisplay(e.target.value)}
              onBlur={() => { const cents = Math.round(parseFloat(priceDisplay || '0') * 100); setForm({ ...form, price: cents }); setPriceDisplay((cents / 100).toFixed(2)); }}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>SKU</label>
            <input style={styles.input} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          </div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
            <label style={styles.label}>Short Description</label>
            <input style={styles.input} value={form.short_description} onChange={(e) => setForm({ ...form, short_description: e.target.value })} />
          </div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
            <label style={styles.label}>Description</label>
            <textarea style={{ ...styles.input, minHeight: '80px', resize: 'vertical', maxWidth: '100%' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div style={styles.formGroup}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_taxable} onChange={(e) => setForm({ ...form, is_taxable: e.target.checked })} style={{ width: '16px', height: '16px' }} />
              Taxable
            </label>
          </div>
          {form.is_taxable && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Tax Category</label>
              <select style={styles.input} value={form.tax_category_id} onChange={(e) => setForm({ ...form, tax_category_id: e.target.value })}>
                <option value="">Select tax category...</option>
                {taxCategories.map((tc: any) => <option key={tc.id} value={tc.id}>{tc.name} ({(tc.rate / 100).toFixed(2)}%)</option>)}
              </select>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// --- Product Image ---

function ProductImage({ item, businessId, onUpdate }: { item: Merchandise; businessId: string; onUpdate: (m: Merchandise) => void }) {
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      await apiClient.post(`/v1/merchandise/${item.id}/image?business_id=${businessId}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // Refresh item to get updated image_url
      const res = await apiClient.get(`/v1/merchandise/${item.id}?business_id=${businessId}`);
      onUpdate(res.data.data);
    } catch { alert('Failed to upload image'); }
    finally { setUploading(false); }
  };

  const handleDelete = async () => {
    if (!confirm('Remove this product image?')) return;
    try {
      await apiClient.delete(`/v1/merchandise/${item.id}/image?business_id=${businessId}`);
      onUpdate({ ...item, image_url: undefined });
    } catch { alert('Failed to delete image'); }
  };

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Product Image</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '13px', cursor: 'pointer', color: 'var(--color-text)' }}>
            {uploading ? 'Uploading...' : item.image_url ? 'Replace' : 'Upload'}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleUpload} style={{ display: 'none' }} disabled={uploading} />
          </label>
          {item.image_url && (
            <button onClick={handleDelete} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 12px', fontSize: '13px', cursor: 'pointer', color: 'var(--color-error)' }}>Remove</button>
          )}
        </div>
      </div>
      {item.image_url ? (
        <img src={`/storage/${item.image_url}`} alt={item.name} style={{ maxWidth: '200px', maxHeight: '200px', borderRadius: 'var(--radius-md)', objectFit: 'cover', border: '1px solid var(--color-border)' }} />
      ) : (
        <p style={styles.muted}>No image uploaded</p>
      )}
      <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', margin: '8px 0 0' }}>Accepted: JPEG, PNG, or WebP. Max 5MB. Recommended: at least 600×600px.</p>
    </div>
  );
}

// --- Variants Card ---

function VariantsCard({ merchandiseId }: { merchandiseId: string }) {
  const [variants, setVariants] = useState<MerchVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchVariants = useCallback(async () => {
    try {
      const res = await apiClient.get(`/v1/merchandise/${merchandiseId}/variants`);
      setVariants(res.data.data || []);
    } catch { setVariants([]); }
    finally { setLoading(false); }
  }, [merchandiseId]);

  useEffect(() => { fetchVariants(); }, [fetchVariants]);

  const handleDelete = async (variantId: string) => {
    if (!confirm('Delete this variant?')) return;
    await apiClient.delete(`/v1/merchandise/${merchandiseId}/variants/${variantId}`);
    fetchVariants();
  };

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Variants</h3>
        <Button size="sm" variant="secondary" onClick={() => { setShowAdd(true); setEditingId(null); }}>Add Variant</Button>
      </div>

      {/* Add/Edit Variant Modal */}
      {(showAdd || editingId) && (
        <VariantModal
          merchandiseId={merchandiseId}
          variant={editingId ? variants.find((v) => v.id === editingId) : undefined}
          onClose={() => { setShowAdd(false); setEditingId(null); }}
          onSaved={() => { setShowAdd(false); setEditingId(null); fetchVariants(); }}
        />
      )}

      {loading && <p style={styles.muted}>Loading...</p>}
      {!loading && variants.length === 0 && <p style={styles.muted}>No variants defined. Product uses its base price.</p>}
      {variants.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {variants.map((v) => (
            <div key={v.id} style={styles.variantRow}>
              <div style={{ flex: 1 }}>
                <strong>{v.name}</strong>
                {v.sku && <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>SKU: {v.sku}</span>}
              </div>
              <span style={{ fontWeight: 600 }}>{formatCurrency(v.price)}</span>
              <Badge variant={STATUS_VARIANTS[v.status] || 'neutral'}>{v.status}</Badge>
              <button style={styles.editBtn} onClick={() => setEditingId(v.id)} title="Edit">✏️</button>
              <button style={styles.deleteBtn} onClick={() => handleDelete(v.id)} title="Delete">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Variant Modal ---

function VariantModal({ merchandiseId, variant, onClose, onSaved }: { merchandiseId: string; variant?: MerchVariant; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: variant?.name || '',
    sku: variant?.sku || '',
    price: variant?.price || 0,
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
      if (variant) {
        await apiClient.put(`/v1/merchandise/${merchandiseId}/variants/${variant.id}`, {
          name: form.name,
          sku: form.sku || undefined,
          price: form.price,
        });
      } else {
        await apiClient.post(`/v1/merchandise/${merchandiseId}/variants`, {
          name: form.name,
          sku: form.sku || undefined,
          price: form.price,
        });
      }
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save variant');
    } finally {
      setSaving(false);
    }
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
            <label style={styles.label}>Name * (e.g., "Small", "Red", "500ml")</label>
            <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Price *</label>
            <input style={styles.input} type="number" step="0.01" min="0" value={priceDisplay}
              onChange={(e) => setPriceDisplay(e.target.value)}
              onBlur={() => { const cents = Math.round(parseFloat(priceDisplay || '0') * 100); setForm({ ...form, price: cents }); setPriceDisplay((cents / 100).toFixed(2)); }}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>SKU</label>
            <input style={styles.input} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="Optional" />
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={saving}>{variant ? 'Save Changes' : 'Add Variant'}</Button>
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
  name: { margin: 0, fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)' },
  sku: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  headerRight: { display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', gap: '4px' },
  price: { fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)' },
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
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '450px', maxHeight: '85vh', overflow: 'auto', border: '1px solid var(--color-border)', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--color-text)' },
  closeBtn: { background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--color-text-secondary)' },
};
