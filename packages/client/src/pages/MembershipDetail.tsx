import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { CopyWidgetSnippetButton } from '../components/CopyWidgetSnippetButton';
import { StickyPageTop } from '../design-system/components/layout/StickyPageTop';
import { TabBar } from '../design-system/components/navigation/TabBar';
import { MembershipPeople } from '../components/OfferingPeople';
import { DraftSectionsProvider, DraftTab, useDraftSections, useDraft, useDraftList, fieldMark, draftBox, UnsavedTag, RowTag } from '../components/unsaved/DraftSections';
import { LeaveGuard, useGuardedNavigate } from '../components/unsaved/LeaveGuard';
import { SaveChanges } from '../components/unsaved/SaveChanges';
import { apiClient } from '../api/client';
import { formatCurrency } from '../utils/currency';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success', draft: 'neutral', paused: 'warning', archived: 'error',
};

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly', quarterly: 'Quarterly', annually: 'Annually',
};

interface MembershipPlan {
  id: string;
  name: string;
  description?: string;
  short_description?: string;
  billing_frequency: string;
  price: number;
  status: string;
  trial_days: number;
  discount_services_pct: number;
  discount_merchandise_pct: number;
  display_order: number;
  active_enrollments: number;
  created_at: string;
}

interface PlanItem {
  id: string;
  item_type: string;
  service_id?: string;
  merchandise_id?: string;
  variant_id?: string;
  quantity_per_period: number;
  access_frequency?: string;
  service_name?: string;
  merchandise_name?: string;
}

// One Save for the plan (David, 2026-11-02, as in Settings, Events and People): details and
// included items wait for Save changes; Pause, Activate and Archive act straight away.
export function MembershipDetail() {
  return (
    <DraftSectionsProvider>
      <MembershipDetailPage />
    </DraftSectionsProvider>
  );
}

function MembershipDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useGuardedNavigate();
  const [plan, setPlan] = useState<MembershipPlan | null>(null);
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
    apiClient.get(`/v1/memberships/plans/${id}?business_id=${businessId}`)
      .then((res) => setPlan(res.data.data))
      .catch(() => setPlan(null))
      .finally(() => setLoading(false));
  }, [id, businessId]);

  if (loading) return <div style={styles.loading}>Loading...</div>;
  if (!plan) return <div style={styles.loading}>Membership plan not found</div>;

  return (
    <div style={styles.page}>
      <LeaveGuard when={dirtySections.length > 0} />
      <StickyPageTop>
        <button style={styles.back} onClick={() => navigate('/offers?tab=memberships')}>← Back to Offerings</button>

        {/* Header Card */}
        <div style={styles.headerCard}>
          <div style={styles.headerInfo}>
            <h1 style={styles.name}>{plan.name}</h1>
            <span style={styles.frequency}>{FREQUENCY_LABELS[plan.billing_frequency] || plan.billing_frequency}</span>
          </div>
          <div style={styles.headerRight}>
            <div style={styles.saveRow}><SaveChanges /></div>
            <div style={styles.saveRow}>
              <Badge variant={STATUS_VARIANTS[plan.status] || 'neutral'}>{plan.status}</Badge>
              <span style={styles.price}>{formatCurrency(plan.price)}/period</span>
              <span style={styles.enrolled}>{plan.active_enrollments} enrolled</span>
              <CopyWidgetSnippetButton
                productId={plan.id}
                productName={plan.name}
                action="purchase"
                enabled={plan.status === 'active'}
                disabledReason="Activate this plan to get a widget snippet"
              />
            </div>
          </div>
        </div>
        <TabBar aria-label="Membership sections" tabs={[{ key: 'details' as const, label: 'Details' }, { key: 'people' as const, label: 'Enrolled' }].map((t) => ({ ...t, changed: dirtySections.some((s) => s.tab === t.key) }))} active={activeTab} onChange={setActiveTab} />
      </StickyPageTop>

      {/* Details stay mounted, so their edits survive switching tabs. */}
      <div hidden={activeTab !== 'details'}>
        <DraftTab tab="details">
          <PlanForm plan={plan} businessId={businessId} onUpdate={setPlan} />
          <PlanItemsCard planId={plan.id} />
        </DraftTab>
      </div>
      {activeTab === 'people' && <MembershipPeople planId={plan.id} businessId={businessId} />}
    </div>
  );
}

// --- Plan Form (always editable; saved with the page's Save changes) ---

