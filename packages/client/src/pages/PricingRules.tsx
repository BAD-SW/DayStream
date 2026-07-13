import { useState, useEffect } from 'react';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import * as pricingApi from '../api/pricing';
import type { PricingRule, PricingBundle } from '../api/pricing';
import { formatCurrency } from '../utils/currency';

const TYPE_LABELS: Record<string, string> = {
  membership: 'Membership', promotion: 'Promotion', seasonal: 'Promotion', first_time: 'First Time',
  corporate: 'Corporate', volume: 'Volume', time_of_day: 'Time of Day', day_of_week: 'Day of Week',
};

type PricingTab = 'rules' | 'bundles' | 'corporate';

export function PricingRules() {
  const [activeTab, setActiveTab] = useState<PricingTab>('rules');
  const businessId = localStorage.getItem('business_id') || '';

  const tabItems: { key: PricingTab; label: string }[] = [
    { key: 'rules', label: 'Pricing Rules' },
    { key: 'bundles', label: 'Bundles' },
    { key: 'corporate', label: 'Corporate' },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Pricing</h1>
      </div>
      <div style={styles.tabs}>
        {tabItems.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{ ...styles.tabBtn, ...(activeTab === tab.key ? styles.tabBtnActive : {}) }}>
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === 'rules' && <RulesSection businessId={businessId} />}
      {activeTab === 'bundles' && <BundlesSection businessId={businessId} />}
      {activeTab === 'corporate' && <CorporateSection businessId={businessId} />}
    </div>
  );
}

// ============================================================
// Pricing Rules
// ============================================================

