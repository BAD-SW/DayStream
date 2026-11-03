import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { CopyWidgetSnippetButton } from '../components/CopyWidgetSnippetButton';
import { StickyPageTop } from '../design-system/components/layout/StickyPageTop';
import { TabBar } from '../design-system/components/navigation/TabBar';
import { PackagePeople } from '../components/OfferingPeople';
import { DraftSectionsProvider, DraftTab, useDraftSections, useDraft, useDraftList, fieldMark, checkMark, draftBox, UnsavedTag, RowTag } from '../components/unsaved/DraftSections';
import { LeaveGuard, useGuardedNavigate } from '../components/unsaved/LeaveGuard';
import { SaveChanges } from '../components/unsaved/SaveChanges';
import { apiClient } from '../api/client';
import { formatCurrency } from '../utils/currency';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success', paused: 'warning', archived: 'neutral',
};

// One Save for the package (David, 2026-11-02, as in Settings, Events and People): details and
// included items wait for Save changes; Pause, Activate and Archive act straight away.
export function PackageDetail() {
  return (
    <DraftSectionsProvider>
      <PackageDetailPage />
    </DraftSectionsProvider>
  );
}

function PackageDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useGuardedNavigate();
  const [pkg, setPkg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { dirtySections } = useDraftSections();
  const [activeTab, setActiveTab] = useState<'details' | 'people'>('details');
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
      <LeaveGuard when={dirtySections.length > 0} />
      <StickyPageTop>
        <button style={styles.back} onClick={() => navigate('/offers?tab=packages')}>← Back to Offerings</button>
        <div style={styles.headerCard}>
          <div style={styles.headerInfo}>
            <h1 style={styles.name}>{pkg.name}</h1>
            <span style={styles.sub}>{pkg.expiration_type === 'none' ? 'Never expires' : `Expires ${pkg.expiration_days} ${pkg.expiration_unit || 'days'} after purchase`}</span>
          </div>
          <div style={styles.headerRight}>
            <div style={styles.saveRow}><SaveChanges /></div>
            <div style={styles.saveRow}>
              <Badge variant={STATUS_VARIANTS[pkg.status] || 'neutral'}>{pkg.status}</Badge>
              <span style={styles.price}>{formatCurrency(pkg.price)}</span>
              <span style={styles.sold}>{pkg.active_purchases || 0} sold</span>
              <CopyWidgetSnippetButton
                productId={pkg.id}
                productName={pkg.name}
                action="purchase"
                enabled={pkg.status === 'active'}
                disabledReason="Activate this package to get a widget snippet"
              />
            </div>
          </div>
        </div>
        <TabBar aria-label="Package sections" tabs={[{ key: 'details' as const, label: 'Details' }, { key: 'people' as const, label: 'Buyers' }].map((t) => ({ ...t, changed: dirtySections.some((s) => s.tab === t.key) }))} active={activeTab} onChange={setActiveTab} />
      </StickyPageTop>
      {/* Details stay mounted, so their edits survive switching tabs. */}
      <div hidden={activeTab !== 'details'}>
        <DraftTab tab="details">
          <PackageForm pkg={pkg} businessId={businessId} onUpdate={setPkg} />
          <PackageItemsCard packageId={pkg.id} />
        </DraftTab>
      </div>
      {activeTab === 'people' && <PackagePeople packageId={pkg.id} businessId={businessId} />}
    </div>
  );
}

