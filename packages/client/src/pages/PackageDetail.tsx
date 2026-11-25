import { showMessage } from '../design-system/components/feedback/dialogs';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
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
import { formatNumber } from '../utils/format';
import { TranslateButton } from '../components/TranslationsTable';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation('offerings');
  const { id } = useParams<{ id: string }>();
  const navigate = useGuardedNavigate();
  const [pkg, setPkg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { dirtySections } = useDraftSections();
  // The tab is kept in the address (?tab=), as in Settings, so Back from a profile returns to it (THE-23 remark).
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTabState] = useState<'details' | 'people'>(() => (searchParams.get('tab') === 'people' ? 'people' : 'details'));
  const setActiveTab = (tab: 'details' | 'people') => { setActiveTabState(tab); setSearchParams(tab === 'details' ? {} : { tab }, { replace: true }); };
  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!id || !businessId) return;
    setLoading(true);
    apiClient.get(`/v1/packages/${id}?business_id=${businessId}`)
      .then((res) => setPkg(res.data.data))
      .catch(() => setPkg(null))
      .finally(() => setLoading(false));
  }, [id, businessId]);

  if (loading) return <div style={styles.loading}>{t('common:loading')}</div>;
  if (!pkg) return <div style={styles.loading}>{t('packageDetail.notFound')}</div>;

  return (
    <div style={styles.page}>
      <LeaveGuard when={dirtySections.length > 0} />
      <StickyPageTop>
        <button style={styles.back} onClick={() => navigate('/offers?tab=packages')}>{t('serviceCreate.backToOfferings')}</button>
        <div style={styles.headerCard}>
          <div style={styles.headerInfo}>
            <h1 style={styles.name}>{pkg.name}</h1>
            <span style={styles.sub}>{pkg.expiration_type === 'none' ? t('packages.neverExpires') : t(`packageDetail.expiresIn.${pkg.expiration_unit || 'days'}`, { count: Number(pkg.expiration_days) })}</span>
          </div>
          <div style={styles.headerRight}>
            <div style={styles.saveRow}><SaveChanges /></div>
            <div style={styles.saveRow}>
              <Badge variant={STATUS_VARIANTS[pkg.status] || 'neutral'}>{t(`shared.status.${pkg.status}`, { defaultValue: pkg.status })}</Badge>
              <span style={styles.price}>{formatCurrency(pkg.price)}</span>
              <span style={styles.sold}>{t('packageDetail.sold', { count: Number(pkg.active_purchases || 0) })}</span>
              <CopyWidgetSnippetButton
                productId={pkg.id}
                productName={pkg.name}
                action="purchase"
                enabled={pkg.status === 'active'}
                disabledReason={t('packageDetail.snippetHint')}
              />
            </div>
          </div>
        </div>
        <TabBar aria-label={t('packageDetail.sections')} tabs={[{ key: 'details' as const, label: t('membershipDetail.tabDetails') }, { key: 'people' as const, label: t('packageDetail.tabBuyers') }].map((t) => ({ ...t, changed: dirtySections.some((s) => s.tab === t.key) }))} active={activeTab} onChange={setActiveTab} />
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
  const { t } = useTranslation('offerings');
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
  const draft = useDraft('package-details', t('packageDetail.draftName'), fromPkg(pkg), async (form) => {
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
    } catch { void showMessage({ message: t(`packageDetail.failedTo.${action}`, { defaultValue: `Failed to ${action}` }), tone: 'error' }); }
    finally { setStatusChanging(false); }
  };

  return (
    <>
      <div style={styles.actionsBar}>
        {pkg.status === 'active' && <Button variant="secondary" size="sm" onClick={() => handleStatus('pause')} loading={statusChanging}>{t('shared.pause')}</Button>}
        {(pkg.status === 'paused' || pkg.status === 'archived') && <Button variant="secondary" size="sm" onClick={() => handleStatus('activate')} loading={statusChanging}>{t('shared.activate')}</Button>}
        {pkg.status !== 'archived' && <Button variant="destructive" size="sm" onClick={() => handleStatus('archive')} loading={statusChanging}>{t('shared.archive')}</Button>}
      </div>
      <div style={{ ...styles.card, ...draftBox(draft.dirty) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ ...styles.cardTitle, margin: 0 }}>{t('packageDetail.details')}<UnsavedTag dirty={draft.dirty} /></h3>
          <TranslateButton entityType="package" entityId={pkg.id} title={pkg.name} label={t('serviceDetail.translate')} />
        </div>
        <div style={styles.formGrid}>
          <div style={styles.formGroup}><label style={styles.label}>{t('shared.nameRequired')}</label><input style={{ ...styles.input, ...mark('name') }} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('shared.priceRequired')}</label>
            <input style={{ ...styles.input, ...mark('price') }} type="number" step="0.01" min="0" value={priceDisplay}
              onChange={(e) => { setPriceDisplay(e.target.value); setForm({ ...form, price: Math.round(parseFloat(e.target.value || '0') * 100) || 0 }); }}
              onBlur={() => setPriceDisplay((form.price / 100).toFixed(2))} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('packages.expiration')}</label>
            <select style={{ ...styles.input, ...mark('expiration_type') }} value={form.expiration_type} onChange={(e) => setForm({ ...form, expiration_type: e.target.value })}>
              <option value="none">{t('packages.neverExpires')}</option>
              <option value="days_from_purchase">{t('packageDetail.fromPurchase')}</option>
            </select>
          </div>
          {form.expiration_type === 'days_from_purchase' && (
            <div style={styles.formGroup}>
              <label style={styles.label}>{t('packages.expiresAfter')}</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input style={{ ...styles.input, flex: 1, ...mark('expiration_days') }} type="number" min="1" value={form.expiration_days} onChange={(e) => setForm({ ...form, expiration_days: e.target.value })} />
                <select style={{ ...styles.input, width: '120px', ...mark('expiration_unit') }} value={form.expiration_unit} onChange={(e) => setForm({ ...form, expiration_unit: e.target.value })}>
                  <option value="days">{t('packages.days')}</option>
                  <option value="weeks">{t('packages.weeks')}</option>
                  <option value="months">{t('packages.months')}</option>
                </select>
              </div>
            </div>
          )}
          <div style={styles.formGroup}>
            <label style={styles.label}>{t('serviceDetail.taxCategory')}</label>
            <select style={{ ...styles.input, ...mark('tax_category_id') }} value={form.tax_category_id} onChange={(e) => setForm({ ...form, tax_category_id: e.target.value })}>
              <option value="">{t('serviceDetail.noTax')}</option>
              {taxCategories.map((tc: any) => <option key={tc.id} value={tc.id}>{tc.name} ({formatNumber(tc.rate / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%)</option>)}
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{'\u00A0'}</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer', paddingTop: '4px' }}>
              <input type="checkbox" checked={form.new_customers_only} onChange={(e) => setForm({ ...form, new_customers_only: e.target.checked })} style={{ width: '16px', height: '16px', ...checkMark(draft.changed((v) => v.new_customers_only)) }} /> {t('packages.newCustomersOnly')}
            </label>
          </div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}><label style={styles.label}>{t('shared.shortDescription')}</label><input style={{ ...styles.input, ...mark('short_description') }} value={form.short_description} onChange={(e) => setForm({ ...form, short_description: e.target.value })} /></div>
          <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}><label style={styles.label}>{t('shared.description')}</label><textarea style={{ ...styles.input, minHeight: '80px', resize: 'vertical', maxWidth: '100%', ...mark('description') }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>
      </div>
    </>
  );
}

