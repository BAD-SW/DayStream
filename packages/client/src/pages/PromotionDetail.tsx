import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { StickyPageTop } from '../design-system/components/layout/StickyPageTop';
import { DraftSectionsProvider, useDraftSections, useDraft, fieldMark, checkMark, draftBox, UnsavedTag } from '../components/unsaved/DraftSections';
import { LeaveGuard, useGuardedNavigate } from '../components/unsaved/LeaveGuard';
import { SaveChanges } from '../components/unsaved/SaveChanges';
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

// One Save for the promotion (David, 2026-11-02, as in Settings, Events and People): details and
// the "Applies to" scope wait for Save changes; Pause, Activate and Archive act straight away.
export function PromotionDetail() {
  return (
    <DraftSectionsProvider>
      <PromotionDetailPage />
    </DraftSectionsProvider>
  );
}

function PromotionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useGuardedNavigate();
  const [promo, setPromo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { dirtySections } = useDraftSections();

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
      <LeaveGuard when={dirtySections.length > 0} />
      <StickyPageTop>
        <button style={styles.back} onClick={() => navigate('/offers?tab=promotions')}>← Back to Offerings</button>

        {/* Header */}
        <div style={styles.headerCard}>
          <div style={styles.headerInfo}>
            <h1 style={styles.name}>{promo.name}</h1>
            {promo.promo_code && <span style={styles.code}>Code: {promo.promo_code}</span>}
          </div>
          <div style={styles.headerRight}>
            <div style={styles.saveRow}><SaveChanges /></div>
            <div style={styles.saveRow}>
              <Badge variant={STATUS_VARIANTS[promo.status] || 'neutral'}>{promo.status}</Badge>
              <span style={styles.value}>
                {promo.type.includes('percentage') ? `${promo.value}%` : formatCurrency(promo.value)}
              </span>
            </div>
            <span style={styles.typeLabel}>{PROMO_TYPE_LABELS[promo.type]}</span>
          </div>
        </div>
      </StickyPageTop>

      <PromotionForm promo={promo} businessId={businessId} onUpdate={setPromo} />
    </div>
  );
}

