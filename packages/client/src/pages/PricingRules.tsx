import { useState, useEffect } from 'react';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import * as pricingApi from '../api/pricing';
import type { PricingRule } from '../api/pricing';

const TYPE_LABELS: Record<string, string> = {
  membership: 'Membership', promotion: 'Promotion', seasonal: 'Seasonal', first_time: 'First Time',
  corporate: 'Corporate', volume: 'Volume', time_of_day: 'Time', day_of_week: 'Day',
};

export function PricingRules() {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const businessId = localStorage.getItem('business_id') || '';

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
    { key: 'discount', header: 'Discount', render: (_: any, r: PricingRule) => r.discount_type === 'percentage' ? `${r.discount_value}%` : `€${(r.discount_value / 100).toFixed(2)}` },
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

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Pricing Rules</h1>
      </div>
      <Table columns={columns} data={rules} loading={loading} emptyMessage="No pricing rules configured" />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1100px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  actionBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
};