function PackageForm({ pkg, businessId, onUpdate }: { pkg: any; businessId: string; onUpdate: (p: any) => void }) {
  const [statusChanging, setStatusChanging] = useState(false);
  const [taxCategories, setTaxCategories] = useState<any[]>([]);

  useEffect(() => {
    apiClient.get(`/v1/services/tax-categories?business_id=${businessId}`).then((res) => setTaxCategories(res.data.data || [])).catch(() => {});
  }, [businessId]);

  const fromPkg = (p: any) => ({
    name: p.name, description: p.description || '', short_description: p.short_description || '',
    price: p.price, expiration_type: p.expiration_type || 'none',
    expiration_days: p.expiration_days ? String(p.expiration_days) : '',
    expiration_unit: p.expiration_unit || 'days',
    is_taxable: p.is_taxable || false, tax_category_id: p.tax_category_id || '',
    new_customers_only: p.new_customers_only || false,
  });
  const draft = useDraft('package-details', 'Package details', fromPkg(pkg), async (form) => {
    const data = { ...form, expiration_days: form.expiration_days ? parseInt(form.expiration_days) : null };
    const res = await apiClient.put(`/v1/packages/${pkg.id}?business_id=${businessId}`, data);
    const updated = { ...pkg, ...res.data.data };
    onUpdate(updated);
    return fromPkg(updated);
  });
  const form = draft.value;
  const setForm = draft.setValue;
  const mark = (key: keyof typeof form) => fieldMark(draft.changed((v) => v[key]));
  const [priceDisplay, setPriceDisplay] = useState((pkg.price / 100).toFixed(2));
  // The price box follows the stored price after a save.
  useEffect(() => { setPriceDisplay((draft.saved.price / 100).toFixed(2)); }, [draft.saved.price]);

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
      <div style={{ ...styles.card, ...draftBox(draft.dirty) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ ...styles.cardTitle, margin: 0 }}>Package Details<UnsavedTag dirty={draft.dirty} /></h3>
          <Button size="sm" variant="secondary" onClick={() => {}}>Translate</Button>
        </div>
        <div style={styles.formGrid}>
          <div style={styles.formGroup}><label style={styles.label}>Name *</label><input style={{ ...styles.input, ...mark('name') }} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Price *</label>
            <input style={{ ...styles.input, ...mark('price') }} type="number" step="0.01" min="0" value={priceDisplay}
              onChange={(e) => { setPriceDisplay(e.target.value); setForm({ ...form, price: Math.round(parseFloat(e.target.value || '0') * 100) || 0 }); }}
              onBlur={() => setPriceDisplay((form.price / 100).toFixed(2))} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Expiration</label>
            <select style={{ ...styles.input, ...mark('expiration_type') }} value={form.expiration_type} onChange={(e) => setForm({ ...form, expiration_type: e.target.value })}>
              <option value="none">Never expires</option>
              <option value="days_from_purchase">From purchase date</option>
            </select>
          </div>
          {form.expiration_type === 'days_from_purchase' && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Expires after</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input style={{ ...styles.input, flex: 1, ...mark('expiration_days') }} type="number" min="1" value={form.expiration_days} onChange={(e) => setForm({ ...form, expiration_days: e.target.value })} />
                <select style={{ ...styles.input, width: '120px', ...mark('expiration_unit') }} value={form.expiration_unit} onChange={(e) => setForm({ ...form, expiration_unit: e.target.value })}>
                  <option value="days">Days</option>
                  <option value="weeks">Weeks</option>
                  <option value="months">Months</option>
                </select>
              </div>
            </div>
          )}
          <div style={styles.formGroup}>
            <label style={styles.label}>Tax Category</label>
            <select style={{ ...styles.input, ...mark('tax_category_id') }} value={form.tax_category_id} onChange={(e) => setForm({ ...form, tax_category_id: e.target.value })}>
              <option value="">No tax</option>
              {taxCategories.map((tc: any) => <option key={tc.id} value={tc.id}>{tc.name} ({(tc.rate / 100).toFixed(2)}%)</option>)}
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>&nbsp;</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer', paddingTop: '4px' }}>
              <input type="checkbox" checked={form.new_customers_only} onChange={(e) => setForm({ ...form, new_customers_only: e.target.checked })} style={{ width: '16px', height: '16px', ...checkMark(draft.changed((v) => v.new_customers_only)) }} /> New customers only (intro offer)
            </label>
          </div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}><label style={styles.label}>Short Description</label><input style={{ ...styles.input, ...mark('short_description') }} value={form.short_description} onChange={(e) => setForm({ ...form, short_description: e.target.value })} /></div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}><label style={styles.label}>Description</label><textarea style={{ ...styles.input, minHeight: '80px', resize: 'vertical', maxWidth: '100%', ...mark('description') }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>
      </div>
    </>
  );
}

// Included items wait for the page's Save changes.
const itemChanges = (i: any) => ({ quantity: i.quantity, variant_id: i.redemption_type === 'minutes' ? null : (i.variant_id || null), redemption_type: i.redemption_type });

