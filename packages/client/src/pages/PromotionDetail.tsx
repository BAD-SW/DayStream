import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { apiClient } from '../api/client';
import { formatCurrency } from '../utils/currency';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success', paused: 'warning', expired: 'error', archived: 'neutral',
};

const PROMO_TYPE_LABELS: Record<string, string> = {
  discount_percentage: 'Percentage Discount',
  discount_fixed: 'Fixed Amount Discount',
  price_override: 'Price Override',
  premium_percentage: 'Percentage Premium',
  premium_fixed: 'Fixed Amount Premium',
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function PromotionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [promo, setPromo] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!id || !businessId) return;
    setLoading(true);
    apiClient.get(`/v1/promotions/${id}?business_id=${businessId}`)
      .then((res) => setPromo(res.data.data))
      .catch(() => setPromo(null))
      .finally(() => setLoading(false));
  }, [id, businessId]);

  if (loading) return <div style={styles.loading}>Loading...</div>;
  if (!promo) return <div style={styles.loading}>Promotion not found</div>;

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/offers')}>← Back to Offerings</button>

      {/* Header */}
      <div style={styles.headerCard}>
        <div style={styles.headerInfo}>
          <h1 style={styles.name}>{promo.name}</h1>
          {promo.promo_code && <span style={styles.code}>Code: {promo.promo_code}</span>}
        </div>
        <div style={styles.headerRight}>
          <Badge variant={STATUS_VARIANTS[promo.status] || 'neutral'}>{promo.status}</Badge>
          <span style={styles.value}>
            {promo.type.includes('percentage') ? `${promo.value}%` : formatCurrency(promo.value)}
          </span>
          <span style={styles.typeLabel}>{PROMO_TYPE_LABELS[promo.type]}</span>
        </div>
      </div>

      <PromotionForm promo={promo} businessId={businessId} onUpdate={setPromo} />
    </div>
  );
}

