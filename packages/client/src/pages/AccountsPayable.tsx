import { useState, useEffect, useCallback } from 'react';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Tabs } from '../design-system/components/navigation/Tabs';
import * as apApi from '../api/accounts-payable';
import { formatCurrency } from '../utils/currency';

const BILL_STATUS: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = { draft: 'neutral', pending: 'neutral', approved: 'info' as any, paid: 'success', overdue: 'error', void: 'error' };

export function AccountsPayable() {
  const [vendors, setVendors] = useState<any[]>([]);
  const [bills, setBills] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [journalEntries, setJournalEntries] = useState<any[]>([]);
  const [expenseReport, setExpenseReport] = useState<any>(null);
  const [reconciliation, setReconciliation] = useState<{ lines: any[]; status: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingVendor, setEditingVendor] = useState<any | null>(null);
  const [editVendorForm, setEditVendorForm] = useState<any>({});
  const [reportDateFrom, setReportDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [reportDateTo, setReportDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [statementId, setStatementId] = useState('');
  const businessId = localStorage.getItem('business_id') || '';

  const loadData = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [v, b, e, accts, journal] = await Promise.all([
        apApi.getVendors(businessId),
        apApi.getBills(businessId),
        apApi.getExpenses(businessId),
        apApi.getAccounts(businessId),
        apApi.getJournalEntries(businessId),
      ]);
      setVendors(v);
      setBills(b);
      setExpenses(e);
      setAccounts(accts);
      setJournalEntries(Array.isArray(journal) ? journal : journal.entries || []);
    } finally { setLoading(false); }
  }, [businessId]);

  useEffect(() => { loadData(); }, [loadData]);

  // --- Archive Account ---
  async function handleArchiveAccount(id: string) {
    if (!confirm('Archive this account? It will no longer appear in active lists.')) return;
    await apApi.archiveAccount(id, businessId);
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }

  // --- Void Journal Entry ---
  async function handleVoidEntry(id: string) {
    if (!confirm('Void this journal entry? A reversing entry will be created.')) return;
    await apApi.voidJournalEntry(id, businessId);
    const journal = await apApi.getJournalEntries(businessId);
    setJournalEntries(Array.isArray(journal) ? journal : journal.entries || []);
  }

  // --- Edit Vendor ---
  function startEditVendor(vendor: any) {
    setEditingVendor(vendor);
    setEditVendorForm({ name: vendor.name, contact_name: vendor.contact_name || '', email: vendor.email || '', phone: vendor.phone || '', category: vendor.category || '', payment_terms: vendor.payment_terms || 30 });
  }

  async function saveVendor() {
    if (!editingVendor) return;
    const updated = await apApi.updateVendor(editingVendor.id, businessId, editVendorForm);
    setVendors((prev) => prev.map((v) => (v.id === editingVendor.id ? { ...v, ...updated } : v)));
    setEditingVendor(null);
  }

  // --- Expense Report ---
  async function loadExpenseReport() {
    const report = await apApi.getExpenseReport(businessId, reportDateFrom, reportDateTo);
    setExpenseReport(report);
  }

  // --- Bank Reconciliation ---
  async function handleImportStatement() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.csv';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const parsed = JSON.parse(text);
        const result = await apApi.importStatement(
          businessId,
          parsed.account_name || 'Bank Account',
          parsed.statement_date || new Date().toISOString().slice(0, 10),
          parsed.lines || [],
        );
        if (result?.id) {
          setStatementId(result.id);
          await loadStatementDetails(result.id);
        }
      } catch { alert('Invalid file format. Expected JSON with account_name, statement_date, and lines array.'); }
    };
    input.click();
  }

  async function loadStatementDetails(id?: string) {
    const sid = id || statementId;
    if (!sid) return;
    const data = await apApi.getStatementDetails(sid);
    setReconciliation(data);
  }

  async function handleMatchLine(lineId: string) {
    const journalEntryId = prompt('Enter the Journal Entry ID to match:');
    if (!journalEntryId) return;
    await apApi.matchReconciliationLine(lineId, journalEntryId);
    await loadStatementDetails();
  }

  // --- Column definitions ---
  const vendorCols = [
    { key: 'name', header: 'Vendor' },
    { key: 'category', header: 'Category' },
    { key: 'payment_terms', header: 'Terms', render: (v: number) => `Net ${v}` },
    { key: 'total_spend', header: 'Total Spend', render: (v: number) => formatCurrency(v) },
    { key: 'outstanding', header: 'Outstanding', render: (v: number) => formatCurrency(v) },
    { key: 'actions', header: '', render: (_: any, row: any) => (
      <button style={styles.actionBtn} onClick={(e) => { e.stopPropagation(); startEditVendor(row); }} aria-label={`Edit vendor ${row.name}`}>
        ✏️ Edit
      </button>
    )},
  ];

  const billCols = [
    { key: 'vendor_name', header: 'Vendor' },
    { key: 'invoice_number', header: 'Invoice #' },
    { key: 'amount', header: 'Amount', render: (v: number) => formatCurrency(v) },
    { key: 'due_date', header: 'Due', render: (v: string) => new Date(v).toLocaleDateString() },
    { key: 'status', header: 'Status', render: (v: string) => <Badge variant={BILL_STATUS[v] || 'neutral'}>{v}</Badge> },
  ];

  const expenseCols = [
    { key: 'date', header: 'Date', render: (v: string) => new Date(v).toLocaleDateString() },
    { key: 'amount', header: 'Amount', render: (v: number) => formatCurrency(v) },
    { key: 'account_name', header: 'Category' },
    { key: 'description', header: 'Description' },
    { key: 'status', header: 'Status', render: (v: string) => <Badge variant={v === 'approved' ? 'success' : 'neutral'}>{v}</Badge> },
  ];

  const accountCols = [
    { key: 'code', header: 'Code' },
    { key: 'name', header: 'Name' },
    { key: 'account_type', header: 'Type', render: (v: string) => <Badge variant="neutral">{v}</Badge> },
    { key: 'description', header: 'Description' },
    { key: 'actions', header: '', render: (_: any, row: any) => (
      <button style={styles.dangerBtn} onClick={(e) => { e.stopPropagation(); handleArchiveAccount(row.id); }} aria-label={`Archive account ${row.name}`}>
        📦 Archive
      </button>
    )},
  ];

  const journalCols = [
    { key: 'entry_date', header: 'Date', render: (v: string) => new Date(v).toLocaleDateString() },
    { key: 'description', header: 'Description' },
    { key: 'reference_type', header: 'Ref Type' },
    { key: 'status', header: 'Status', render: (v: string) => <Badge variant={v === 'voided' ? 'error' : 'success'}>{v || 'posted'}</Badge> },
    { key: 'actions', header: '', render: (_: any, row: any) => row.status !== 'voided' ? (
      <button style={styles.dangerBtn} onClick={(e) => { e.stopPropagation(); handleVoidEntry(row.id); }} aria-label={`Void journal entry ${row.description}`}>
        🚫 Void
      </button>
    ) : null },
  ];

  const reconLineCols = [
    { key: 'date', header: 'Date', render: (v: string) => v ? new Date(v).toLocaleDateString() : '—' },
    { key: 'description', header: 'Description' },
    { key: 'amount', header: 'Amount', render: (v: number) => formatCurrency(v) },
    { key: 'matched', header: 'Status', render: (v: boolean) => <Badge variant={v ? 'success' : 'warning'}>{v ? 'Matched' : 'Unmatched'}</Badge> },
    { key: 'actions', header: '', render: (_: any, row: any) => !row.matched ? (
      <button style={styles.actionBtn} onClick={(e) => { e.stopPropagation(); handleMatchLine(row.id); }} aria-label={`Match line ${row.description}`}>
        🔗 Match
      </button>
    ) : null },
  ];

  // --- Render ---
  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Accounts Payable</h1>

      {/* Edit Vendor Modal */}
      {editingVendor && (
        <div style={styles.overlay}>
          <div style={styles.modal} role="dialog" aria-label="Edit Vendor">
            <h2 style={styles.modalTitle}>Edit Vendor</h2>
            <div style={styles.formGrid}>
              <label style={styles.fieldLabel}>
                Name
                <input style={styles.input} value={editVendorForm.name} onChange={(e) => setEditVendorForm({ ...editVendorForm, name: e.target.value })} />
              </label>
              <label style={styles.fieldLabel}>
                Contact Name
                <input style={styles.input} value={editVendorForm.contact_name} onChange={(e) => setEditVendorForm({ ...editVendorForm, contact_name: e.target.value })} />
              </label>
              <label style={styles.fieldLabel}>
                Email
                <input style={styles.input} type="email" value={editVendorForm.email} onChange={(e) => setEditVendorForm({ ...editVendorForm, email: e.target.value })} />
              </label>
              <label style={styles.fieldLabel}>
                Phone
                <input style={styles.input} value={editVendorForm.phone} onChange={(e) => setEditVendorForm({ ...editVendorForm, phone: e.target.value })} />
              </label>
              <label style={styles.fieldLabel}>
                Category
                <input style={styles.input} value={editVendorForm.category} onChange={(e) => setEditVendorForm({ ...editVendorForm, category: e.target.value })} />
              </label>
              <label style={styles.fieldLabel}>
                Payment Terms (days)
                <input style={styles.input} type="number" value={editVendorForm.payment_terms} onChange={(e) => setEditVendorForm({ ...editVendorForm, payment_terms: parseInt(e.target.value, 10) || 0 })} />
              </label>
            </div>
            <div style={styles.modalActions}>
              <button style={styles.secondaryBtn} onClick={() => setEditingVendor(null)}>Cancel</button>
              <button style={styles.primaryBtn} onClick={saveVendor}>Save</button>
            </div>
          </div>
        </div>
      )}

      <Tabs items={[
        { id: 'vendors', label: 'Vendors', content: <Table columns={vendorCols} data={vendors} loading={loading} emptyMessage="No vendors" /> },
        { id: 'bills', label: 'Bills', content: <Table columns={billCols} data={bills} loading={loading} emptyMessage="No bills" /> },
        { id: 'expenses', label: 'Expenses', content: <Table columns={expenseCols} data={expenses} loading={loading} emptyMessage="No expenses" /> },
        { id: 'accounts', label: 'Chart of Accounts', content: <Table columns={accountCols} data={accounts} loading={loading} emptyMessage="No accounts" /> },
        { id: 'journal', label: 'Journal', content: <Table columns={journalCols} data={journalEntries} loading={loading} emptyMessage="No journal entries" /> },
        { id: 'reports', label: 'Expense Reports', content: (
          <div>
            <div style={styles.toolbar}>
              <label style={styles.fieldLabel}>
                From
                <input style={styles.input} type="date" value={reportDateFrom} onChange={(e) => setReportDateFrom(e.target.value)} />
              </label>
              <label style={styles.fieldLabel}>
                To
                <input style={styles.input} type="date" value={reportDateTo} onChange={(e) => setReportDateTo(e.target.value)} />
              </label>
              <button style={styles.primaryBtn} onClick={loadExpenseReport}>Generate Report</button>
            </div>
            {expenseReport && (
              <div style={styles.reportContent}>
                {expenseReport.categories && (
                  <Table
                    columns={[
                      { key: 'category', header: 'Category' },
                      { key: 'total', header: 'Total', render: (v: number) => formatCurrency(v) },
                      { key: 'count', header: 'Transactions' },
                    ]}
                    data={expenseReport.categories}
                    emptyMessage="No expense data"
                  />
                )}
                {expenseReport.total_amount != null && (
                  <div style={styles.reportSummary}>
                    <strong>Total Expenses:</strong> {formatCurrency(expenseReport.total_amount)}
                  </div>
                )}
              </div>
            )}
            {!expenseReport && <div style={styles.emptyHint}>Select a date range and click Generate Report.</div>}
          </div>
        )},
        { id: 'reconciliation', label: 'Reconciliation', content: (
          <div>
            <div style={styles.toolbar}>
              <button style={styles.primaryBtn} onClick={handleImportStatement}>📄 Import Statement</button>
              <div style={styles.inlineGroup}>
                <input style={styles.input} placeholder="Statement ID" value={statementId} onChange={(e) => setStatementId(e.target.value)} />
                <button style={styles.secondaryBtn} onClick={() => loadStatementDetails()}>Load</button>
              </div>
            </div>
            {reconciliation && (
              <div>
                {reconciliation.status && (
                  <div style={styles.reconStatus}>
                    <Badge variant={reconciliation.status.fully_reconciled ? 'success' : 'warning'}>
                      {reconciliation.status.fully_reconciled ? 'Fully Reconciled' : `${reconciliation.status.matched_count || 0} / ${reconciliation.status.total_lines || 0} matched`}
                    </Badge>
                  </div>
                )}
                <Table columns={reconLineCols} data={reconciliation.lines || []} emptyMessage="No statement lines" />
              </div>
            )}
            {!reconciliation && <div style={styles.emptyHint}>Import a bank statement or enter a Statement ID to view details.</div>}
          </div>
        )},
      ]} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-lg)' },
  actionBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 10px', fontSize: 'var(--font-size-xs)', cursor: 'pointer', color: 'var(--color-text)', fontFamily: 'var(--font-family)' },
  dangerBtn: { background: 'none', border: '1px solid var(--color-error, #dc3545)', borderRadius: 'var(--radius-md)', padding: '4px 10px', fontSize: 'var(--font-size-xs)', cursor: 'pointer', color: 'var(--color-error, #dc3545)', fontFamily: 'var(--font-family)' },
  primaryBtn: { background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 16px', fontSize: 'var(--font-size-sm)', cursor: 'pointer', fontFamily: 'var(--font-family)', fontWeight: 'var(--font-weight-medium)' as any },
  secondaryBtn: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 16px', fontSize: 'var(--font-size-sm)', cursor: 'pointer', color: 'var(--color-text)', fontFamily: 'var(--font-family)' },
  toolbar: { display: 'flex', gap: 'var(--space-md)', alignItems: 'flex-end', marginBottom: 'var(--space-lg)', flexWrap: 'wrap' as const },
  inlineGroup: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-end' },
  fieldLabel: { display: 'flex', flexDirection: 'column' as const, gap: '4px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontWeight: 'var(--font-weight-medium)' as any },
  input: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)', color: 'var(--color-text)', background: 'var(--color-surface)' },
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-xl)', width: '100%', maxWidth: '500px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' },
  modalTitle: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-md)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)' },
  reportContent: { marginTop: 'var(--space-md)' },
  reportSummary: { padding: 'var(--space-md)', background: 'var(--color-surface-hover)', borderRadius: 'var(--radius-md)', marginTop: 'var(--space-md)', fontSize: 'var(--font-size-sm)' },
  reconStatus: { marginBottom: 'var(--space-md)' },
  emptyHint: { padding: 'var(--space-2xl)', textAlign: 'center' as const, color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
};