function RulesSection({ businessId }: { businessId: string }) {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<PricingRule | null>(null);
  const [membershipPlans, setMembershipPlans] = useState<any[]>([]);
  const [corporateAccounts, setCorporateAccounts] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: '', rule_type: 'promotion', discount_type: 'percentage', discount_value: '',
    priority: '100', stacking_mode: 'stackable',
    // Conditional fields
    effective_from: '', effective_to: '',
    days_of_week: [] as number[],
    time_from: '', time_to: '',
    min_purchase_amount: '',
    first_time_booking_limit: '',
    membership_plan_ids: [] as string[],
    corporate_account_id: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    pricingApi.getRules(businessId).then(setRules).finally(() => setLoading(false));
    // Load membership plans for the membership rule type selector
    import('../api/memberships').then((api) => {
      api.getPlans(businessId).then(setMembershipPlans).catch(() => {});
    });
    // Load corporate accounts for the corporate rule type selector
    pricingApi.getCorporateAccounts(businessId).then(setCorporateAccounts).catch(() => {});
  }, [businessId]);

  const resetForm = () => setForm({ name: '', rule_type: 'promotion', discount_type: 'percentage', discount_value: '', priority: '100', stacking_mode: 'stackable', effective_from: '', effective_to: '', days_of_week: [], time_from: '', time_to: '', min_purchase_amount: '', first_time_booking_limit: '', membership_plan_ids: [], corporate_account_id: '' });

  const openCreate = () => { resetForm(); setEditingRule(null); setShowForm(true); setError(''); };

  const openEdit = (rule: PricingRule) => {
    setEditingRule(rule);
    setForm({
      name: rule.name,
      rule_type: rule.rule_type,
      discount_type: rule.discount_type,
      discount_value: rule.discount_type.includes('percentage') ? String(rule.discount_value) : (rule.discount_value / 100).toFixed(2),
      priority: String(rule.priority),
      stacking_mode: rule.stacking_mode,
      effective_from: (rule as any).effective_from ? (rule as any).effective_from.split('T')[0] : '',
      effective_to: (rule as any).effective_to ? (rule as any).effective_to.split('T')[0] : '',
      days_of_week: (rule as any).days_of_week || [],
      time_from: (rule as any).time_from || '',
      time_to: (rule as any).time_to || '',
      min_purchase_amount: (rule as any).min_purchase_amount ? ((rule as any).min_purchase_amount / 100).toFixed(2) : '',
      first_time_booking_limit: (rule as any).first_time_booking_limit ? String((rule as any).first_time_booking_limit) : '',
      membership_plan_ids: (rule as any).membership_plan_ids || [],
      corporate_account_id: (rule as any).corporate_account_id || '',
    });
    setShowForm(true);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const data: any = {
        name: form.name,
        rule_type: form.rule_type,
        discount_type: form.discount_type,
        discount_value: form.discount_type.includes('percentage') ? parseInt(form.discount_value) : Math.round(parseFloat(form.discount_value) * 100),
        priority: parseInt(form.priority),
        stacking_mode: form.stacking_mode,
      };
      // Conditional fields based on rule type
      if (form.effective_from) data.effective_from = form.effective_from + 'T00:00:00Z';
      if (form.effective_to) data.effective_to = form.effective_to + 'T23:59:59Z';
      if (form.days_of_week.length > 0) data.days_of_week = form.days_of_week;
      if (form.time_from) data.time_from = form.time_from;
      if (form.time_to) data.time_to = form.time_to;
      if (form.min_purchase_amount) data.min_purchase_amount = Math.round(parseFloat(form.min_purchase_amount) * 100);
      if (form.first_time_booking_limit) data.first_time_booking_limit = parseInt(form.first_time_booking_limit);
      if (form.membership_plan_ids.length > 0) data.membership_plan_ids = form.membership_plan_ids;
      if (form.corporate_account_id) data.corporate_account_id = form.corporate_account_id;

      if (editingRule) {
        const updated = await pricingApi.updateRule(editingRule.id, businessId, data);
        setRules(rules.map((r) => r.id === editingRule.id ? { ...r, ...updated } : r));
      } else {
        data.business_id = businessId;
        const created = await pricingApi.createRule(data);
        setRules([...rules, created]);
      }
      setShowForm(false);
      setEditingRule(null);
      resetForm();
    } catch (err: any) { setError(err.response?.data?.error || 'Failed to save rule'); }
    finally { setSaving(false); }
  };

  const handleToggle = async (rule: PricingRule) => {
    const newStatus = rule.status === 'active' ? 'inactive' : 'active';
    await pricingApi.updateRule(rule.id, businessId, { status: newStatus });
    setRules(rules.map((r) => r.id === rule.id ? { ...r, status: newStatus } : r));
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this pricing rule?')) return;
    await pricingApi.deleteRule(id, businessId);
    setRules(rules.filter((r) => r.id !== id));
  };

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'rule_type', header: 'Type', render: (v: string) => <Badge variant="neutral">{TYPE_LABELS[v] || v}</Badge> },
    { key: 'discount', header: 'Adjustment', render: (_: any, r: PricingRule) => {
      const isPremium = r.discount_type.startsWith('premium');
      const isPercent = r.discount_type.includes('percentage');
      const prefix = isPremium ? '+' : '-';
      const value = isPercent ? `${r.discount_value}%` : formatCurrency(r.discount_value);
      return <span style={{ color: isPremium ? 'var(--color-error)' : 'var(--color-success)' }}>{prefix}{value}</span>;
    }},
    { key: 'priority', header: 'Priority' },
    { key: 'stacking_mode', header: 'Stacking', render: (v: string) => v.replace('_', ' ') },
    { key: 'status', header: 'Status', render: (v: string) => <Badge variant={v === 'active' ? 'success' : 'neutral'}>{v}</Badge> },
    {
      key: 'actions', header: '',
      render: (_: any, r: PricingRule) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          <button style={styles.actionBtn} onClick={(e) => { e.stopPropagation(); handleToggle(r); }}>{r.status === 'active' ? 'Disable' : 'Enable'}</button>
          <button style={styles.actionBtn} onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}>Delete</button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <Button onClick={openCreate}>Create Rule</Button>
      </div>

      {showForm && (
        <div style={styles.formPanel}>
          <h3 style={styles.formTitle}>{editingRule ? 'Edit Rule' : 'New Pricing Rule'}</h3>
          {error && <p style={styles.error}>{error}</p>}
          <form onSubmit={handleSubmit} style={styles.formGrid}>
            <div style={styles.field}>
              <label style={styles.label}>Name *</label>
              <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. 10% Member Discount" />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Rule Type *</label>
              <select style={styles.input} value={form.rule_type} onChange={(e) => setForm({ ...form, rule_type: e.target.value })}>
                <option value="promotion">Promotion</option>
                <option value="membership">Membership</option>
                <option value="first_time">First Time</option>
                <option value="corporate">Corporate</option>
                <option value="volume">Volume</option>
                <option value="time_of_day">Time of Day</option>
                <option value="day_of_week">Day of Week</option>
              </select>
              <small style={styles.helper}>
                {form.rule_type === 'promotion' && 'A promotional discount, optionally limited by date range.'}
                {form.rule_type === 'membership' && 'Discount applied automatically to customers with active memberships.'}
                {form.rule_type === 'first_time' && 'Discount for first-time customers only.'}
                {form.rule_type === 'corporate' && 'Special rate for customers in a corporate account.'}
                {form.rule_type === 'volume' && 'Discount triggered when purchase exceeds a minimum amount.'}
                {form.rule_type === 'time_of_day' && 'Discount active only during specific hours (e.g., off-peak pricing).'}
                {form.rule_type === 'day_of_week' && 'Discount active only on specific days of the week.'}
              </small>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Pricing Adjustment Type *</label>
              <select style={styles.input} value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value })}>
                <option value="percentage">Discount — Percentage (%)</option>
                <option value="fixed">Discount — Fixed Amount</option>
                <option value="premium_percentage">Premium — Percentage (%)</option>
                <option value="premium_fixed">Premium — Fixed Amount</option>
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>{form.discount_type.startsWith('premium') ? 'Premium Value *' : 'Discount Value *'}</label>
              <input style={styles.input} type="number" step={form.discount_type.includes('percentage') ? '1' : '0.01'} min="0"
                value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} required
                placeholder={form.discount_type.includes('percentage') ? 'e.g. 10' : 'e.g. 5.00'} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Priority</label>
              <input style={styles.input} type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
              <small style={styles.helper}>Lower number = higher priority</small>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Stacking</label>
              <select style={styles.input} value={form.stacking_mode} onChange={(e) => setForm({ ...form, stacking_mode: e.target.value })}>
                <option value="stackable">Stackable</option>
                <option value="exclusive">Exclusive</option>
                <option value="non_stackable">Non-stackable</option>
              </select>
            </div>

            {/* Conditional fields based on rule type */}
            {form.rule_type === 'promotion' && (
              <>
                <div style={styles.field}>
                  <label style={styles.label}>Effective From</label>
                  <input style={styles.input} type="date" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Effective To</label>
                  <input style={styles.input} type="date" value={form.effective_to} onChange={(e) => setForm({ ...form, effective_to: e.target.value })} />
                </div>
              </>
            )}

            {form.rule_type === 'day_of_week' && (
              <div style={{ ...styles.field, gridColumn: '1 / -1' }}>
                <label style={styles.label}>Days of Week *</label>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name, idx) => (
                    <button key={idx} type="button"
                      onClick={() => setForm({ ...form, days_of_week: form.days_of_week.includes(idx) ? form.days_of_week.filter(d => d !== idx) : [...form.days_of_week, idx] })}
                      style={{ padding: '6px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: form.days_of_week.includes(idx) ? 'var(--color-accent, #C9A96E)' : 'var(--color-background)', color: form.days_of_week.includes(idx) ? '#1A1A1A' : 'var(--color-text)', cursor: 'pointer', fontSize: '13px', fontWeight: form.days_of_week.includes(idx) ? 600 : 400, fontFamily: 'var(--font-family)' }}>
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {form.rule_type === 'time_of_day' && (
              <>
                <div style={styles.field}>
                  <label style={styles.label}>From Time *</label>
                  <input style={styles.input} type="time" value={form.time_from} onChange={(e) => setForm({ ...form, time_from: e.target.value })} />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>To Time *</label>
                  <input style={styles.input} type="time" value={form.time_to} onChange={(e) => setForm({ ...form, time_to: e.target.value })} />
                </div>
              </>
            )}

            {form.rule_type === 'volume' && (
              <div style={styles.field}>
                <label style={styles.label}>Minimum Purchase Amount</label>
                <input style={styles.input} type="number" step="0.01" min="0" value={form.min_purchase_amount} onChange={(e) => setForm({ ...form, min_purchase_amount: e.target.value })} placeholder="e.g. 100.00" />
              </div>
            )}

            {form.rule_type === 'first_time' && (
              <div style={styles.field}>
                <label style={styles.label}>Max Uses Per Customer</label>
                <input style={styles.input} type="number" min="1" value={form.first_time_booking_limit} onChange={(e) => setForm({ ...form, first_time_booking_limit: e.target.value })} placeholder="Default: 1" />
              </div>
            )}

            {form.rule_type === 'membership' && (
              <div style={{ ...styles.field, gridColumn: '1 / -1' }}>
                <label style={styles.label}>Applies to Plans (leave empty for all memberships)</label>
                <small style={styles.helper}>Select specific plans this discount applies to, or leave empty to apply to any active membership.</small>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                  {membershipPlans.map((p: any) => (
                    <button key={p.id} type="button"
                      onClick={() => setForm({ ...form, membership_plan_ids: (form as any).membership_plan_ids?.includes(p.id) ? (form as any).membership_plan_ids.filter((id: string) => id !== p.id) : [...((form as any).membership_plan_ids || []), p.id] })}
                      style={{ padding: '6px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: (form as any).membership_plan_ids?.includes(p.id) ? 'var(--color-accent, #C9A96E)' : 'var(--color-background)', color: (form as any).membership_plan_ids?.includes(p.id) ? '#1A1A1A' : 'var(--color-text)', cursor: 'pointer', fontSize: '13px', fontWeight: (form as any).membership_plan_ids?.includes(p.id) ? 600 : 400, fontFamily: 'var(--font-family)' }}>
                      {p.name}
                    </button>
                  ))}
                  {membershipPlans.length === 0 && <span style={styles.helper}>No membership plans defined yet.</span>}
                </div>
              </div>
            )}

            {form.rule_type === 'corporate' && (
              <div style={{ ...styles.field, gridColumn: '1 / -1' }}>
                <label style={styles.label}>Corporate Account *</label>
                <small style={styles.helper}>Select which corporate account this discount applies to.</small>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                  {corporateAccounts.map((a: any) => (
                    <button key={a.id} type="button"
                      onClick={() => setForm({ ...form, corporate_account_id: form.corporate_account_id === a.id ? '' : a.id })}
                      style={{ padding: '6px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: form.corporate_account_id === a.id ? 'var(--color-accent, #C9A96E)' : 'var(--color-background)', color: form.corporate_account_id === a.id ? '#1A1A1A' : 'var(--color-text)', cursor: 'pointer', fontSize: '13px', fontWeight: form.corporate_account_id === a.id ? 600 : 400, fontFamily: 'var(--font-family)' }}>
                      {a.name}
                    </button>
                  ))}
                  {corporateAccounts.length === 0 && <span style={styles.helper}>No corporate accounts defined yet. Create one in the Corporate tab first.</span>}
                </div>
              </div>
            )}

            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button variant="secondary" type="button" onClick={() => { setShowForm(false); setEditingRule(null); }}>Cancel</Button>
              <Button type="submit" loading={saving}>{editingRule ? 'Save Changes' : 'Create Rule'}</Button>
            </div>
          </form>
        </div>
      )}

      <Table columns={columns} data={rules} loading={loading} onRowClick={openEdit} emptyMessage="No pricing rules configured" />
    </div>
  );
}

// ============================================================
// Bundles
// ============================================================

function BundlesSection({ businessId }: { businessId: string }) {
  const [bundles, setBundles] = useState<PricingBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingBundle, setEditingBundle] = useState<PricingBundle | null>(null);
  const [form, setForm] = useState({ name: '', description: '', bundle_type: 'fixed_price', bundle_price: '', discount_percentage: '', expiration_days: '' });
  const [items, setItems] = useState<Array<{ variant_id: string; quantity: number; label: string }>>([]);
  const [services, setServices] = useState<any[]>([]);
  const [variants, setVariants] = useState<any[]>([]);
  const [selectedService, setSelectedService] = useState('');
  const [selectedVariant, setSelectedVariant] = useState('');
  const [itemQuantity, setItemQuantity] = useState('1');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    pricingApi.getBundles(businessId).then(setBundles).finally(() => setLoading(false));
    // Load services for item picker
    import('../api/services').then((svcApi) => {
      svcApi.getServices(businessId, { status: 'active' }).then((res) => setServices(res.data)).catch(() => {});
    });
  }, [businessId]);

  // Load variants when service selected
  useEffect(() => {
    if (!selectedService) { setVariants([]); return; }
    import('../api/services').then((svcApi) => {
      svcApi.getVariants(selectedService).then(setVariants).catch(() => setVariants([]));
    });
    setSelectedVariant('');
  }, [selectedService]);

  const resetForm = () => { setForm({ name: '', description: '', bundle_type: 'fixed_price', bundle_price: '', discount_percentage: '', expiration_days: '' }); setItems([]); };

  const openCreate = () => { resetForm(); setEditingBundle(null); setShowForm(true); setError(''); };

  const openEdit = (bundle: PricingBundle) => {
    setEditingBundle(bundle);
    setForm({
      name: bundle.name,
      description: bundle.description || '',
      bundle_type: bundle.bundle_type,
      bundle_price: bundle.bundle_price ? (bundle.bundle_price / 100).toFixed(2) : '',
      discount_percentage: bundle.discount_percentage ? String(bundle.discount_percentage) : '',
      expiration_days: bundle.expiration_days ? String(bundle.expiration_days) : '',
    });
    setItems((bundle.items || []).map((item: any) => ({
      variant_id: item.variant_id,
      quantity: item.quantity || 1,
      label: item.variant_name || item.service_name || item.variant_id,
    })));
    setShowForm(true);
    setError('');
  };

  const addItem = () => {
    if (!selectedVariant) return;
    const variant = variants.find((v: any) => v.id === selectedVariant);
    const service = services.find((s: any) => s.id === selectedService);
    if (items.find(i => i.variant_id === selectedVariant)) { setError('Item already in bundle'); return; }
    setItems([...items, {
      variant_id: selectedVariant,
      quantity: parseInt(itemQuantity) || 1,
      label: `${service?.name || ''} — ${variant?.name || ''} (${variant?.duration || '?'} min)`,
    }]);
    setSelectedVariant('');
    setItemQuantity('1');
    setError('');
  };

  const removeItem = (variantId: string) => {
    setItems(items.filter(i => i.variant_id !== variantId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0) { setError('Add at least one item to the bundle'); return; }
    setSaving(true);
    setError('');
    try {
      const data: any = {
        name: form.name,
        bundle_type: form.bundle_type,
        items: items.map(i => ({ variant_id: i.variant_id, quantity: i.quantity })),
      };
      if (form.description) data.description = form.description;
      if (form.bundle_price) data.bundle_price = Math.round(parseFloat(form.bundle_price) * 100);
      if (form.discount_percentage) data.discount_percentage = parseInt(form.discount_percentage);
      if (form.expiration_days) data.expiration_days = parseInt(form.expiration_days);

      if (editingBundle) {
        const updated = await pricingApi.updateBundle(editingBundle.id, data);
        setBundles(bundles.map((b) => b.id === editingBundle.id ? { ...b, ...updated } : b));
      } else {
        data.business_id = businessId;
        const created = await pricingApi.createBundle(data);
        setBundles([...bundles, created]);
      }
      setShowForm(false);
      setEditingBundle(null);
      resetForm();
    } catch (err: any) { setError(err.response?.data?.error || 'Failed to save bundle'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this bundle?')) return;
    await pricingApi.deleteBundle(id);
    setBundles(bundles.filter((b) => b.id !== id));
  };

  if (loading) return <p style={styles.empty}>Loading...</p>;

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <Button onClick={openCreate}>Create Bundle</Button>
      </div>

      {showForm && (
        <div style={styles.formPanel}>
          <h3 style={styles.formTitle}>{editingBundle ? 'Edit Bundle' : 'New Bundle'}</h3>
          {error && <p style={styles.error}>{error}</p>}
          <form onSubmit={handleSubmit} style={styles.formGrid}>
            <div style={styles.field}>
              <label style={styles.label}>Name *</label>
              <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Recovery Package" />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Type *</label>
              <select style={styles.input} value={form.bundle_type} onChange={(e) => setForm({ ...form, bundle_type: e.target.value })}>
                <option value="fixed_price">Fixed Price</option>
                <option value="percentage_off">Percentage Off</option>
              </select>
            </div>
            {form.bundle_type === 'fixed_price' && (
              <div style={styles.field}>
                <label style={styles.label}>Bundle Price</label>
                <input style={styles.input} type="number" step="0.01" min="0" value={form.bundle_price} onChange={(e) => setForm({ ...form, bundle_price: e.target.value })} placeholder="e.g. 199.99" />
              </div>
            )}
            {form.bundle_type === 'percentage_off' && (
              <div style={styles.field}>
                <label style={styles.label}>Discount %</label>
                <input style={styles.input} type="number" min="1" max="100" value={form.discount_percentage} onChange={(e) => setForm({ ...form, discount_percentage: e.target.value })} placeholder="e.g. 20" />
              </div>
            )}
            <div style={styles.field}>
              <label style={styles.label}>Expiration (days)</label>
              <input style={styles.input} type="number" min="1" value={form.expiration_days} onChange={(e) => setForm({ ...form, expiration_days: e.target.value })} placeholder="Optional" />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Description</label>
              <input style={styles.input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Brief description" />
            </div>

            {/* Bundle Items */}
            <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--color-border)', paddingTop: '12px', marginTop: '4px' }}>
              <label style={{ ...styles.label, marginBottom: '8px', display: 'block' }}>Bundle Items *</label>

              {/* Item picker */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '12px' }}>
                <div style={{ flex: 1, minWidth: '150px' }}>
                  <small style={styles.helper}>Service</small>
                  <select style={styles.input} value={selectedService} onChange={(e) => setSelectedService(e.target.value)}>
                    <option value="">Select service...</option>
                    {services.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: '150px' }}>
                  <small style={styles.helper}>Variant</small>
                  <select style={styles.input} value={selectedVariant} onChange={(e) => setSelectedVariant(e.target.value)}>
                    <option value="">Select variant...</option>
                    {variants.filter((v: any) => v.status === 'active').map((v: any) => (
                      <option key={v.id} value={v.id}>{v.name} — {v.duration} min</option>
                    ))}
                  </select>
                </div>
                <div style={{ width: '70px' }}>
                  <small style={styles.helper}>Qty</small>
                  <input style={styles.input} type="number" min="1" value={itemQuantity} onChange={(e) => setItemQuantity(e.target.value)} />
                </div>
                <Button type="button" onClick={addItem} disabled={!selectedVariant}>Add</Button>
              </div>

              {/* Items list */}
              {items.length === 0 && <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: 0 }}>No items added yet</p>}
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '4px' }}>
                {items.map((item) => (
                  <div key={item.variant_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '13px' }}>
                    <span>{item.quantity}x {item.label}</span>
                    <button type="button" style={styles.actionBtn} onClick={() => removeItem(item.variant_id)}>Remove</button>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button variant="secondary" type="button" onClick={() => { setShowForm(false); setEditingBundle(null); }}>Cancel</Button>
              <Button type="submit" loading={saving}>{editingBundle ? 'Save Changes' : 'Create Bundle'}</Button>
            </div>
          </form>
        </div>
      )}

      {bundles.length === 0 && !showForm ? (
        <p style={styles.empty}>No bundles configured</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '8px' }}>
          {bundles.map((b) => (
            <div key={b.id} style={{ ...styles.card, cursor: 'pointer' }} onClick={() => openEdit(b)}>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 500 }}>{b.name}</span>
                <Badge variant="neutral">{b.bundle_type === 'fixed_price' ? 'Fixed' : '% Off'}</Badge>
                {b.bundle_price && <span style={{ marginLeft: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>{formatCurrency(b.bundle_price)}</span>}
                {b.discount_percentage && <span style={{ marginLeft: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>{b.discount_percentage}% off</span>}
                <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>{b.items?.length || 0} item{(b.items?.length || 0) !== 1 ? 's' : ''}</span>
              </div>
              <button style={styles.actionBtn} onClick={(e) => { e.stopPropagation(); handleDelete(b.id); }}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Corporate Accounts
// ============================================================

function CorporateSection({ businessId }: { businessId: string }) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<any>(null);
  const [form, setForm] = useState({ name: '', contact_email: '', billing_email: '', agreement_start: '', agreement_end: '', status: 'active' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Member management
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState<any[]>([]);
  const [showMemberDropdown, setShowMemberDropdown] = useState(false);
  const [memberSearching, setMemberSearching] = useState(false);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    pricingApi.getCorporateAccounts(businessId).then(setAccounts).finally(() => setLoading(false));
  }, [businessId]);

  // Member search debounce
  useEffect(() => {
    if (!memberSearch || memberSearch.length < 2) { setMemberResults([]); setShowMemberDropdown(false); return; }
    setMemberSearching(true);
    const timeout = setTimeout(async () => {
      try {
        const customersApi = await import('../api/customers');
        const res = await customersApi.getCustomers(businessId, { search: memberSearch, limit: 10 });
        // Filter out existing members
        const memberIds = members.map((m: any) => m.customer_id);
        setMemberResults(res.data.filter((c: any) => !memberIds.includes(c.id)));
        setShowMemberDropdown(true);
      } catch { setMemberResults([]); }
      finally { setMemberSearching(false); }
    }, 300);
    return () => clearTimeout(timeout);
  }, [memberSearch, businessId, members]);

  const resetForm = () => setForm({ name: '', contact_email: '', billing_email: '', agreement_start: '', agreement_end: '', status: 'active' });

  const openCreate = () => { resetForm(); setEditingAccount(null); setShowForm(true); setError(''); };

  const openEdit = (account: any) => {
    setEditingAccount(account);
    setForm({
      name: account.name || account.company_name || '',
      contact_email: account.contact_email || '',
      billing_email: account.billing_email || '',
      agreement_start: account.agreement_start ? account.agreement_start.split('T')[0] : '',
      agreement_end: account.agreement_end ? account.agreement_end.split('T')[0] : '',
      status: account.status || 'active',
    });
    setShowForm(true);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const data: any = { name: form.name };
      if (form.contact_email) data.contact_email = form.contact_email;
      if (form.billing_email) data.billing_email = form.billing_email;
      if (form.agreement_start) data.agreement_start = form.agreement_start;
      if (form.agreement_end) data.agreement_end = form.agreement_end;
      data.status = form.status;

      if (editingAccount) {
        const updated = await pricingApi.updateCorporateAccount(editingAccount.id, data);
        setAccounts(accounts.map((a) => a.id === editingAccount.id ? { ...a, ...updated } : a));
      } else {
        data.business_id = businessId;
        const created = await pricingApi.createCorporateAccount(data);
        setAccounts([...accounts, created]);
      }
      setShowForm(false);
      setEditingAccount(null);
      resetForm();
    } catch (err: any) { setError(err.response?.data?.error || 'Failed to save corporate account'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this corporate account? Members will be disassociated.')) return;
    try {
      await pricingApi.deleteCorporateAccount(id);
      setAccounts(accounts.filter((a) => a.id !== id));
      if (selectedAccount?.id === id) { setSelectedAccount(null); setMembers([]); }
    } catch { alert('Failed to delete'); }
  };

  const handleSelectAccount = async (account: any) => {
    setSelectedAccount(account);
    try {
      const m = await pricingApi.getCorporateMembers(account.id);
      setMembers(m);
    } catch { setMembers([]); }
  };

  const handleAddMember = async (customer: any) => {
    if (!selectedAccount) return;
    try {
      await pricingApi.addCorporateMember(selectedAccount.id, { customer_id: customer.id });
      setMembers([...members, { customer_id: customer.id, first_name: customer.first_name, last_name: customer.last_name, email: customer.email }]);
      setMemberSearch('');
      setShowMemberDropdown(false);
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to add member'); }
  };

  const handleRemoveMember = async (customerId: string) => {
    if (!selectedAccount) return;
    if (!confirm('Remove this member from the corporate account?')) return;
    try {
      await pricingApi.removeCorporateMember(selectedAccount.id, customerId);
      setMembers(members.filter((m: any) => m.customer_id !== customerId));
    } catch { alert('Failed to remove member'); }
  };

  if (loading) return <p style={styles.empty}>Loading...</p>;

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <Button onClick={openCreate}>Create Account</Button>
      </div>

      {showForm && (
        <div style={styles.formPanel}>
          <h3 style={styles.formTitle}>{editingAccount ? 'Edit Corporate Account' : 'New Corporate Account'}</h3>
          {error && <p style={styles.error}>{error}</p>}
          <form onSubmit={handleSubmit} style={styles.formGrid}>
            <div style={styles.field}>
              <label style={styles.label}>Company Name *</label>
              <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Acme Corp" />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Status</label>
              <select style={styles.input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Agreement Start</label>
              <input style={styles.input} type="date" value={form.agreement_start} onChange={(e) => setForm({ ...form, agreement_start: e.target.value })} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Agreement End</label>
              <input style={styles.input} type="date" value={form.agreement_end} onChange={(e) => setForm({ ...form, agreement_end: e.target.value })} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Contact Email</label>
              <input style={styles.input} type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} placeholder="contact@company.com" />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Billing Email</label>
              <input style={styles.input} type="email" value={form.billing_email} onChange={(e) => setForm({ ...form, billing_email: e.target.value })} placeholder="billing@company.com" />
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button variant="secondary" type="button" onClick={() => { setShowForm(false); setEditingAccount(null); }}>Cancel</Button>
              <Button type="submit" loading={saving}>{editingAccount ? 'Save Changes' : 'Create Account'}</Button>
            </div>
          </form>
        </div>
      )}

      {/* Account list + Member management side by side */}
      {accounts.length > 0 && !selectedAccount && (
        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '12px' }}>Select an account below to manage its members.</p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: accounts.length > 0 ? '1fr 1fr' : '1fr', gap: '24px' }}>
        {/* Account list */}
        <div>
          {accounts.length === 0 && !showForm ? (
            <p style={styles.empty}>No corporate accounts</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '8px' }}>
              {accounts.map((a: any) => (
                <div key={a.id}
                  style={{ ...styles.card, cursor: 'pointer', borderColor: selectedAccount?.id === a.id ? 'var(--color-accent, #C9A96E)' : 'var(--color-border)' }}
                  onClick={() => handleSelectAccount(a)}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 500 }}>{a.name}</span>
                    <Badge variant={a.status === 'active' ? 'success' : 'neutral'}>{a.status}</Badge>
                    {a.agreement_end && <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>expires {new Date(a.agreement_end).toLocaleDateString()}</span>}
                    {a.contact_email && <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>{a.contact_email}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button style={styles.actionBtn} onClick={(e) => { e.stopPropagation(); openEdit(a); }}>Edit</button>
                    <button style={styles.actionBtn} onClick={(e) => { e.stopPropagation(); handleDelete(a.id); }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Member management panel */}
        {selectedAccount && (
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '16px' }}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' }}>
              Members — {selectedAccount.name}
            </h4>

            {/* Add member search */}
            <div style={{ position: 'relative' as const, marginBottom: '12px' }}>
              <input style={styles.input} type="text" value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search customer to add..."
                autoComplete="off"
                onFocus={() => { if (memberResults.length > 0) setShowMemberDropdown(true); }}
                onBlur={() => setTimeout(() => setShowMemberDropdown(false), 200)} />
              {showMemberDropdown && memberResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginTop: '4px', maxHeight: '150px', overflow: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                  {memberResults.map((c: any) => (
                    <button key={c.id} type="button"
                      style={{ display: 'block', width: '100%', padding: '8px 12px', border: 'none', background: 'var(--color-background)', cursor: 'pointer', textAlign: 'left', color: 'var(--color-text)', fontSize: '13px', borderBottom: '1px solid var(--color-border)' }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleAddMember(c)}>
                      <strong>{c.first_name} {c.last_name}</strong> — {c.email}
                    </button>
                  ))}
                </div>
              )}
              {memberSearching && <small style={styles.helper}>Searching...</small>}
            </div>

            {/* Members list */}
            {members.length === 0 ? (
              <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: 0 }}>No members yet. Search and add customers above.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '4px' }}>
                {members.map((m: any) => (
                  <div key={m.customer_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '13px' }}>
                    <span>{m.first_name} {m.last_name} {m.email && <span style={{ color: 'var(--color-text-secondary)' }}>({m.email})</span>}</span>
                    <button style={styles.actionBtn} onClick={() => handleRemoveMember(m.customer_id)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Styles
// ============================================================

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1100px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  tabs: { display: 'flex', gap: '16px', marginBottom: '24px', borderBottom: '1px solid var(--color-border)' },
  tabBtn: { background: 'none', border: 'none', padding: '8px 4px', fontSize: 'var(--font-size-sm)', fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-family)', color: 'var(--color-text-secondary)', borderBottom: '2px solid transparent' },
  tabBtnActive: { borderBottom: '2px solid var(--color-accent, #C9A96E)', color: 'var(--color-accent, #C9A96E)' },
  formPanel: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '20px', marginBottom: '20px', background: 'var(--color-surface)' },
  formTitle: { margin: '0 0 12px 0', fontSize: '16px', fontWeight: 600, color: 'var(--color-text)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' },
  input: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: '14px', width: '100%', boxSizing: 'border-box' as const, fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)' },
  helper: { fontSize: '11px', color: 'var(--color-text-secondary)' },
  error: { color: 'var(--color-error)', fontSize: '13px', margin: '0 0 8px 0' },
  empty: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', textAlign: 'center' as const, padding: 'var(--space-xl)' },
  card: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  actionBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
};
