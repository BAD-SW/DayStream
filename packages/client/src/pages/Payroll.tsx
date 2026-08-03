import { useState, useEffect } from 'react';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import * as payrollApi from '../api/payroll';
import { formatCurrency } from '../utils/currency';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'neutral'> = { open: 'neutral', processing: 'warning', finalized: 'success' };

type PayrollTab = 'periods' | 'compensation' | 'deductions' | 'time-entries';

export function Payroll() {
  const [activeTab, setActiveTab] = useState<PayrollTab>('periods');
  const businessId = localStorage.getItem('business_id') || '';

  const tabItems: { key: PayrollTab; label: string }[] = [
    { key: 'periods', label: 'Pay Periods' },
    { key: 'compensation', label: 'Compensation Rules' },
    { key: 'deductions', label: 'Deductions' },
    { key: 'time-entries', label: 'Time Entries' },
  ];

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Payroll</h1>
      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', borderBottom: '1px solid var(--color-border, #e5e7eb)' }}>
        {tabItems.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{ background: 'none', border: 'none', padding: '8px 4px', fontSize: 'var(--font-size-sm, 14px)', fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-family)', borderBottom: activeTab === tab.key ? '2px solid #3b82f6' : '2px solid transparent', color: activeTab === tab.key ? '#3b82f6' : 'var(--color-text-secondary, #6b7280)' }}>
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === 'periods' && <PeriodsSection businessId={businessId} />}
      {activeTab === 'compensation' && <CompensationSection businessId={businessId} />}
      {activeTab === 'deductions' && <DeductionsSection businessId={businessId} />}
      {activeTab === 'time-entries' && <TimeEntriesSection businessId={businessId} />}
    </div>
  );
}

