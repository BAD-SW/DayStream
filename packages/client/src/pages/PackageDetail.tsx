import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { apiClient } from '../api/client';
import { formatCurrency } from '../utils/currency';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success', paused: 'warning', archived: 'neutral',
};

export function PackageDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [pkg, setPkg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!id || !businessId) return;
    setLoading(true);
    apiClient.get(`/v1/packages/${id}?business_id=${businessId}`)
      .then((res) => setPkg(res.data.data))
      .catch(() => setPkg(null))
      .finally(() => setLoading(false));
  }, [id, businessId]);

  if (loading) return <div style={styles.loading}>Loading...</div>;
  if (!pkg) return <div style={styles.loading}>Package not found</div>;

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/offers?tab=packages')}>← Back to Offerings</button>
      <div style={styles.headerCard}>
        <div style={styles.headerInfo}>
          <h1 style={styles.name}>{pkg.name}</h1>
          <span style={styles.sub}>{pkg.expiration_type === 'none' ? 'Never expires' : `Expires ${pkg.expiration_days} ${pkg.expiration_unit || 'days'} after purchase`}</span>
        </div>
        <div style={styles.headerRight}>
          <Badge variant={STATUS_VARIANTS[pkg.status] || 'neutral'}>{pkg.status}</Badge>
          <span style={styles.price}>{formatCurrency(pkg.price)}</span>
          <span style={styles.sold}>{pkg.active_purchases || 0} sold</span>
        </div>
      </div>
      <PackageForm pkg={pkg} businessId={businessId} onUpdate={setPkg} />
      <PackageItemsCard packageId={pkg.id} />
    </div>
  );
}