function PackageItemsCard({ packageId }: { packageId: string }) {
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ key?: string; item?: any } | null>(null);
  const list = useDraftList<any>('package-items', 'Included items', {
    create: (i) => apiClient.post(`/v1/packages/${packageId}/items`, {
      item_type: i.item_type, service_id: i.item_type === 'service' ? i.service_id : undefined,
      merchandise_id: i.item_type === 'merchandise' ? i.merchandise_id : undefined,
      variant_id: i.redemption_type === 'minutes' ? undefined : (i.variant_id || undefined),
      quantity: i.quantity,
      redemption_type: i.redemption_type,
    }).then((r) => ({ ...i, ...r.data.data })),
    update: (i) => apiClient.put(`/v1/packages/${packageId}/items/${i.id}`, itemChanges(i)).then((r) => ({ ...i, ...r.data.data })),
    remove: (i) => apiClient.delete(`/v1/packages/${packageId}/items/${i.id}`).then(() => undefined),
  });

  const fetchItems = useCallback(async () => {
    try { const res = await apiClient.get(`/v1/packages/${packageId}/items`); list.load(res.data.data || []); }
    catch { list.load([]); } finally { setLoading(false); }
  }, [packageId, list.load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchItems(); }, [fetchItems]);

  return (
    <div style={{ ...styles.card, ...draftBox(list.dirty) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Included Items<UnsavedTag dirty={list.dirty} /></h3>
        <Button size="sm" variant="secondary" onClick={() => setEditing({})}>Add Item</Button>
      </div>
      {loading && <p style={styles.muted}>Loading...</p>}
      {!loading && list.rows.length === 0 && <p style={styles.muted}>No items in this package. Add services or products that the customer receives.</p>}
      {list.rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {list.rows.map((r) => {
            const item = r.item;
            const edited = !r.isNew && !r.deleted && list.changed(r, itemChanges);
            return (
              <div key={r.key} style={{ ...styles.itemRow, opacity: r.deleted ? 0.6 : 1, ...(edited ? fieldMark(true) : {}) }}>
                <div style={{ flex: 1, textDecoration: r.deleted ? 'line-through' : 'none' }}>
                  <Badge variant={item.item_type === 'service' ? 'info' : 'neutral'}>{item.item_type === 'service' ? 'Service' : 'Product'}</Badge><strong style={{ marginLeft: '8px' }}>{item.service_name || item.merchandise_name || 'Unknown'}</strong>
                  {r.isNew && <> <RowTag>New</RowTag></>}
                  {edited && <> <RowTag>Changed</RowTag></>}
                  {r.deleted && <> <RowTag>Deleted when you save</RowTag></>}
                </div>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{item.redemption_type === 'minutes' ? `${item.quantity} min` : `×${item.quantity}`}</span>
                {r.deleted ? <Button size="sm" variant="ghost" onClick={() => list.undo(r.key)}>Undo</Button> : <>
                  <button style={styles.editBtn} onClick={() => setEditing({ key: r.key, item })} title="Edit">✏️</button>
                  <button style={styles.deleteBtn} onClick={() => list.remove(r.key)} title="Remove">×</button>
                </>}
              </div>
            );
          })}
        </div>
      )}
      {editing && (
        <AddEditPackageItemModal item={editing.item || null} onClose={() => setEditing(null)}
          onDone={(data) => { if (editing.key) list.edit(editing.key, data); else list.add(data); setEditing(null); }} />
      )}
    </div>
  );
}

