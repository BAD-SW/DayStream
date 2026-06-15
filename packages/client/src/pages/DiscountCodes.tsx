import { useState, useEffect } from 'react';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import * as pricingApi from '../api/pricing';
import type { DiscountCode } from '../api/pricing';

export function DiscountCodes() {
  const [codes, setCodes] = useState<DiscountCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ code: '', discount_type: 'percentage', discount_value: 10, max_total_uses: 100 });
  const [showBulk, setShowBulk] = useState(false);
  const [bulkForm, setBulkForm] = useState({ prefix: 'REF', count: 10, discount_type: 'fixed', discount_value: 1000 });

  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    pricingApi.getCodes(businessId).then(setCodes).finally(() => setLoading(false));
  }, [businessId]);

  const handleCreate = async () => {
    await pricingApi.createCode({ business_id: businessId, ...form });
    pricingApi.getCodes(businessId).then(setCodes);
    setShowCreate(false);
    setForm({ code: '', discount_type: 'percentage', discount_value: 10, max_total_uses: 100 });
  };

  const handleBulk = async () => {
    await pricingApi.bulkGenerateCodes({ business_id: businessId, ...bulkForm });
    pricingApi.getCodes(businessId).then(setCodes);
    setShowBulk(false);
  };

  const handleDeactivate = async (id: string) => {
    await pricingApi.deactivateCode(id, businessId);
    setCodes(codes.map((c) => c.id === id ? { ...c, status: 'inactive' } : c));
  };

  const columns = [
    { key: 'code', header: 'Code' },
    { key: 'discount', header: 'Discount', render: (_: any, r: DiscountCode) => r.discount_type === 'percentage' ? `${r.discount_value}%` : `€${(r.discount_value / 100).toFixed(2)}` },
    { key: 'current_uses', header: 'Uses', render: (_: any, r: DiscountCode) => `${r.current_uses}/${r.max_total_uses || '∞'}` },
    { key: 'status', header: 'Status', render: (v: string) => <Badge variant={v === 'active' ? 'success' : 'neutral'}>{v}</Badge> },
    {
      key: 'actions', header: '',
      render: (_: any, r: DiscountCode) => r.status === 'active' ? (
        <button style={styles.actionBtn} onClick={(e) => { e.stopPropagation(); handleDeactivate(r.id); }}>Deactivate</button>
      ) : null,
    },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Discount Codes</h1>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <Button onClick={() => setShowCreate(!showCreate)}>Create Code</Button>
          <Button onClick={() => setShowBulk(!showBulk)}>Bulk Generate</Button>
        </div>
      </div>

      {showCreate && (
        <div style={styles.form}>
          <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Code (e.g., WELCOME20)" style={styles.input} />
          <select value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value })} style={styles.input}>
            <option value="percentage">Percentage</option>
            <option value="fixed">Fixed Amount</option>
          </select>
          <input type="number" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: parseInt(e.target.value) || 0 })} placeholder="Value" style={styles.input} />
          <Button onClick={handleCreate}>Save</Button>
        </div>
      )}

      {showBulk && (
        <div style={styles.form}>
          <input value={bulkForm.prefix} onChange={(e) => setBulkForm({ ...bulkForm, prefix: e.target.value })} placeholder="Prefix" style={styles.input} />
          <input type="number" value={bulkForm.count} onChange={(e) => setBulkForm({ ...bulkForm, count: parseInt(e.target.value) || 10 })} placeholder="Count" style={styles.input} />
          <select value={bulkForm.discount_type} onChange={(e) => setBulkForm({ ...bulkForm, discount_type: e.target.value })} style={styles.input}>
            <option value="percentage">Percentage</option>
            <option value="fixed">Fixed Amount</option>
          </select>
          <input type="number" value={bulkForm.discount_value} onChange={(e) => setBulkForm({ ...bulkForm, discount_value: parseInt(e.target.value) || 0 })} placeholder="Value" style={styles.input} />
          <Button onClick={handleBulk}>Generate</Button>
        </div>
      )}

      <Table columns={columns} data={codes} loading={loading} emptyMessage="No discount codes" />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1000px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  form: { display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)', flexWrap: 'wrap' as const, alignItems: 'center', padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' },
  input: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  actionBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
};
