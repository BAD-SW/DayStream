import { useState, useEffect } from 'react';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import * as pricingApi from '../api/pricing';
import type { PricingRule, PricingBundle } from '../api/pricing';
import { formatCurrency } from '../utils/currency';

const TYPE_LABELS: Record<string, string> = {
  membership: 'Membership', promotion: 'Promotion', seasonal: 'Seasonal', first_time: 'First Time',
  corporate: 'Corporate', volume: 'Volume', time_of_day: 'Time', day_of_week: 'Day',
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
      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', borderBottom: '1px solid var(--color-border)' }}>
        {tabItems.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{ ...styles.tabBtn, borderBottom: activeTab === tab.key ? '2px solid var(--color-primary, #3b82f6)' : '2px solid transparent', color: activeTab === tab.key ? 'var(--color-primary, #3b82f6)' : 'var(--color-text-secondary)' }}>
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

function RulesSection({ businessId }: { businessId: string }) {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    pricingApi.getRules(businessId).then(setRules).finally(() => setLoading(false));
  }, [businessId]);

  const handleToggle = async (rule: PricingRule) => {
    const newStatus = rule.status === 'active' ? 'inactive' : 'active';
    await pricingApi.updateRule(rule.id, businessId, { status: newStatus });
    setRules(rules.map((r) => r.id === rule.id ? { ...r, status: newStatus } : r));
  };

  const handleDelete = async (id: string) => {
    await pricingApi.deleteRule(id, businessId);
    setRules(rules.filter((r) => r.id !== id));
  };

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'rule_type', header: 'Type', render: (v: string) => <Badge variant="neutral">{TYPE_LABELS[v] || v}</Badge> },
    { key: 'discount', header: 'Discount', render: (_: any, r: PricingRule) => r.discount_type === 'percentage' ? `${r.discount_value}%` : formatCurrency(r.discount_value) },
    { key: 'priority', header: 'Priority' },
    { key: 'stacking_mode', header: 'Stacking', render: (v: string) => v.replace('_', ' ') },
    { key: 'status', header: 'Status', render: (v: string) => <Badge variant={v === 'active' ? 'success' : 'neutral'}>{v}</Badge> },
    {
      key: 'actions', header: '',
      render: (_: any, r: PricingRule) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          <button style={styles.actionBtn} onClick={(e) => { e.stopPropagation(); handleToggle(r); }}>
            {r.status === 'active' ? 'Disable' : 'Enable'}
          </button>
          <button style={styles.actionBtn} onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}>Delete</button>
        </div>
      ),
    },
  ];

  return <Table columns={columns} data={rules} loading={loading} emptyMessage="No pricing rules configured" />;
}