function PeriodsSection({ businessId }: { businessId: string }) {
  const [periods, setPeriods] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  const [loading, setLoading] = useState(true);

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
    { key: 'gross_pay', header: 'Gross', render: (v: number) => formatCurrency(v) },
    { key: 'total_deductions', header: 'Deductions', render: (v: number) => formatCurrency(v) },
    { key: 'net_pay', header: 'Net', render: (v: number) => formatCurrency(v) },
  ];

  return (
    <div>
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

function CompensationSection({ businessId }: { businessId: string }) {
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ rate: '', rule_type: '' });

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    payrollApi.getCompensationRules(businessId).then(setRules).finally(() => setLoading(false));
  }, [businessId]);

  const handleEdit = (rule: any) => {
    setEditingId(rule.id);
    setEditForm({ rate: String(rule.rate || rule.amount || ''), rule_type: rule.rule_type || rule.type || '' });
  };

  const handleSave = async () => {
    if (!editingId) return;
    const updated = await payrollApi.updateCompensationRule(editingId, businessId, {
      rate: Number(editForm.rate),
      rule_type: editForm.rule_type,
    });
    setRules(rules.map((r: any) => r.id === editingId ? { ...r, ...updated } : r));
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this compensation rule?')) return;
    await payrollApi.deleteCompensationRule(id, businessId);
    setRules(rules.filter((r: any) => r.id !== id));
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      {editingId && (
        <div style={{ border: '1px solid var(--color-border, #e5e7eb)', borderRadius: '8px', padding: '16px', marginBottom: '16px', background: '#f9fafb' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>Rate</label>
              <input type="number" step="0.01" min="0" style={styles.input} value={(Number(editForm.rate) / 100).toFixed(2)} onChange={(e) => setEditForm({ ...editForm, rate: String(Math.round(parseFloat(e.target.value || '0') * 100)) })} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>Type</label>
              <input type="text" style={styles.input} value={editForm.rule_type} onChange={(e) => setEditForm({ ...editForm, rule_type: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button onClick={handleSave}>Save</Button>
            <Button variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {rules.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: '14px' }}>No compensation rules configured</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {rules.map((r: any) => (
            <div key={r.id} style={{ border: '1px solid var(--color-border, #e5e7eb)', borderRadius: '8px', padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 500 }}>{r.name || r.rule_type || r.type}</span>
                <span style={{ marginLeft: '12px', fontSize: '13px', color: '#6b7280' }}>{formatCurrency(r.rate || r.amount || 0)}</span>
                {r.user_name && <span style={{ marginLeft: '12px', fontSize: '13px', color: '#6b7280' }}>{r.user_name}</span>}
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <ActionBtn label="Edit" onClick={() => handleEdit(r)} />
                <ActionBtn label="Delete" onClick={() => handleDelete(r.id)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeductionsSection({ businessId }: { businessId: string }) {
  const [deductions, setDeductions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', amount: '', deduction_type: '' });

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    payrollApi.getDeductions(businessId).then(setDeductions).finally(() => setLoading(false));
  }, [businessId]);

  const handleEdit = (d: any) => {
    setEditingId(d.id);
    setEditForm({ name: d.name || '', amount: String(d.amount || ''), deduction_type: d.deduction_type || d.type || '' });
  };

  const handleSave = async () => {
    if (!editingId) return;
    const updated = await payrollApi.updateDeduction(editingId, {
      name: editForm.name,
      amount: Number(editForm.amount),
      deduction_type: editForm.deduction_type,
    });
    setDeductions(deductions.map((d: any) => d.id === editingId ? { ...d, ...updated } : d));
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this deduction?')) return;
    await payrollApi.deleteDeduction(id);
    setDeductions(deductions.filter((d: any) => d.id !== id));
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      {editingId && (
        <div style={{ border: '1px solid var(--color-border, #e5e7eb)', borderRadius: '8px', padding: '16px', marginBottom: '16px', background: '#f9fafb' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>Name</label>
              <input type="text" style={styles.input} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>Amount</label>
              <input type="number" step="0.01" min="0" style={styles.input} value={(Number(editForm.amount) / 100).toFixed(2)} onChange={(e) => setEditForm({ ...editForm, amount: String(Math.round(parseFloat(e.target.value || '0') * 100)) })} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>Type</label>
              <input type="text" style={styles.input} value={editForm.deduction_type} onChange={(e) => setEditForm({ ...editForm, deduction_type: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button onClick={handleSave}>Save</Button>
            <Button variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {deductions.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: '14px' }}>No deductions configured</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {deductions.map((d: any) => (
            <div key={d.id} style={{ border: '1px solid var(--color-border, #e5e7eb)', borderRadius: '8px', padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 500 }}>{d.name || d.deduction_type || d.type}</span>
                <span style={{ marginLeft: '12px', fontSize: '13px', color: '#6b7280' }}>{formatCurrency(d.amount || 0)}</span>
                {d.user_name && <span style={{ marginLeft: '12px', fontSize: '13px', color: '#6b7280' }}>{d.user_name}</span>}
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <ActionBtn label="Edit" onClick={() => handleEdit(d)} />
                <ActionBtn label="Delete" onClick={() => handleDelete(d.id)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TimeEntriesSection({ businessId }: { businessId: string }) {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    payrollApi.getTimeEntries(businessId).then(setEntries).finally(() => setLoading(false));
  }, [businessId]);

  const handleApprove = async (id: string) => {
    const updated = await payrollApi.approveTimeEntry(id);
    setEntries(entries.map((e: any) => e.id === id ? { ...e, ...updated } : e));
  };

  const columns = [
    { key: 'user_name', header: 'Staff', render: (_: any, r: any) => r.user_name || r.user_id },
    { key: 'entry_date', header: 'Date', render: (v: string) => v ? new Date(v).toLocaleDateString() : '—' },
    { key: 'hours', header: 'Hours', render: (_: any, r: any) => r.hours || r.duration_minutes ? `${(r.duration_minutes / 60).toFixed(1)}h` : '—' },
    { key: 'status', header: 'Status', render: (v: string) => <Badge variant={v === 'approved' ? 'success' : v === 'pending' ? 'warning' : 'neutral'}>{v}</Badge> },
    {
      key: 'actions', header: '',
      render: (_: any, r: any) => (
        r.status === 'pending' ? <ActionBtn label="Approve" onClick={() => handleApprove(r.id)} /> : null
      ),
    },
  ];

  return <Table columns={columns} data={entries} loading={loading} emptyMessage="No time entries" />;
}

function ActionBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return <button onClick={(e) => { e.stopPropagation(); onClick(); }} style={styles.actionBtn}>{label}</button>;
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1100px', margin: '0 auto' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-lg)' },
  subtitle: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-text)', marginTop: 'var(--space-xl)', marginBottom: 'var(--space-md)' },
  actionBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  input: { border: '1px solid var(--color-border, #e5e7eb)', borderRadius: '4px', padding: '6px 10px', fontSize: '14px', width: '100%', fontFamily: 'var(--font-family)' },
};