function PackageForm({ pkg, businessId, onUpdate }: { pkg: any; businessId: string; onUpdate: (p: any) => void }) {
  const [saving, setSaving] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [priceDisplay, setPriceDisplay] = useState((pkg.price / 100).toFixed(2));
  const [taxCategories, setTaxCategories] = useState<any[]>([]);

  useEffect(() => {
    apiClient.get(`/v1/services/tax-categories?business_id=${businessId}`).then((res) => setTaxCategories(res.data.data || [])).catch(() => {});
  }, [businessId]);

  const [form, setForm] = useState({
    name: pkg.name, description: pkg.description || '', short_description: pkg.short_description || '',
    price: pkg.price, expiration_type: pkg.expiration_type || 'none',
    expiration_days: pkg.expiration_days ? String(pkg.expiration_days) : '',
    expiration_unit: pkg.expiration_unit || 'days',
    is_taxable: pkg.is_taxable || false, tax_category_id: pkg.tax_category_id || '',
    new_customers_only: pkg.new_customers_only || false,
  });

  const isDirty = form.name !== pkg.name || form.description !== (pkg.description || '') ||
    form.short_description !== (pkg.short_description || '') || form.price !== pkg.price ||
    form.expiration_type !== (pkg.expiration_type || 'none') ||
    form.expiration_days !== (pkg.expiration_days ? String(pkg.expiration_days) : '') ||
    form.expiration_unit !== (pkg.expiration_unit || 'days') ||
    form.is_taxable !== (pkg.is_taxable || false) || form.tax_category_id !== (pkg.tax_category_id || '') ||
    form.new_customers_only !== (pkg.new_customers_only || false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = { ...form, expiration_days: form.expiration_days ? parseInt(form.expiration_days) : null };
      const res = await apiClient.put(`/v1/packages/${pkg.id}?business_id=${businessId}`, data);
      onUpdate(res.data.data);
      setPriceDisplay((form.price / 100).toFixed(2));
    } catch { alert('Failed to save'); }
    finally { setSaving(false); }
  };

  const handleDiscard = () => {
    setForm({ name: pkg.name, description: pkg.description || '', short_description: pkg.short_description || '',
      price: pkg.price, expiration_type: pkg.expiration_type || 'none',
      expiration_days: pkg.expiration_days ? String(pkg.expiration_days) : '',
      expiration_unit: pkg.expiration_unit || 'days',
      is_taxable: pkg.is_taxable || false, tax_category_id: pkg.tax_category_id || '',
      new_customers_only: pkg.new_customers_only || false });
    setPriceDisplay((pkg.price / 100).toFixed(2));
  };

  const handleStatus = async (action: string) => {
    setStatusChanging(true);
    try {
      await apiClient.put(`/v1/packages/${pkg.id}/${action}?business_id=${businessId}`);
      const res = await apiClient.get(`/v1/packages/${pkg.id}?business_id=${businessId}`);
      onUpdate(res.data.data);
    } catch { alert(`Failed to ${action}`); }
    finally { setStatusChanging(false); }
  };

  return (
    <>
      <div style={styles.actionsBar}>
        {pkg.status === 'active' && <Button variant="secondary" size="sm" onClick={() => handleStatus('pause')} loading={statusChanging}>Pause</Button>}
        {(pkg.status === 'paused' || pkg.status === 'archived') && <Button variant="secondary" size="sm" onClick={() => handleStatus('activate')} loading={statusChanging}>Activate</Button>}
        {pkg.status !== 'archived' && <Button variant="destructive" size="sm" onClick={() => handleStatus('archive')} loading={statusChanging}>Archive</Button>}
      </div>
      {isDirty && (
        <div style={styles.saveBar}>
          <span style={{ fontSize: '13px', color: 'var(--color-text)' }}>You have unsaved changes</span>
          <div style={{ display: 'flex', gap: '8px' }}><Button variant="outline" size="sm" onClick={handleDiscard}>Discard</Button><Button size="sm" onClick={handleSave} loading={saving}>Save Changes</Button></div>
        </div>
      )}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ ...styles.cardTitle, margin: 0 }}>Package Details</h3>
          <Button size="sm" variant="secondary" onClick={() => {}}>Translate</Button>
        </div>
        <div style={styles.formGrid}>
          <div style={styles.formGroup}><label style={styles.label}>Name *</label><input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Price *</label>
            <input style={styles.input} type="number" step="0.01" min="0" value={priceDisplay}
              onChange={(e) => setPriceDisplay(e.target.value)}
              onBlur={() => { const cents = Math.round(parseFloat(priceDisplay || '0') * 100); setForm({ ...form, price: cents }); setPriceDisplay((cents / 100).toFixed(2)); }} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Expiration</label>
            <select style={styles.input} value={form.expiration_type} onChange={(e) => setForm({ ...form, expiration_type: e.target.value })}>
              <option value="none">Never expires</option>
              <option value="days_from_purchase">From purchase date</option>
            </select>
          </div>
          {form.expiration_type === 'days_from_purchase' && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Expires after</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input style={{ ...styles.input, flex: 1 }} type="number" min="1" value={form.expiration_days} onChange={(e) => setForm({ ...form, expiration_days: e.target.value })} />
                <select style={{ ...styles.input, width: '120px' }} value={form.expiration_unit} onChange={(e) => setForm({ ...form, expiration_unit: e.target.value })}>
                  <option value="days">Days</option>
                  <option value="weeks">Weeks</option>
                  <option value="months">Months</option>
                </select>
              </div>
            </div>
          )}
          <div style={styles.formGroup}>
            <label style={styles.label}>Tax Category</label>
            <select style={styles.input} value={form.tax_category_id} onChange={(e) => setForm({ ...form, tax_category_id: e.target.value })}>
              <option value="">No tax</option>
              {taxCategories.map((tc: any) => <option key={tc.id} value={tc.id}>{tc.name} ({(tc.rate / 100).toFixed(2)}%)</option>)}
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>&nbsp;</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer', paddingTop: '4px' }}>
              <input type="checkbox" checked={form.new_customers_only} onChange={(e) => setForm({ ...form, new_customers_only: e.target.checked })} style={{ width: '16px', height: '16px' }} /> New customers only (intro offer)
            </label>
          </div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}><label style={styles.label}>Short Description</label><input style={styles.input} value={form.short_description} onChange={(e) => setForm({ ...form, short_description: e.target.value })} /></div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}><label style={styles.label}>Description</label><textarea style={{ ...styles.input, minHeight: '80px', resize: 'vertical', maxWidth: '100%' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>
      </div>
    </>
  );
}

