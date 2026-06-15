import { useState, useEffect } from 'react';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Tabs } from '../design-system/components/navigation/Tabs';
import * as apApi from '../api/accounts-payable';

const BILL_STATUS: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = { draft: 'neutral', pending: 'neutral', approved: 'info' as any, paid: 'success', overdue: 'error', void: 'error' };

export function AccountsPayable() {
  const [vendors, setVendors] = useState<any[]>([]);
  const [bills, setBills] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    Promise.all([
      apApi.getVendors(businessId), apApi.getBills(businessId), apApi.getExpenses(businessId),
    ]).then(([v, b, e]) => { setVendors(v); setBills(b); setExpenses(e); }).finally(() => setLoading(false));
  }, [businessId]);

  const vendorCols = [
    { key: 'name', header: 'Vendor' },
    { key: 'category', header: 'Category' },
    { key: 'payment_terms', header: 'Terms', render: (v: number) => `Net ${v}` },
    { key: 'total_spend', header: 'Total Spend', render: (v: number) => `€${(v / 100).toFixed(2)}` },
    { key: 'outstanding', header: 'Outstanding', render: (v: number) => `€${(v / 100).toFixed(2)}` },
  ];

  const billCols = [
    { key: 'vendor_name', header: 'Vendor' },
    { key: 'invoice_number', header: 'Invoice #' },
    { key: 'amount', header: 'Amount', render: (v: number) => `€${(v / 100).toFixed(2)}` },
    { key: 'due_date', header: 'Due', render: (v: string) => new Date(v).toLocaleDateString() },
    { key: 'status', header: 'Status', render: (v: string) => <Badge variant={BILL_STATUS[v] || 'neutral'}>{v}</Badge> },
  ];

  const expenseCols = [
    { key: 'date', header: 'Date', render: (v: string) => new Date(v).toLocaleDateString() },
    { key: 'amount', header: 'Amount', render: (v: number) => `€${(v / 100).toFixed(2)}` },
    { key: 'account_name', header: 'Category' },
    { key: 'description', header: 'Description' },
    { key: 'status', header: 'Status', render: (v: string) => <Badge variant={v === 'approved' ? 'success' : 'neutral'}>{v}</Badge> },
  ];

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Accounts Payable</h1>
      <Tabs items={[
        { id: 'vendors', label: 'Vendors', content: <Table columns={vendorCols} data={vendors} loading={loading} emptyMessage="No vendors" /> },
        { id: 'bills', label: 'Bills', content: <Table columns={billCols} data={bills} loading={loading} emptyMessage="No bills" /> },
        { id: 'expenses', label: 'Expenses', content: <Table columns={expenseCols} data={expenses} loading={loading} emptyMessage="No expenses" /> },
      ]} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-lg)' },
};