// Included items wait for the page's Save changes.
const itemChanges = (i: any) => ({ quantity: i.quantity, variant_id: i.redemption_type === 'minutes' ? null : (i.variant_id || null), redemption_type: i.redemption_type });

function PackageItemsCard({ packageId }: { packageId: string }) {
  const { t } = useTranslation('offerings');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ key?: string; item?: any } | null>(null);
  const list = useDraftList<any>('package-items', t('packageDetail.itemsDraftName'), {
    create: (i) => apiClient.post(`/v1/packages/${packageId}/items`, {
      item_type: i.item_type, service_id: i.item_type === 'service' ? i.service_id : undefined,
      merchandise_id: i.item_type === 'merchandise' ? i.merchandise_id : undefined,
      addon_id: i.item_type === 'add_on' ? i.addon_id : undefined,
      variant_id: i.redemption_type === 'minutes' || i.item_type === 'add_on' ? undefined : (i.variant_id || undefined),
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
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>{t('packageDetail.itemsTitle')}<UnsavedTag dirty={list.dirty} /></h3>
        <Button size="sm" variant="secondary" onClick={() => setEditing({})}>{t('packageDetail.addItem')}</Button>
      </div>
      {loading && <p style={styles.muted}>{t('common:loading')}</p>}
      {!loading && list.rows.length === 0 && <p style={styles.muted}>{t('packageDetail.noItems')}</p>}
      {list.rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {list.rows.map((r) => {
            const item = r.item;
            const edited = !r.isNew && !r.deleted && list.changed(r, itemChanges);
            return (
              <div key={r.key} style={{ ...styles.itemRow, opacity: r.deleted ? 0.6 : 1, ...(edited ? fieldMark(true) : {}) }}>
                <div style={{ flex: 1, textDecoration: r.deleted ? 'line-through' : 'none' }}>
                  <Badge variant={item.item_type === 'service' ? 'info' : 'neutral'}>{item.item_type === 'service' ? t('membershipDetail.service') : item.item_type === 'add_on' ? t('packageDetail.addOn') : t('membershipDetail.product')}</Badge><strong style={{ marginLeft: '8px' }}>{item.service_name || item.merchandise_name || item.addon_name || t('membershipDetail.unknown')}</strong>
                  {r.isNew && <> <RowTag>{t('serviceDetail.rowNew')}</RowTag></>}
                  {edited && <> <RowTag>{t('serviceDetail.rowChanged')}</RowTag></>}
                  {r.deleted && <> <RowTag>{t('serviceDetail.rowDeleted')}</RowTag></>}
                </div>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{item.redemption_type === 'minutes' ? t('services.minutes', { value: item.quantity }) : `×${item.quantity}`}</span>
                {r.deleted ? <Button size="sm" variant="ghost" onClick={() => list.undo(r.key)}>{t('serviceDetail.undo')}</Button> : <>
                  <button style={styles.editBtn} onClick={() => setEditing({ key: r.key, item })} title={t('common:edit')}>✏️</button>
                  <button style={styles.deleteBtn} onClick={() => list.remove(r.key)} title={t('serviceDetail.remove')}>×</button>
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
  const { t } = useTranslation('offerings');
  const businessId = localStorage.getItem('business_id') || '';
  const [itemType, setItemType] = useState<'service' | 'merchandise' | 'add_on'>(item?.item_type || 'service');
  // add-ons a package can include (spec 51, gap 15): used with the appointment's package
  const [addons, setAddons] = useState<Array<{ id: string; name: string }>>([]);
  const [redemptionType, setRedemptionType] = useState<'sessions' | 'minutes'>(item?.redemption_type || 'sessions');
  const [services, setServices] = useState<any[]>([]);
  const [merchandise, setMerchandise] = useState<any[]>([]);
  const [variants, setVariants] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState(item?.service_id || item?.merchandise_id || item?.addon_id || '');
  const [selectedVariantId, setSelectedVariantId] = useState(item?.variant_id || '');
  const [quantity, setQuantity] = useState(item?.quantity || 1);
  const [error, setError] = useState('');
  const isEditing = !!item;

  useEffect(() => {
    apiClient.get(`/v1/services?business_id=${businessId}&status=active&limit=100`).then((r) => setServices(r.data.data || [])).catch(() => {});
    apiClient.get(`/v1/merchandise?business_id=${businessId}&status=active&limit=100`).then((r) => setMerchandise(r.data.data || [])).catch(() => {});
    apiClient.get('/v1/addons', { params: { business_id: businessId } })
      .then((r) => setAddons(((r.data.data || []) as Array<{ id: string; name: string; service_name: string }>).map((a) => ({ id: a.id, name: `${a.name} (${a.service_name})` }))))
      .catch(() => {});
  }, [businessId]);

  useEffect(() => {
    if (!selectedId || itemType === 'add_on') { setVariants([]); if (!isEditing) setSelectedVariantId(''); return; }
    const url = itemType === 'service' ? `/v1/services/${selectedId}/variants` : `/v1/merchandise/${selectedId}/variants`;
    apiClient.get(url).then((r) => setVariants(r.data.data || [])).catch(() => setVariants([]));
    if (!isEditing) setSelectedVariantId('');
  }, [selectedId, itemType]);

  const options = itemType === 'service' ? services : itemType === 'add_on' ? addons : merchandise;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId && !isEditing) { setError(t('membershipDetail.selectItem')); return; }
    const variant_id = redemptionType === 'minutes' ? undefined : (selectedVariantId || undefined);
    if (isEditing) { onDone({ quantity, variant_id, redemption_type: redemptionType }); return; }
    const name = options.find((o: any) => o.id === selectedId)?.name;
    onDone({
      item_type: itemType, service_id: itemType === 'service' ? selectedId : undefined,
      merchandise_id: itemType === 'merchandise' ? selectedId : undefined,
      addon_id: itemType === 'add_on' ? selectedId : undefined,
      service_name: itemType === 'service' ? name : undefined, merchandise_name: itemType === 'merchandise' ? name : undefined,
      addon_name: itemType === 'add_on' ? name : undefined,
      variant_id, quantity, redemption_type: redemptionType,
    });
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}><h3 style={styles.modalTitle}>{isEditing ? t('packageDetail.editItem') : t('packageDetail.addItem')}</h3><button style={styles.closeBtn} onClick={onClose} aria-label={t('common:modal.close')}>×</button></div>
        {error && <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: '0 0 8px' }}>{error}</p>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={styles.formGroup}><label style={styles.label}>{t('shared.type')}</label><select style={styles.input} value={itemType} disabled={isEditing} onChange={(e) => { setItemType(e.target.value as any); setSelectedId(''); }}><option value="service">{t('membershipDetail.service')}</option><option value="merchandise">{t('membershipDetail.product')}</option><option value="add_on">{t('packageDetail.addOn')}</option></select></div>
          <div style={styles.formGroup}><label style={styles.label}>{itemType === 'service' ? t('membershipDetail.service') : itemType === 'add_on' ? t('packageDetail.addOn') : t('membershipDetail.product')} *</label><select style={styles.input} value={selectedId} disabled={isEditing} onChange={(e) => setSelectedId(e.target.value)} required><option value="">{t('shared.select')}</option>{options.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          {itemType === 'service' && (
            <div style={styles.formGroup}><label style={styles.label}>{t('packageDetail.redemptionMode')}</label><select style={styles.input} value={redemptionType} onChange={(e) => { setRedemptionType(e.target.value as any); if (e.target.value === 'minutes') setSelectedVariantId(''); }}><option value="sessions">{t('packageDetail.fixedSessions')}</option><option value="minutes">{t('packageDetail.timePool')}</option></select></div>
          )}
          {redemptionType === 'sessions' && variants.length > 0 && (<div style={styles.formGroup}><label style={styles.label}>{t('membershipDetail.variant')}</label><select style={styles.input} value={selectedVariantId} onChange={(e) => setSelectedVariantId(e.target.value)}><option value="">{t('packageDetail.allAny')}</option>{variants.map((v: any) => <option key={v.id} value={v.id}>{v.name}{v.price != null ? ` — ${formatCurrency(v.price)}` : ''}</option>)}</select></div>)}
          <div style={styles.formGroup}><label style={styles.label}>{redemptionType === 'minutes' ? t('packageDetail.totalMinutes') : itemType === 'add_on' ? t('packageDetail.quantityUses') : t('packageDetail.quantitySessions')}</label><input style={styles.input} type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />{redemptionType === 'minutes' && <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '2px' }}>{quantity >= 60 ? (quantity % 60 > 0 ? t('packageDetail.hoursMinutes', { hours: Math.floor(quantity / 60), minutes: quantity % 60 }) : t('packageDetail.hoursOnly', { hours: Math.floor(quantity / 60) })) : t('packageDetail.minutesOnly', { minutes: quantity })}</span>}</div>
          <p style={{ ...styles.muted, fontSize: 'var(--font-size-xs)' }}>{t('serviceDetail.savedWithPage')}</p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}><Button variant="secondary" type="button" onClick={onClose}>{t('common:cancel')}</Button><Button type="submit">{isEditing ? t('serviceDetail.done') : t('packageDetail.addItem')}</Button></div>
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