function PromotionForm({ promo, businessId, onUpdate }: { promo: any; businessId: string; onUpdate: (p: any) => void }) {
  const [saving, setSaving] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [form, setForm] = useState({
    name: promo.name,
    description: promo.description || '',
    type: promo.type,
    value: promo.value,
    promo_code: promo.promo_code || '',
    date_from: promo.date_from ? promo.date_from.split('T')[0] : '',
    date_to: promo.date_to ? promo.date_to.split('T')[0] : '',
    days_of_week: promo.days_of_week || [],
    time_from: promo.time_from || '',
    time_to: promo.time_to || '',
    applies_to: promo.applies_to || 'all',
    max_redemptions: promo.max_redemptions ? String(promo.max_redemptions) : '',
    max_per_customer: promo.max_per_customer ? String(promo.max_per_customer) : '',
    priority: promo.priority || 0,
    stackable: promo.stackable || false,
  });

  const isDirty = form.name !== promo.name ||
    form.description !== (promo.description || '') ||
    form.type !== promo.type ||
    form.value !== promo.value ||
    form.promo_code !== (promo.promo_code || '') ||
    form.date_from !== (promo.date_from ? promo.date_from.split('T')[0] : '') ||
    form.date_to !== (promo.date_to ? promo.date_to.split('T')[0] : '') ||
    JSON.stringify(form.days_of_week) !== JSON.stringify(promo.days_of_week || []) ||
    form.time_from !== (promo.time_from || '') ||
    form.time_to !== (promo.time_to || '') ||
    form.applies_to !== (promo.applies_to || 'all') ||
    form.max_redemptions !== (promo.max_redemptions ? String(promo.max_redemptions) : '') ||
    form.max_per_customer !== (promo.max_per_customer ? String(promo.max_per_customer) : '') ||
    form.priority !== (promo.priority || 0) ||
    form.stackable !== (promo.stackable || false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const data: any = { ...form };
      data.value = form.type.includes('percentage') ? form.value : form.value;
      data.max_redemptions = form.max_redemptions ? parseInt(form.max_redemptions) : null;
      data.max_per_customer = form.max_per_customer ? parseInt(form.max_per_customer) : null;
      const res = await apiClient.put(`/v1/promotions/${promo.id}?business_id=${businessId}`, data);
      onUpdate(res.data.data);
    } catch { alert('Failed to save changes'); }
    finally { setSaving(false); }
  };

  const handleDiscard = () => {
    setForm({
      name: promo.name, description: promo.description || '', type: promo.type, value: promo.value,
      promo_code: promo.promo_code || '',
      date_from: promo.date_from ? promo.date_from.split('T')[0] : '',
      date_to: promo.date_to ? promo.date_to.split('T')[0] : '',
      days_of_week: promo.days_of_week || [],
      time_from: promo.time_from || '', time_to: promo.time_to || '',
      applies_to: promo.applies_to || 'all',
      max_redemptions: promo.max_redemptions ? String(promo.max_redemptions) : '',
      max_per_customer: promo.max_per_customer ? String(promo.max_per_customer) : '',
      priority: promo.priority || 0, stackable: promo.stackable || false,
    });
  };

  const handleStatusAction = async (action: string) => {
    setStatusChanging(true);
    try {
      await apiClient.put(`/v1/promotions/${promo.id}/${action}?business_id=${businessId}`);
      const res = await apiClient.get(`/v1/promotions/${promo.id}?business_id=${businessId}`);
      onUpdate(res.data.data);
    } catch { alert(`Failed to ${action}`); }
    finally { setStatusChanging(false); }
  };

  const toggleDay = (day: number) => {
    setForm({ ...form, days_of_week: form.days_of_week.includes(day) ? form.days_of_week.filter((d: number) => d !== day) : [...form.days_of_week, day] });
  };

  return (
    <>
      {/* Actions */}
      <div style={styles.actionsBar}>
        {promo.status === 'active' && <Button variant="secondary" size="sm" onClick={() => handleStatusAction('pause')} loading={statusChanging}>Pause</Button>}
        {(promo.status === 'paused' || promo.status === 'expired') && <Button variant="secondary" size="sm" onClick={() => handleStatusAction('activate')} loading={statusChanging}>Activate</Button>}
        {promo.status !== 'archived' && <Button variant="destructive" size="sm" onClick={() => handleStatusAction('archive')} loading={statusChanging}>Archive</Button>}
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

      {/* Details Card */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Promotion Details</h3>
        <div style={styles.formGrid}>
          <div style={styles.formGroup}><label style={styles.label}>Name *</label><input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Type *</label>
            <select style={styles.input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="discount_percentage">Percentage Discount</option>
              <option value="discount_fixed">Fixed Amount Discount</option>
              <option value="price_override">Price Override</option>
              <option value="premium_percentage">Percentage Premium</option>
              <option value="premium_fixed">Fixed Amount Premium</option>
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{form.type.includes('percentage') ? 'Percentage' : 'Amount (cents)'}</label>
            <input style={styles.input} type="number" min="0" value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} />
          </div>
          <div style={styles.formGroup}><label style={styles.label}>Promo Code</label><input style={styles.input} value={form.promo_code} onChange={(e) => setForm({ ...form, promo_code: e.target.value.toUpperCase() })} placeholder="Auto-applies if empty" /></div>
          <div style={styles.formGroup}><label style={styles.label}>Start Date</label><input style={styles.input} type="date" value={form.date_from} onChange={(e) => setForm({ ...form, date_from: e.target.value })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>End Date</label><input style={styles.input} type="date" value={form.date_to} onChange={(e) => setForm({ ...form, date_to: e.target.value })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>Time From</label><input style={styles.input} type="time" value={form.time_from} onChange={(e) => setForm({ ...form, time_from: e.target.value })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>Time To</label><input style={styles.input} type="time" value={form.time_to} onChange={(e) => setForm({ ...form, time_to: e.target.value })} /></div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
            <label style={styles.label}>Days of Week</label>
            <div style={{ display: 'flex', gap: '4px' }}>
              {DAY_NAMES.map((name, idx) => (
                <button key={idx} type="button" onClick={() => toggleDay(idx)}
                  style={{ padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: form.days_of_week.includes(idx) ? 'var(--color-accent, #C9A96E)' : 'var(--color-background)', color: form.days_of_week.includes(idx) ? '#1A1A1A' : 'var(--color-text)', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}>
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div style={styles.formGroup}><label style={styles.label}>Priority</label><input style={styles.input} type="number" min="0" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>Max Redemptions</label><input style={styles.input} type="number" min="1" value={form.max_redemptions} onChange={(e) => setForm({ ...form, max_redemptions: e.target.value })} placeholder="Unlimited" /></div>
          <div style={styles.formGroup}><label style={styles.label}>Max per Customer</label><input style={styles.input} type="number" min="1" value={form.max_per_customer} onChange={(e) => setForm({ ...form, max_per_customer: e.target.value })} placeholder="Unlimited" /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer', gridColumn: '1 / -1' }}>
            <input type="checkbox" checked={form.stackable} onChange={(e) => setForm({ ...form, stackable: e.target.checked })} style={{ width: '16px', height: '16px' }} />
            Stackable (can combine with other promotions)
          </label>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}><label style={styles.label}>Description</label><textarea style={{ ...styles.input, minHeight: '80px', resize: 'vertical', maxWidth: '100%' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>
      </div>

      {/* Applies To card */}
      <AppliesToCard promo={promo} businessId={businessId} onUpdate={onUpdate} />

      {/* Usage stats */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Usage</h3>
        <div style={{ display: 'flex', gap: 'var(--space-lg)' }}>
          <div><span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Redemptions</span><br /><strong>{promo.redemption_count || 0}</strong>{promo.max_redemptions ? ` / ${promo.max_redemptions}` : ''}</div>
        </div>
      </div>
    </>
  );
}

// --- Applies To Card ---

function AppliesToCard({ promo, businessId, onUpdate }: { promo: any; businessId: string; onUpdate: (p: any) => void }) {
  const [showPicker, setShowPicker] = useState(false);

  const serviceCount = promo.service_ids?.length || 0;
  const productCount = promo.merchandise_ids?.length || 0;
  const categoryCount = promo.category_ids?.length || 0;
  const variantCount = promo.variant_ids?.length || 0;
  const locationCount = promo.location_ids?.length || 0;
  const totalSelections = serviceCount + productCount + categoryCount + locationCount;

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Applies To</h3>
        <Button size="sm" variant="secondary" onClick={() => setShowPicker(true)}>Configure</Button>
      </div>

      {totalSelections === 0 ? (
        <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', margin: 0 }}>All services, products, and locations (no restrictions)</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {serviceCount > 0 && <span style={scopeBadgeStyle}>{serviceCount} service{serviceCount > 1 ? 's' : ''}{variantCount > 0 ? ` (${variantCount} variant${variantCount > 1 ? 's' : ''})` : ''}</span>}
          {productCount > 0 && <span style={scopeBadgeStyle}>{productCount} product{productCount > 1 ? 's' : ''}</span>}
          {categoryCount > 0 && <span style={scopeBadgeStyle}>{categoryCount} categor{categoryCount > 1 ? 'ies' : 'y'}</span>}
          {locationCount > 0 && <span style={scopeBadgeStyle}>{locationCount} location{locationCount > 1 ? 's' : ''}</span>}
        </div>
      )}

      {showPicker && (
        <AppliesToPickerModal promo={promo} businessId={businessId} onClose={() => setShowPicker(false)} onSaved={(updated) => { setShowPicker(false); onUpdate(updated); }} />
      )}
    </div>
  );
}

const scopeBadgeStyle: React.CSSProperties = { fontSize: '12px', padding: '4px 10px', borderRadius: 'var(--radius-full)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' };

// --- Applies To Picker Modal ---

function AppliesToPickerModal({ promo, businessId, onClose, onSaved }: { promo: any; businessId: string; onClose: () => void; onSaved: (p: any) => void }) {
  const [services, setServices] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [serviceVariants, setServiceVariants] = useState<Record<string, any[]>>({});
  const [productVariants, setProductVariants] = useState<Record<string, any[]>>({});
  const [saving, setSaving] = useState(false);
  const [serviceSearch, setServiceSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');

  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(promo.service_ids || []);
  const [selectedMerchandiseIds, setSelectedMerchandiseIds] = useState<string[]>(promo.merchandise_ids || []);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>(promo.category_ids || []);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>(promo.location_ids || []);
  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>(promo.variant_ids || []);

  useEffect(() => {
    apiClient.get(`/v1/services?business_id=${businessId}&status=active&limit=100`).then((r) => setServices(r.data.data || [])).catch(() => {});
    apiClient.get(`/v1/merchandise?business_id=${businessId}&status=active&limit=100`).then((r) => setProducts(r.data.data || [])).catch(() => {});
    apiClient.get(`/v1/services/categories?business_id=${businessId}`).then((r) => setCategories(r.data.data || [])).catch(() => {});
    import('../api/locations').then((locApi) => { locApi.getLocations(businessId).then(setLocations).catch(() => {}); });
  }, [businessId]);

  useEffect(() => {
    for (const sId of selectedServiceIds) {
      if (!serviceVariants[sId]) {
        apiClient.get(`/v1/services/${sId}/variants`).then((r) => { setServiceVariants((prev) => ({ ...prev, [sId]: r.data.data || [] })); }).catch(() => {});
      }
    }
  }, [selectedServiceIds]);

  useEffect(() => {
    for (const pId of selectedMerchandiseIds) {
      if (!productVariants[pId]) {
        apiClient.get(`/v1/merchandise/${pId}/variants`).then((r) => { setProductVariants((prev) => ({ ...prev, [pId]: r.data.data || [] })); }).catch(() => {});
      }
    }
  }, [selectedMerchandiseIds]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const data: any = {
        service_ids: selectedServiceIds.length > 0 ? selectedServiceIds : [],
        merchandise_ids: selectedMerchandiseIds.length > 0 ? selectedMerchandiseIds : [],
        category_ids: selectedCategoryIds.length > 0 ? selectedCategoryIds : [],
        location_ids: selectedLocationIds.length > 0 ? selectedLocationIds : [],
        variant_ids: selectedVariantIds.length > 0 ? selectedVariantIds : [],
        applies_to: (selectedServiceIds.length > 0 || selectedMerchandiseIds.length > 0 || selectedCategoryIds.length > 0) ? 'specific' : 'all',
      };
      const res = await apiClient.put(`/v1/promotions/${promo.id}?business_id=${businessId}`, data);
      onSaved(res.data.data);
    } catch { alert('Failed to save scope'); }
    finally { setSaving(false); }
  };

  const toggleItem = (id: string, list: string[], setList: (ids: string[]) => void) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const toggleService = (id: string) => {
    if (selectedServiceIds.includes(id)) {
      setSelectedServiceIds(selectedServiceIds.filter((x) => x !== id));
      const vIds = (serviceVariants[id] || []).map((v: any) => v.id);
      setSelectedVariantIds(selectedVariantIds.filter((vId) => !vIds.includes(vId)));
    } else { setSelectedServiceIds([...selectedServiceIds, id]); }
  };

  const toggleProduct = (id: string) => {
    if (selectedMerchandiseIds.includes(id)) {
      setSelectedMerchandiseIds(selectedMerchandiseIds.filter((x) => x !== id));
      const vIds = (productVariants[id] || []).map((v: any) => v.id);
      setSelectedVariantIds(selectedVariantIds.filter((vId) => !vIds.includes(vId)));
    } else { setSelectedMerchandiseIds([...selectedMerchandiseIds, id]); }
  };

  const filteredServices = serviceSearch ? services.filter((s) => s.name.toLowerCase().includes(serviceSearch.toLowerCase())) : services;
  const filteredProducts = productSearch ? products.filter((p) => p.name.toLowerCase().includes(productSearch.toLowerCase())) : products;

  return (
    <div style={styles.overlay}>
      <div style={pickerStyles.modal}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>Configure Scope</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: '0 0 12px' }}>Select items and locations. Leave all empty to apply to everything.</p>

        <div style={pickerStyles.columns}>
          {/* Services */}
          <div style={pickerStyles.column}>
            <div style={pickerStyles.columnHeader}>Services ({selectedServiceIds.length})</div>
            <input style={pickerStyles.searchInput} placeholder="Search..." value={serviceSearch} onChange={(e) => setServiceSearch(e.target.value)} />
            <div style={pickerStyles.columnList}>
              {filteredServices.map((s: any) => (
                <div key={s.id}>
                  <label style={pickerStyles.item}><input type="checkbox" checked={selectedServiceIds.includes(s.id)} onChange={() => toggleService(s.id)} style={{ width: '14px', height: '14px' }} /><span>{s.name}</span></label>
                  {selectedServiceIds.includes(s.id) && serviceVariants[s.id] && serviceVariants[s.id].length > 0 && (
                    <div style={pickerStyles.variantList}>
                      {serviceVariants[s.id].map((v: any) => (
                        <label key={v.id} style={pickerStyles.variantItem}><input type="checkbox" checked={selectedVariantIds.includes(v.id)} onChange={() => toggleItem(v.id, selectedVariantIds, setSelectedVariantIds)} style={{ width: '12px', height: '12px' }} /><span>{v.name}{v.duration ? ` ${v.duration}m` : ''}</span></label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {filteredServices.length === 0 && <span style={pickerStyles.empty}>No services</span>}
            </div>
          </div>

          {/* Products */}
          <div style={pickerStyles.column}>
            <div style={pickerStyles.columnHeader}>Products ({selectedMerchandiseIds.length})</div>
            <input style={pickerStyles.searchInput} placeholder="Search..." value={productSearch} onChange={(e) => setProductSearch(e.target.value)} />
            <div style={pickerStyles.columnList}>
              {filteredProducts.map((p: any) => (
                <div key={p.id}>
                  <label style={pickerStyles.item}><input type="checkbox" checked={selectedMerchandiseIds.includes(p.id)} onChange={() => toggleProduct(p.id)} style={{ width: '14px', height: '14px' }} /><span>{p.name}</span></label>
                  {selectedMerchandiseIds.includes(p.id) && productVariants[p.id] && productVariants[p.id].length > 0 && (
                    <div style={pickerStyles.variantList}>
                      {productVariants[p.id].map((v: any) => (
                        <label key={v.id} style={pickerStyles.variantItem}><input type="checkbox" checked={selectedVariantIds.includes(v.id)} onChange={() => toggleItem(v.id, selectedVariantIds, setSelectedVariantIds)} style={{ width: '12px', height: '12px' }} /><span>{v.name}</span></label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {filteredProducts.length === 0 && <span style={pickerStyles.empty}>No products</span>}
            </div>
          </div>

          {/* Categories */}
          <div style={pickerStyles.column}>
            <div style={pickerStyles.columnHeader}>Categories ({selectedCategoryIds.length})</div>
            <div style={pickerStyles.columnList}>
              {categories.map((c: any) => (
                <label key={c.id} style={pickerStyles.item}><input type="checkbox" checked={selectedCategoryIds.includes(c.id)} onChange={() => toggleItem(c.id, selectedCategoryIds, setSelectedCategoryIds)} style={{ width: '14px', height: '14px' }} /><span>{c.name}</span></label>
              ))}
              {categories.length === 0 && <span style={pickerStyles.empty}>None defined</span>}
            </div>
          </div>

          {/* Locations */}
          <div style={pickerStyles.column}>
            <div style={pickerStyles.columnHeader}>Locations ({selectedLocationIds.length})</div>
            <div style={pickerStyles.columnList}>
              {locations.map((l: any) => (
                <label key={l.id} style={pickerStyles.item}><input type="checkbox" checked={selectedLocationIds.includes(l.id)} onChange={() => toggleItem(l.id, selectedLocationIds, setSelectedLocationIds)} style={{ width: '14px', height: '14px' }} /><span>{l.name}</span></label>
              ))}
              {locations.length === 0 && <span style={pickerStyles.empty}>None defined</span>}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px', borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>Save Scope</Button>
        </div>
      </div>
    </div>
  );
}

const pickerStyles: Record<string, React.CSSProperties> = {
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '95%', maxWidth: '900px', maxHeight: '80vh', border: '1px solid var(--color-border)', boxShadow: '0 10px 25px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column' },
  columns: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px', flex: 1, minHeight: 0 },
  column: { display: 'flex', flexDirection: 'column', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
  columnHeader: { fontSize: '11px', fontWeight: 600, color: 'var(--color-text)', padding: '8px 10px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  searchInput: { border: 'none', borderBottom: '1px solid var(--color-border)', padding: '6px 10px', fontSize: '12px', outline: 'none', fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)', width: '100%', boxSizing: 'border-box' },
  columnList: { flex: 1, overflowY: 'auto', padding: '6px', display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '300px' },
  item: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--color-text)', cursor: 'pointer', padding: '3px 4px', borderRadius: '4px' },
  variantList: { marginLeft: '22px', display: 'flex', flexDirection: 'column', gap: '1px', marginTop: '2px', marginBottom: '4px', borderLeft: '2px solid var(--color-border)', paddingLeft: '6px' },
  variantItem: { display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--color-text-secondary)', cursor: 'pointer', padding: '2px 4px' },
  empty: { fontSize: '11px', color: 'var(--color-text-secondary)', padding: '8px', fontStyle: 'italic' },
};

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '900px', margin: '0 auto' },
  loading: { padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--color-text-secondary)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  headerCard: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-lg)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-md)' },
  headerInfo: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  name: { margin: 0, fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)' },
  code: { fontSize: 'var(--font-size-sm)', color: 'var(--color-accent, #C9A96E)', fontFamily: 'monospace', fontWeight: 600 },
  headerRight: { display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', gap: '4px' },
  value: { fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)' },
  typeLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  actionsBar: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: 'var(--space-md)' },
  saveBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-sm) var(--space-md)', marginBottom: 'var(--space-md)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-primary)' },
  card: { padding: 'var(--space-lg)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-md)' },
  cardTitle: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' },
  input: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: '14px', width: '100%', boxSizing: 'border-box' as const, fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)' },
  overlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '500px', maxHeight: '85vh', overflow: 'auto', border: '1px solid var(--color-border)', boxShadow: '0 10px 25px rgba(0,0,0,0.3)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--color-text)' },
  closeBtn: { background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--color-text-secondary)' },
};
