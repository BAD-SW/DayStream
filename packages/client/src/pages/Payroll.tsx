import { useState, useEffect } from 'react';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import * as payrollApi from '../api/payroll';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'neutral'> = { open: 'neutral', processing: 'warning', finalized: 'success' };

export function Payroll() {
  const [periods, setPeriods] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    payrollApi.getPayPeriods(businessId).then(setPeriods).finally(() => setLoading(false));
  }, [businessId]);

  const handleSelect = async (periodId: string) => {
    setSelectedPeriod(periodId);
    const e = await payrollApi.getPayrollEntries(periodId);
    setEntries(e);
  };

  const handleRun = async (periodId: string) => {
    await payrollApi.runPayroll(periodId, businessId);
    handleSelect(periodId);
  };

  const handleFinalize = async (periodId: string) => {
    await payrollApi.finalizePayroll(periodId, businessId);
    payrollApi.getPayPeriods(businessId).then(setPeriods);
  };

  const periodColumns = [
    { key: 'period_start', header: 'Start', render: (v: string) => new Date(v).toLocaleDateString() },
    { key: 'period_end', header: 'End', render: (v: string) => new Date(v).toLocaleDateString() },
    { key: 'status', header: 'Status', render: (v: string) => <Badge variant={STATUS_VARIANTS[v] || 'neutral'}>{v}</Badge> },
    {
      key: 'actions', header: '',
      render: (_: any, row: any) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          {row.status === 'open' && <ActionBtn label="Run" onClick={() => handleRun(row.id)} />}
          {row.status === 'processing' && <ActionBtn label="Finalize" onClick={() => handleFinalize(row.id)} />}
          <ActionBtn label="View" onClick={() => handleSelect(row.id)} />
        </div>
      ),
    },
  ];

  const entryColumns = [
    { key: 'name', header: 'Staff', render: (_: any, r: any) => `${r.first_name} ${r.last_name}` },
    { key: 'hours_worked', header: 'Hours' },
    { key: 'sessions_delivered', header: 'Sessions' },
    { key: 'gross_pay', header: 'Gross', render: (v: number) => `€${(v / 100).toFixed(2)}` },
    { key: 'total_deductions', header: 'Deductions', render: (v: number) => `€${(v / 100).toFixed(2)}` },
    { key: 'net_pay', header: 'Net', render: (v: number) => `€${(v / 100).toFixed(2)}` },
  ];

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Payroll</h1>
      <Table columns={periodColumns} data={periods} loading={loading} emptyMessage="No pay periods" />
      {selectedPeriod && entries.length > 0 && (
        <>
          <h2 style={styles.subtitle}>Payroll Entries</h2>
          <Table columns={entryColumns} data={entries} emptyMessage="No entries" />
        </>
      )}
    </div>
  );
}

function ActionBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return <button onClick={(e) => { e.stopPropagation(); onClick(); }} style={styles.actionBtn}>{label}</button>;
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1100px', margin: '0 auto' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-lg)' },
  subtitle: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-text)', marginTop: 'var(--space-xl)', marginBottom: 'var(--space-md)' },
  actionBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
};