function PlanForm({ plan, businessId, onUpdate }: { plan: MembershipPlan; businessId: string; onUpdate: (p: MembershipPlan) => void }) {
  const [statusChanging, setStatusChanging] = useState(false);
  const [taxCategories, setTaxCategories] = useState<any[]>([]);
  const fromPlan = (p: MembershipPlan) => ({
    name: p.name,
    description: p.description || '',
    short_description: p.short_description || '',
    billing_frequency: p.billing_frequency,
    price: p.price,
    trial_days: p.trial_days,
    discount_services_pct: p.discount_services_pct,
    discount_merchandise_pct: p.discount_merchandise_pct,
    is_taxable: (p as any).is_taxable || false,
    tax_category_id: (p as any).tax_category_id || '',
  });
  const draft = useDraft('plan-details', 'Plan details', fromPlan(plan), async (form) => {
    const res = await apiClient.put(`/v1/memberships/plans/${plan.id}?business_id=${businessId}`, form);
    const updated = { ...plan, ...res.data.data };
    onUpdate(updated);
    return fromPlan(updated);
  });
  const form = draft.value;
  const setForm = draft.setValue;
  const mark = (key: keyof typeof form) => fieldMark(draft.changed((v) => v[key]));
  const [priceDisplay, setPriceDisplay] = useState((plan.price / 100).toFixed(2));
  // The price box follows the stored price after a save.
  useEffect(() => { setPriceDisplay((draft.saved.price / 100).toFixed(2)); }, [draft.saved.price]);

  useEffect(() => {
    apiClient.get(`/v1/services/tax-categories?business_id=${businessId}`).then((r) => setTaxCategories(r.data.data || [])).catch(() => {});
  }, [businessId]);

  const handleStatusAction = async (action: string) => {
    setStatusChanging(true);
    try {
      await apiClient.put(`/v1/memberships/plans/${plan.id}/${action}?business_id=${businessId}`);
      const res = await apiClient.get(`/v1/memberships/plans/${plan.id}?business_id=${businessId}`);
      onUpdate(res.data.data);
    } catch { alert(`Failed to ${action}`); }
    finally { setStatusChanging(false); }
  };

  return (
    <>
      {/* Actions bar */}
      <div style={styles.actionsBar}>
        {plan.status === 'active' && <Button variant="secondary" size="sm" onClick={() => handleStatusAction('pause')} loading={statusChanging}>Pause</Button>}
        {(plan.status === 'paused' || plan.status === 'draft') && <Button variant="secondary" size="sm" onClick={() => handleStatusAction('activate')} loading={statusChanging}>Activate</Button>}
        {plan.status !== 'archived' && <Button variant="destructive" size="sm" onClick={() => handleStatusAction('archive')} loading={statusChanging}>Archive</Button>}
      </div>

      {/* Plan Details Card */}
      <div style={{ ...styles.card, ...draftBox(draft.dirty) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ ...styles.cardTitle, margin: 0 }}>Plan Details<UnsavedTag dirty={draft.dirty} /></h3>
          <Button size="sm" variant="secondary" onClick={() => { /* TODO: translate */ }}>Translate</Button>
        </div>
        <div style={styles.formGrid}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Name *</label>
            <input style={{ ...styles.input, ...mark('name') }} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Billing Frequency</label>
            <select style={{ ...styles.input, ...mark('billing_frequency') }} value={form.billing_frequency} onChange={(e) => setForm({ ...form, billing_frequency: e.target.value })}>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annually">Annually</option>
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Price per Period</label>
            <input style={{ ...styles.input, ...mark('price') }} type="number" step="0.01" min="0" value={priceDisplay}
              onChange={(e) => { setPriceDisplay(e.target.value); setForm({ ...form, price: Math.round(parseFloat(e.target.value || '0') * 100) || 0 }); }}
              onBlur={() => setPriceDisplay((form.price / 100).toFixed(2))}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Trial Days</label>
            <input style={{ ...styles.input, ...mark('trial_days') }} type="number" min={0} value={form.trial_days} onChange={(e) => setForm({ ...form, trial_days: Number(e.target.value) })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Discount on Services (%)</label>
            <input style={{ ...styles.input, ...mark('discount_services_pct') }} type="number" min={0} max={100} value={form.discount_services_pct} onChange={(e) => setForm({ ...form, discount_services_pct: Number(e.target.value) })} />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Discount on Products (%)</label>
            <input style={{ ...styles.input, ...mark('discount_merchandise_pct') }} type="number" min={0} max={100} value={form.discount_merchandise_pct} onChange={(e) => setForm({ ...form, discount_merchandise_pct: Number(e.target.value) })} />
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

// --- Plan Items Card (included services/products per period; saved with the page's Save changes) ---

const itemChanges = (i: PlanItem) => ({ quantity_per_period: i.quantity_per_period, variant_id: i.variant_id || null, access_frequency: i.access_frequency });

function PlanItemsCard({ planId }: { planId: string }) {
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ key?: string; item?: PlanItem } | null>(null);
  const list = useDraftList<PlanItem>('plan-items', 'Included items', {
    create: (i) => apiClient.post(`/v1/memberships/plans/${planId}/items`, {
      item_type: i.item_type,
      service_id: i.item_type === 'service' ? i.service_id : undefined,
      merchandise_id: i.item_type === 'merchandise' ? i.merchandise_id : undefined,
      variant_id: i.variant_id || undefined,
      quantity_per_period: i.quantity_per_period,
      access_frequency: i.access_frequency,
    }).then((r) => ({ ...i, ...r.data.data })),
    // Update existing item (quantity, variant, access frequency)
    update: (i) => apiClient.put(`/v1/memberships/plans/${planId}/items/${i.id}`, itemChanges(i)).then((r) => ({ ...i, ...r.data.data })),
    remove: (i) => apiClient.delete(`/v1/memberships/plans/${planId}/items/${i.id}`).then(() => undefined),
  });

  const fetchItems = useCallback(async () => {
    try {
      const res = await apiClient.get(`/v1/memberships/plans/${planId}/items`);
      list.load(res.data.data || []);
    } catch { list.load([]); }
    finally { setLoading(false); }
  }, [planId, list.load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchItems(); }, [fetchItems]);

  return (
    <div style={{ ...styles.card, ...draftBox(list.dirty) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Included Items (per period)<UnsavedTag dirty={list.dirty} /></h3>
        <Button size="sm" variant="secondary" onClick={() => setEditing({})}>Add Item</Button>
      </div>

      {loading && <p style={styles.muted}>Loading...</p>}
      {!loading && list.rows.length === 0 && <p style={styles.muted}>No items included in this plan. Add services or products that members receive each billing period.</p>}
      {list.rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {list.rows.map((r) => {
            const item = r.item;
            const edited = !r.isNew && !r.deleted && list.changed(r, itemChanges);
            return (
              <div key={r.key} style={{ ...styles.itemRow, opacity: r.deleted ? 0.6 : 1, ...(edited ? fieldMark(true) : {}) }}>
                <div style={{ flex: 1, textDecoration: r.deleted ? 'line-through' : 'none' }}>
                  <Badge variant={item.item_type === 'service' ? 'info' : 'neutral'}>{item.item_type === 'service' ? 'Service' : 'Product'}</Badge>
                  <strong style={{ marginLeft: '8px' }}>{item.service_name || item.merchandise_name || 'Unknown'}</strong>
                  {r.isNew && <> <RowTag>New</RowTag></>}
                  {edited && <> <RowTag>Changed</RowTag></>}
                  {r.deleted && <> <RowTag>Deleted when you save</RowTag></>}
                </div>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{item.access_frequency === 'unlimited' ? 'Unlimited' : `×${item.quantity_per_period}/${item.access_frequency === 'daily' ? 'day' : item.access_frequency === 'weekly' ? 'week' : 'month'}`}</span>
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
        <AddEditPlanItemModal
          item={editing.item || null}
          onClose={() => setEditing(null)}
          onDone={(data) => {
            if (editing.key) list.edit(editing.key, data);
            else list.add(data as PlanItem);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// --- Add Plan Item Modal ---

function AddEditPlanItemModal({ item, onClose, onDone }: { item: PlanItem | null; onClose: () => void; onDone: (data: Partial<PlanItem>) => void }) {
  const businessId = localStorage.getItem('business_id') || '';
  const [itemType, setItemType] = useState<'service' | 'merchandise'>(item?.item_type as any || 'service');
  const [services, setServices] = useState<any[]>([]);
  const [merchandise, setMerchandise] = useState<any[]>([]);
  const [variants, setVariants] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState(item?.service_id || item?.merchandise_id || '');
  const [selectedVariantId, setSelectedVariantId] = useState(item?.variant_id || '');
  const [quantity, setQuantity] = useState(item?.quantity_per_period || 1);
  const [accessFrequency, setAccessFrequency] = useState(item?.access_frequency || 'monthly');
  const [error, setError] = useState('');

  const isEditing = !!item;

  useEffect(() => {
    apiClient.get(`/v1/services?business_id=${businessId}&status=active&limit=100`).then((r) => setServices(r.data.data || [])).catch(() => {});
    apiClient.get(`/v1/merchandise?business_id=${businessId}&status=active&limit=100`).then((r) => setMerchandise(r.data.data || [])).catch(() => {});
  }, [businessId]);

  // Fetch variants when an item is selected
  useEffect(() => {
    if (!selectedId) { setVariants([]); setSelectedVariantId(''); return; }
    if (itemType === 'service') {
      apiClient.get(`/v1/services/${selectedId}/variants`).then((r) => setVariants(r.data.data || [])).catch(() => setVariants([]));
    } else {
      apiClient.get(`/v1/merchandise/${selectedId}/variants`).then((r) => setVariants(r.data.data || [])).catch(() => setVariants([]));
    }
    if (!isEditing) setSelectedVariantId('');
  }, [selectedId, itemType]);

  const options = itemType === 'service' ? services : merchandise;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId && !isEditing) { setError('Select an item'); return; }
    if (isEditing) {
      onDone({ quantity_per_period: quantity, variant_id: selectedVariantId || undefined, access_frequency: accessFrequency });
      return;
    }
    const name = options.find((o: any) => o.id === selectedId)?.name;
    onDone({
      item_type: itemType,
      service_id: itemType === 'service' ? selectedId : undefined,
      merchandise_id: itemType === 'merchandise' ? selectedId : undefined,
      service_name: itemType === 'service' ? name : undefined,
      merchandise_name: itemType === 'merchandise' ? name : undefined,
      variant_id: selectedVariantId || undefined,
      quantity_per_period: quantity,
      access_frequency: accessFrequency,
    });
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>{isEditing ? 'Edit Included Item' : 'Add Included Item'}</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        {error && <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: '0 0 8px 0' }}>{error}</p>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Item Type</label>
            <select style={styles.input} value={itemType} disabled={isEditing} onChange={(e) => { setItemType(e.target.value as 'service' | 'merchandise'); setSelectedId(''); setVariants([]); setSelectedVariantId(''); }}>
              <option value="service">Service</option>
              <option value="merchandise">Product</option>
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{itemType === 'service' ? 'Service' : 'Product'} *</label>
            <select style={styles.input} value={selectedId} disabled={isEditing} onChange={(e) => setSelectedId(e.target.value)} required>
              <option value="">Select...</option>
              {options.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          {variants.length > 0 && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Variant</label>
              <select style={styles.input} value={selectedVariantId} onChange={(e) => setSelectedVariantId(e.target.value)}>
                <option value="">All variants / any</option>
                {variants.map((v: any) => <option key={v.id} value={v.id}>{v.name}{v.price != null ? ` — ${formatCurrency(v.price)}` : ''}{v.duration ? ` — ${v.duration} min` : ''}</option>)}
              </select>
            </div>
          )}
          <div style={styles.formGroup}>
            <label style={styles.label}>Access Frequency</label>
            <select style={styles.input} value={accessFrequency} onChange={(e) => setAccessFrequency(e.target.value)}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="unlimited">Unlimited</option>
            </select>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '2px' }}>How often the allowance resets (use-it-or-lose-it)</span>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>{accessFrequency === 'unlimited' ? 'Unlimited' : `Quantity per ${accessFrequency === 'daily' ? 'day' : accessFrequency === 'weekly' ? 'week' : 'month'}`}</label>
            {accessFrequency !== 'unlimited' && <input style={styles.input} type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />}
            {accessFrequency === 'unlimited' && <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', padding: '10px 0' }}>No limit on usage</span>}
          </div>
          <p style={{ ...styles.muted, fontSize: 'var(--font-size-xs)' }}>Saved with the page's Save changes.</p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit">{isEditing ? 'Done' : 'Add Item'}</Button>
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
  headerCard: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-lg)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-md)' },
  headerInfo: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  name: { margin: 0, fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)' },
  frequency: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  headerRight: { display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', gap: '6px' },
  saveRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' },
  price: { fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)' },
  enrolled: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
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
  deleteBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-lg)', color: 'var(--color-error)', padding: '2px 6px', lineHeight: 1, borderRadius: 'var(--button-radius)', minHeight: 'var(--button-height-sm)' },
  editBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-base)', padding: '2px 4px', borderRadius: 'var(--button-radius)', minHeight: 'var(--button-height-sm)' },
  overlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '450px', maxHeight: '85vh', overflow: 'auto', border: '1px solid var(--color-border)', boxShadow: '0 10px 25px rgba(0,0,0,0.3)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  modalTitle: { margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)' },
  closeBtn: { background: 'none', border: 'none', fontSize: 'var(--font-size-xl)', cursor: 'pointer', color: 'var(--color-text-secondary)' },
};