function AddEditPackageItemModal({ item, onClose, onDone }: { item: any; onClose: () => void; onDone: (data: any) => void }) {
  const businessId = localStorage.getItem('business_id') || '';
  const [itemType, setItemType] = useState<'service' | 'merchandise'>(item?.item_type || 'service');
  const [redemptionType, setRedemptionType] = useState<'sessions' | 'minutes'>(item?.redemption_type || 'sessions');
  const [services, setServices] = useState<any[]>([]);
  const [merchandise, setMerchandise] = useState<any[]>([]);
  const [variants, setVariants] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState(item?.service_id || item?.merchandise_id || '');
  const [selectedVariantId, setSelectedVariantId] = useState(item?.variant_id || '');
  const [quantity, setQuantity] = useState(item?.quantity || 1);
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

  const options = itemType === 'service' ? services : merchandise;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId && !isEditing) { setError('Select an item'); return; }
    const variant_id = redemptionType === 'minutes' ? undefined : (selectedVariantId || undefined);
    if (isEditing) { onDone({ quantity, variant_id, redemption_type: redemptionType }); return; }
    const name = options.find((o: any) => o.id === selectedId)?.name;
    onDone({
      item_type: itemType, service_id: itemType === 'service' ? selectedId : undefined,
      merchandise_id: itemType === 'merchandise' ? selectedId : undefined,
      service_name: itemType === 'service' ? name : undefined, merchandise_name: itemType === 'merchandise' ? name : undefined,
      variant_id, quantity, redemption_type: redemptionType,
    });
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}><h3 style={styles.modalTitle}>{isEditing ? 'Edit Item' : 'Add Item'}</h3><button style={styles.closeBtn} onClick={onClose}>×</button></div>
        {error && <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: '0 0 8px' }}>{error}</p>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={styles.formGroup}><label style={styles.label}>Type</label><select style={styles.input} value={itemType} disabled={isEditing} onChange={(e) => { setItemType(e.target.value as any); setSelectedId(''); }}><option value="service">Service</option><option value="merchandise">Product</option></select></div>
          <div style={styles.formGroup}><label style={styles.label}>{itemType === 'service' ? 'Service' : 'Product'} *</label><select style={styles.input} value={selectedId} disabled={isEditing} onChange={(e) => setSelectedId(e.target.value)} required><option value="">Select...</option>{options.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          {itemType === 'service' && (
            <div style={styles.formGroup}><label style={styles.label}>Redemption Mode</label><select style={styles.input} value={redemptionType} onChange={(e) => { setRedemptionType(e.target.value as any); if (e.target.value === 'minutes') setSelectedVariantId(''); }}><option value="sessions">Fixed sessions (specific variant)</option><option value="minutes">Time pool (total minutes, any variant)</option></select></div>
          )}
          {redemptionType === 'sessions' && variants.length > 0 && (<div style={styles.formGroup}><label style={styles.label}>Variant</label><select style={styles.input} value={selectedVariantId} onChange={(e) => setSelectedVariantId(e.target.value)}><option value="">All / any</option>{variants.map((v: any) => <option key={v.id} value={v.id}>{v.name}{v.price != null ? ` — ${formatCurrency(v.price)}` : ''}</option>)}</select></div>)}
          <div style={styles.formGroup}><label style={styles.label}>{redemptionType === 'minutes' ? 'Total Minutes' : 'Quantity (sessions)'}</label><input style={styles.input} type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />{redemptionType === 'minutes' && <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '2px' }}>{quantity >= 60 ? `${Math.floor(quantity / 60)}h ${quantity % 60 > 0 ? `${quantity % 60}m` : ''}` : `${quantity}m`}</span>}</div>
          <p style={{ ...styles.muted, fontSize: 'var(--font-size-xs)' }}>Saved with the page's Save changes.</p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit">{isEditing ? 'Done' : 'Add Item'}</Button></div>
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
  name: { margin: 0, fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)' },
  sub: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  headerRight: { display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', gap: '6px' },
  saveRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' },
  price: { fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)' },
  sold: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  actionsBar: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: 'var(--space-md)' },
  saveBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-sm) var(--space-md)', marginBottom: 'var(--space-md)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-primary)' },
  card: { padding: 'var(--space-lg)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-md)' },
  cardTitle: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)' },
  input: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 'var(--font-size-base)', width: '100%', boxSizing: 'border-box' as const, fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)' },
  muted: { fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)', margin: 0 },
  itemRow: { display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-base)' },
  editBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-base)', padding: '2px 4px', borderRadius: 'var(--button-radius)', minHeight: 'var(--button-height-sm)' },
  deleteBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-lg)', color: 'var(--color-error)', padding: '2px 6px', lineHeight: 1, borderRadius: 'var(--button-radius)', minHeight: 'var(--button-height-sm)' },
  overlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '450px', maxHeight: '85vh', overflow: 'auto', border: '1px solid var(--color-border)', boxShadow: '0 10px 25px rgba(0,0,0,0.3)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)' },
  closeBtn: { background: 'none', border: 'none', fontSize: 'var(--font-size-xl)', cursor: 'pointer', color: 'var(--color-text-secondary)' },
};