function PackageItemsCard({ packageId }: { packageId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);

  const fetchItems = useCallback(async () => {
    try { const res = await apiClient.get(`/v1/packages/${packageId}/items`); setItems(res.data.data || []); }
    catch { setItems([]); } finally { setLoading(false); }
  }, [packageId]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleDelete = async (itemId: string) => {
    if (!confirm('Remove this item?')) return;
    await apiClient.delete(`/v1/packages/${packageId}/items/${itemId}`);
    fetchItems();
  };

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Included Items</h3>
        <Button size="sm" variant="secondary" onClick={() => { setEditingItem(null); setShowAdd(true); }}>Add Item</Button>
      </div>
      {loading && <p style={styles.muted}>Loading...</p>}
      {!loading && items.length === 0 && <p style={styles.muted}>No items in this package. Add services or products that the customer receives.</p>}
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {items.map((item: any) => (
            <div key={item.id} style={styles.itemRow}>
              <div style={{ flex: 1 }}><Badge variant={item.item_type === 'service' ? 'info' : 'neutral'}>{item.item_type === 'service' ? 'Service' : 'Product'}</Badge><strong style={{ marginLeft: '8px' }}>{item.service_name || item.merchandise_name || 'Unknown'}</strong></div>
              <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>{item.redemption_type === 'minutes' ? `${item.quantity} min` : `×${item.quantity}`}</span>
              <button style={styles.editBtn} onClick={() => setEditingItem(item)} title="Edit">✏️</button>
              <button style={styles.deleteBtn} onClick={() => handleDelete(item.id)} title="Remove">×</button>
            </div>
          ))}
        </div>
      )}
      {(showAdd || editingItem) && (
        <AddEditPackageItemModal packageId={packageId} item={editingItem} onClose={() => { setShowAdd(false); setEditingItem(null); }} onSaved={() => { setShowAdd(false); setEditingItem(null); fetchItems(); }} />
      )}
    </div>
  );
}