function BundlesSection({ businessId }: { businessId: string }) {
  const [bundles, setBundles] = useState<PricingBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', bundle_price: '', discount_percentage: '' });

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    pricingApi.getBundles(businessId).then(setBundles).finally(() => setLoading(false));
  }, [businessId]);

  const handleEdit = (bundle: PricingBundle) => {
    setEditingId(bundle.id);
    setEditForm({
      name: bundle.name,
      bundle_price: bundle.bundle_price ? String(bundle.bundle_price) : '',
      discount_percentage: bundle.discount_percentage ? String(bundle.discount_percentage) : '',
    });
  };

  const handleSave = async () => {
    if (!editingId) return;
    const data: Record<string, any> = { name: editForm.name };
    if (editForm.bundle_price) data.bundle_price = Number(editForm.bundle_price);
    if (editForm.discount_percentage) data.discount_percentage = Number(editForm.discount_percentage);
    const updated = await pricingApi.updateBundle(editingId, data);
    setBundles(bundles.map((b) => b.id === editingId ? { ...b, ...updated } : b));
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this bundle?')) return;
    await pricingApi.deleteBundle(id);
    setBundles(bundles.filter((b) => b.id !== id));
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      {editingId && (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: '16px', background: 'var(--color-surface)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', marginBottom: '4px' }}>Name</label>
              <input type="text" style={styles.input} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', marginBottom: '4px' }}>Bundle Price</label>
              <input type="number" style={styles.input} value={editForm.bundle_price} onChange={(e) => setEditForm({ ...editForm, bundle_price: e.target.value })} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', marginBottom: '4px' }}>Discount %</label>
              <input type="number" style={styles.input} value={editForm.discount_percentage} onChange={(e) => setEditForm({ ...editForm, discount_percentage: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button onClick={handleSave}>Save</Button>
            <Button variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {bundles.length === 0 ? (
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>No bundles configured</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {bundles.map((b) => (
            <div key={b.id} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 500 }}>{b.name}</span>
                <Badge variant="neutral">{b.bundle_type}</Badge>
                {b.bundle_price && <span style={{ marginLeft: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{formatCurrency(b.bundle_price)}</span>}
                {b.discount_percentage && <span style={{ marginLeft: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{b.discount_percentage}% off</span>}
                <span style={{ marginLeft: '8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>{b.items.length} items</span>
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button style={styles.actionBtn} onClick={() => handleEdit(b)}>Edit</button>
                <button style={styles.actionBtn} onClick={() => handleDelete(b.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CorporateSection({ businessId }: { businessId: string }) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [newCustomerId, setNewCustomerId] = useState('');

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    pricingApi.getCorporateAccounts(businessId).then(setAccounts).finally(() => setLoading(false));
  }, [businessId]);

  const handleSelectAccount = async (accountId: string) => {
    setSelectedAccount(accountId);
    const m = await pricingApi.getCorporateMembers(accountId);
    setMembers(m);
  };

  const handleAddMember = async () => {
    if (!selectedAccount || !newCustomerId) return;
    const created = await pricingApi.addCorporateMember(selectedAccount, { customer_id: newCustomerId });
    setMembers([...members, created]);
    setNewCustomerId('');
  };

  const handleRemoveMember = async (customerId: string) => {
    if (!selectedAccount) return;
    if (!confirm('Remove this member from the corporate account?')) return;
    await pricingApi.removeCorporateMember(selectedAccount, customerId);
    setMembers(members.filter((m: any) => m.customer_id !== customerId));
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
      <div>
        <h3 style={{ fontWeight: 500, marginBottom: '12px' }}>Corporate Accounts</h3>
        {accounts.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>No corporate accounts</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {accounts.map((a: any) => (
              <div key={a.id} onClick={() => handleSelectAccount(a.id)}
                style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px', cursor: 'pointer', background: selectedAccount === a.id ? 'var(--color-surface-hover, #f9fafb)' : 'var(--color-surface)' }}>
                <span style={{ fontWeight: 500 }}>{a.company_name}</span>
                {a.discount_percentage && <span style={{ marginLeft: '8px', fontSize: 'var(--font-size-sm)' }}>{a.discount_percentage}% discount</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        {selectedAccount ? (
          <>
            <h3 style={{ fontWeight: 500, marginBottom: '12px' }}>Members</h3>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input type="text" style={styles.input} placeholder="Customer ID"
                value={newCustomerId} onChange={(e) => setNewCustomerId(e.target.value)} />
              <Button onClick={handleAddMember}>Add</Button>
            </div>
            {members.length === 0 ? (
              <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>No members</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {members.map((m: any) => (
                  <div key={m.customer_id || m.id} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{m.customer_name || m.customer_id}</span>
                    <button style={styles.actionBtn} onClick={() => handleRemoveMember(m.customer_id)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', marginTop: '40px' }}>Select a corporate account to manage members</p>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1100px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  actionBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  tabBtn: { background: 'none', border: 'none', padding: '8px 4px', fontSize: 'var(--font-size-sm)', fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-family)' },
  input: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', fontSize: 'var(--font-size-sm)', width: '100%', fontFamily: 'var(--font-family)' },
};