function PromotionForm({ promo, businessId, onUpdate }: { promo: any; businessId: string; onUpdate: (p: any) => void }) {
  const [statusChanging, setStatusChanging] = useState(false);
  const fromPromo = (p: any) => ({
    name: p.name,
    description: p.description || '',
    type: p.type,
    value: p.value,
    promo_code: p.promo_code || '',
    date_from: p.date_from ? p.date_from.split('T')[0] : '',
    date_to: p.date_to ? p.date_to.split('T')[0] : '',
    days_of_week: (p.days_of_week || []) as number[],
    time_from: p.time_from || '',
    time_to: p.time_to || '',
    applies_to: p.applies_to || 'all',
    max_redemptions: p.max_redemptions ? String(p.max_redemptions) : '',
    max_per_customer: p.max_per_customer ? String(p.max_per_customer) : '',
    priority: p.priority || 0,
    stackable: p.stackable || false,
  });
  const draft = useDraft('promotion-details', 'Promotion details', fromPromo(promo), async (form) => {
    // applies_to follows the scope ("Applies to"), which is saved on its own.
    const { applies_to: _scope, ...rest } = form;
    const data: any = { ...rest };
    data.max_redemptions = form.max_redemptions ? parseInt(form.max_redemptions) : null;
    data.max_per_customer = form.max_per_customer ? parseInt(form.max_per_customer) : null;
    const res = await apiClient.put(`/v1/promotions/${promo.id}?business_id=${businessId}`, data);
    onUpdate(res.data.data);
    return fromPromo(res.data.data);
  });
  const form = draft.value;
  const setForm = draft.setValue;
  const mark = (key: keyof typeof form) => fieldMark(draft.changed((v) => v[key]));

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

      {/* Details Card */}
      <div style={{ ...styles.card, ...draftBox(draft.dirty) }}>
        <h3 style={styles.cardTitle}>Promotion Details<UnsavedTag dirty={draft.dirty} /></h3>
        <div style={styles.formGrid}>
          <div style={styles.formGroup}><label style={styles.label}>Name *</label><input style={{ ...styles.input, ...mark('name') }} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Type *</label>
            <select style={{ ...styles.input, ...mark('type') }} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="discount_percentage">Percentage Discount</option>
              <option value="discount_fixed">Fixed Amount Discount</option>
              <option value="price_override">Price Override</option>
              <option value="premium_percentage">Percentage Premium</option>
              <option value="premium_fixed">Fixed Amount Premium</option>
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{form.type.includes('percentage') ? 'Percentage' : 'Amount (cents)'}</label>
            <input style={{ ...styles.input, ...mark('value') }} type="number" min="0" value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} />
          </div>
          <div style={styles.formGroup}><label style={styles.label}>Promo Code</label><input style={{ ...styles.input, ...mark('promo_code') }} value={form.promo_code} onChange={(e) => setForm({ ...form, promo_code: e.target.value.toUpperCase() })} placeholder="Auto-applies if empty" /></div>
          <div style={styles.formGroup}><label style={styles.label}>Start Date</label><input style={{ ...styles.input, ...mark('date_from') }} type="date" value={form.date_from} onChange={(e) => setForm({ ...form, date_from: e.target.value })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>End Date</label><input style={{ ...styles.input, ...mark('date_to') }} type="date" value={form.date_to} onChange={(e) => setForm({ ...form, date_to: e.target.value })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>Time From</label><input style={{ ...styles.input, ...mark('time_from') }} type="time" value={form.time_from} onChange={(e) => setForm({ ...form, time_from: e.target.value })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>Time To</label><input style={{ ...styles.input, ...mark('time_to') }} type="time" value={form.time_to} onChange={(e) => setForm({ ...form, time_to: e.target.value })} /></div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
            <label style={styles.label}>Days of Week</label>
            <div style={{ display: 'flex', gap: '4px', borderRadius: 'var(--radius-md)', alignSelf: 'flex-start', ...mark('days_of_week') }}>
              {DAY_NAMES.map((name, idx) => (
                <button key={idx} type="button" onClick={() => toggleDay(idx)}
                  style={{ padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: form.days_of_week.includes(idx) ? 'var(--color-accent, #C9A96E)' : 'var(--color-background)', color: form.days_of_week.includes(idx) ? '#1A1A1A' : 'var(--color-text)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div style={styles.formGroup}><label style={styles.label}>Priority</label><input style={{ ...styles.input, ...mark('priority') }} type="number" min="0" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} /></div>
          <div style={styles.formGroup}><label style={styles.label}>Max Redemptions</label><input style={{ ...styles.input, ...mark('max_redemptions') }} type="number" min="1" value={form.max_redemptions} onChange={(e) => setForm({ ...form, max_redemptions: e.target.value })} placeholder="Unlimited" /></div>
          <div style={styles.formGroup}><label style={styles.label}>Max per Customer</label><input style={{ ...styles.input, ...mark('max_per_customer') }} type="number" min="1" value={form.max_per_customer} onChange={(e) => setForm({ ...form, max_per_customer: e.target.value })} placeholder="Unlimited" /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer', gridColumn: '1 / -1' }}>
            <input type="checkbox" checked={form.stackable} onChange={(e) => setForm({ ...form, stackable: e.target.checked })} style={{ width: '16px', height: '16px', ...checkMark(draft.changed((v) => v.stackable)) }} />
            Stackable (can combine with other promotions)
          </label>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}><label style={styles.label}>Description</label><textarea style={{ ...styles.input, minHeight: '80px', resize: 'vertical', maxWidth: '100%', ...mark('description') }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>
      </div>

      {/* Applies To card */}
      <AppliesToCard promo={promo} businessId={businessId} onUpdate={onUpdate} />

      {/* Usage stats */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Usage</h3>
        <div style={{ display: 'flex', gap: 'var(--space-lg)' }}>
          <div><span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>Redemptions</span><br /><strong>{promo.redemption_count || 0}</strong>{promo.max_redemptions ? ` / ${promo.max_redemptions}` : ''}</div>
        </div>
      </div>
    </>
  );
}

// --- Applies To Card (the scope chosen in the picker is saved with the page's Save changes) ---

interface Scope { service_ids: string[]; merchandise_ids: string[]; category_ids: string[]; location_ids: string[]; variant_ids: string[] }
const scopeOf = (p: any): Scope => ({
  service_ids: p.service_ids || [], merchandise_ids: p.merchandise_ids || [], category_ids: p.category_ids || [],
  location_ids: p.location_ids || [], variant_ids: p.variant_ids || [],
});

function AppliesToCard({ promo, businessId, onUpdate }: { promo: any; businessId: string; onUpdate: (p: any) => void }) {
  const [showPicker, setShowPicker] = useState(false);
  const draft = useDraft<Scope>('promotion-scope', 'Applies to', scopeOf(promo), async (s) => {
    const data: any = {
      ...s,
      applies_to: (s.service_ids.length > 0 || s.merchandise_ids.length > 0 || s.category_ids.length > 0) ? 'specific' : 'all',
    };
    const res = await apiClient.put(`/v1/promotions/${promo.id}?business_id=${businessId}`, data);
    onUpdate(res.data.data);
    return scopeOf(res.data.data);
  });
  const scope = draft.value;

  const serviceCount = scope.service_ids.length;
  const productCount = scope.merchandise_ids.length;
  const categoryCount = scope.category_ids.length;
  const variantCount = scope.variant_ids.length;
  const locationCount = scope.location_ids.length;
  const totalSelections = serviceCount + productCount + categoryCount + locationCount;

  return (
    <div style={{ ...styles.card, ...draftBox(draft.dirty) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Applies To<UnsavedTag dirty={draft.dirty} /></h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          {draft.dirty && <Button size="sm" variant="ghost" onClick={() => draft.setValue(draft.saved)}>Undo</Button>}
          <Button size="sm" variant="secondary" onClick={() => setShowPicker(true)}>Configure</Button>
        </div>
      </div>

      {totalSelections === 0 ? (
        <p style={{ fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)', margin: 0 }}>All services, products, and locations (no restrictions)</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {serviceCount > 0 && <span style={scopeBadgeStyle}>{serviceCount} service{serviceCount > 1 ? 's' : ''}{variantCount > 0 ? ` (${variantCount} variant${variantCount > 1 ? 's' : ''})` : ''}</span>}
          {productCount > 0 && <span style={scopeBadgeStyle}>{productCount} product{productCount > 1 ? 's' : ''}</span>}
          {categoryCount > 0 && <span style={scopeBadgeStyle}>{categoryCount} categor{categoryCount > 1 ? 'ies' : 'y'}</span>}
          {locationCount > 0 && <span style={scopeBadgeStyle}>{locationCount} location{locationCount > 1 ? 's' : ''}</span>}
        </div>
      )}

      {showPicker && (
        <AppliesToPickerModal scope={scope} businessId={businessId} onClose={() => setShowPicker(false)} onDone={(next) => { setShowPicker(false); draft.setValue(next); }} />
      )}
    </div>
  );
}

const scopeBadgeStyle: React.CSSProperties = { fontSize: 'var(--font-size-sm)', padding: '4px 10px', borderRadius: 'var(--radius-full)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' };

// --- Applies To Picker Modal ---

function AppliesToPickerModal({ scope, businessId, onClose, onDone }: { scope: Scope; businessId: string; onClose: () => void; onDone: (s: Scope) => void }) {
  const [services, setServices] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [serviceVariants, setServiceVariants] = useState<Record<string, any[]>>({});
  const [productVariants, setProductVariants] = useState<Record<string, any[]>>({});
  const [serviceSearch, setServiceSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');

  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(scope.service_ids);
  const [selectedMerchandiseIds, setSelectedMerchandiseIds] = useState<string[]>(scope.merchandise_ids);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>(scope.category_ids);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>(scope.location_ids);
  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>(scope.variant_ids);

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

  const handleDone = () => {
    onDone({
      service_ids: selectedServiceIds, merchandise_ids: selectedMerchandiseIds, category_ids: selectedCategoryIds,
      location_ids: selectedLocationIds, variant_ids: selectedVariantIds,
    });
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
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 12px' }}>Select items and locations. Leave all empty to apply to everything. Saved with the page's Save changes.</p>

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
          <Button onClick={handleDone}>Done</Button>
        </div>
      </div>
    </div>
  );
}

const pickerStyles: Record<string, React.CSSProperties> = {
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '95%', maxWidth: '900px', maxHeight: '80vh', border: '1px solid var(--color-border)', boxShadow: '0 10px 25px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column' },
  columns: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px', flex: 1, minHeight: 0 },
  column: { display: 'flex', flexDirection: 'column', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
  columnHeader: { fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text)', padding: '8px 10px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  searchInput: { border: 'none', borderBottom: '1px solid var(--color-border)', padding: '6px 10px', fontSize: 'var(--font-size-sm)', outline: 'none', fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)', width: '100%', boxSizing: 'border-box' },
  columnList: { flex: 1, overflowY: 'auto', padding: '6px', display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '300px' },
  item: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', cursor: 'pointer', padding: '3px 4px', borderRadius: '4px' },
  variantList: { marginLeft: '22px', display: 'flex', flexDirection: 'column', gap: '1px', marginTop: '2px', marginBottom: '4px', borderLeft: '2px solid var(--color-border)', paddingLeft: '6px' },
  variantItem: { display: 'flex', alignItems: 'center', gap: '5px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', padding: '2px 4px' },
  empty: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', padding: '8px', fontStyle: 'italic' },
};

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '900px', margin: '0 auto' },
  loading: { padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--color-text-secondary)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  headerCard: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-lg)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-md)' },
  headerInfo: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  name: { margin: 0, fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)' },
  code: { fontSize: 'var(--font-size-sm)', color: 'var(--color-accent, #C9A96E)', fontFamily: 'monospace', fontWeight: 600 },
  headerRight: { display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', gap: '6px' },
  saveRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' },
  value: { fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)' },
  typeLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  actionsBar: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: 'var(--space-md)' },
  saveBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-sm) var(--space-md)', marginBottom: 'var(--space-md)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-primary)' },
  card: { padding: 'var(--space-lg)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-md)' },
  cardTitle: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)' },
  input: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 'var(--font-size-base)', width: '100%', boxSizing: 'border-box' as const, fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)' },
  overlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '500px', maxHeight: '85vh', overflow: 'auto', border: '1px solid var(--color-border)', boxShadow: '0 10px 25px rgba(0,0,0,0.3)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)' },
  closeBtn: { background: 'none', border: 'none', fontSize: 'var(--font-size-xl)', cursor: 'pointer', color: 'var(--color-text-secondary)' },
};