function AddEditPackageItemModal({ packageId, item, onClose, onSaved }: { packageId: string; item: any; onClose: () => void; onSaved: () => void }) {
  const businessId = localStorage.getItem('business_id') || '';
  const [itemType, setItemType] = useState<'service' | 'merchandise'>(item?.item_type || 'service');
  const [redemptionType, setRedemptionType] = useState<'sessions' | 'minutes'>(item?.redemption_type || 'sessions');
  const [services, setServices] = useState<any[]>([]);
  const [merchandise, setMerchandise] = useState<any[]>([]);
  const [variants, setVariants] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState(item?.service_id || item?.merchandise_id || '');
  const [selectedVariantId, setSelectedVariantId] = useState(item?.variant_id || '');
  const [quantity, setQuantity] = useState(item?.quantity || 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isEditing = !!item;

  useEffect(() => {
    apiClient.get(`/v1/services?business_id=${businessId}&status=active&limit=100`).then((r) => setServices(r.data.data || [])).catch(() => {});
    apiClient.get(`/v1/merchandise?business_id=${businessId}&status=active&limit=100`).then((r) => setMerchandise(r.data.data || [])).catch(() => {});
  }, [businessId]);

  useEffect(() => {
    if (!selectedId) { setVariants([]); if (!isEditing) setSelectedVariantId(''); return; }
    const url = itemType === 'service' ? `/v1/services/${selectedId}/variants` : `/v1/merchandise/${selectedId}/variants`;
    apiClient.get(url).then((r) => setVariants(r.data.data || [])).catch(() => setVariants([]));
    if (!isEditing) setSelectedVariantId('');
  }, [selectedId, itemType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId && !isEditing) { setError('Select an item'); return; }
    setSaving(true); setError('');
    try {
      if (isEditing) {
        await apiClient.put(`/v1/packages/${packageId}/items/${item.id}`, {
          quantity,
          variant_id: redemptionType === 'minutes' ? null : (selectedVariantId || null),
          redemption_type: redemptionType,
        });
      } else {
        await apiClient.post(`/v1/packages/${packageId}/items`, {
          item_type: itemType, service_id: itemType === 'service' ? selectedId : undefined,
          merchandise_id: itemType === 'merchandise' ? selectedId : undefined,
          variant_id: redemptionType === 'minutes' ? undefined : (selectedVariantId || undefined),
          quantity,
          redemption_type: redemptionType,
        });
      }
      onSaved();
    } catch (err: any) { setError(err.response?.data?.error || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const options = itemType === 'service' ? services : merchandise;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}><h3 style={styles.modalTitle}>{isEditing ? 'Edit Item' : 'Add Item'}</h3><button style={styles.closeBtn} onClick={onClose}>×</button></div>
        {error && <p style={{ color: 'var(--color-error)', fontSize: '13px', margin: '0 0 8px' }}>{error}</p>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={styles.formGroup}><label style={styles.label}>Type</label><select style={styles.input} value={itemType} disabled={isEditing} onChange={(e) => { setItemType(e.target.value as any); setSelectedId(''); }}><option value="service">Service</option><option value="merchandise">Product</option></select></div>
          <div style={styles.formGroup}><label style={styles.label}>{itemType === 'service' ? 'Service' : 'Product'} *</label><select style={styles.input} value={selectedId} disabled={isEditing} onChange={(e) => setSelectedId(e.target.value)} required><option value="">Select...</option>{options.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          {itemType === 'service' && (
            <div style={styles.formGroup}><label style={styles.label}>Redemption Mode</label><select style={styles.input} value={redemptionType} onChange={(e) => { setRedemptionType(e.target.value as any); if (e.target.value === 'minutes') setSelectedVariantId(''); }}><option value="sessions">Fixed sessions (specific variant)</option><option value="minutes">Time pool (total minutes, any variant)</option></select></div>
          )}
          {redemptionType === 'sessions' && variants.length > 0 && (<div style={styles.formGroup}><label style={styles.label}>Variant</label><select style={styles.input} value={selectedVariantId} onChange={(e) => setSelectedVariantId(e.target.value)}><option value="">All / any</option>{variants.map((v: any) => <option key={v.id} value={v.id}>{v.name}{v.price != null ? ` — ${formatCurrency(v.price)}` : ''}</option>)}</select></div>)}
          <div style={styles.formGroup}><label style={styles.label}>{redemptionType === 'minutes' ? 'Total Minutes' : 'Quantity (sessions)'}</label><input style={styles.input} type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />{redemptionType === 'minutes' && <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>{quantity >= 60 ? `${Math.floor(quantity / 60)}h ${quantity % 60 > 0 ? `${quantity % 60}m` : ''}` : `${quantity}m`}</span>}</div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}>{isEditing ? 'Save' : 'Add Item'}</Button></div>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '900px', margin: '0 auto' },
  loading: { padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--color-text-secondary)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  headerCard: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-lg)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-md)' },
  headerInfo: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  name: { margin: 0, fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)' },
  sub: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  headerRight: { display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', gap: '4px' },
  price: { fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)' },
  sold: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  actionsBar: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: 'var(--space-md)' },
  saveBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-sm) var(--space-md)', marginBottom: 'var(--space-md)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-primary)' },
  card: { padding: 'var(--space-lg)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-md)' },
  cardTitle: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' },
  input: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: '14px', width: '100%', boxSizing: 'border-box' as const, fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)' },
  muted: { fontSize: '14px', color: 'var(--color-text-secondary)', margin: 0 },
  itemRow: { display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '14px' },
  editBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '2px 4px' },
  deleteBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: 'var(--color-error)', padding: '2px 6px', lineHeight: 1 },
  overlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '450px', maxHeight: '85vh', overflow: 'auto', border: '1px solid var(--color-border)', boxShadow: '0 10px 25px rgba(0,0,0,0.3)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--color-text)' },
  closeBtn: { background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--color-text-secondary)' },
};
