import { useState, useEffect, useCallback } from 'react';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Tabs } from '../design-system/components/navigation/Tabs';
import { TableActionButton } from '../design-system/components/actions/TableActionButton';
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
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [showBillForm, setShowBillForm] = useState(false);
  const [billForm, setBillForm] = useState({ vendor_id: '', invoice_number: '', amount: '', due_date: '', description: '' });
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [editingAccount, setEditingAccount] = useState<any | null>(null);
  const [accountForm, setAccountForm] = useState({ code: '', name: '', account_type: 'expense', description: '' });
  const [showArchived, setShowArchived] = useState(false);
  const [journalDateFrom, setJournalDateFrom] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [journalDateTo, setJournalDateTo] = useState(() => {
    const d = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
    return d.toISOString().slice(0, 10);
  });
  const [journalPage, setJournalPage] = useState(1);
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
        apApi.getJournalEntries(businessId, { date_from: journalDateFrom, date_to: journalDateTo, page: journalPage }),
      ]);
      setVendors(v);
      setBills(b);
      setExpenses(e);
      // Auto-seed chart of accounts if empty
      if (Array.isArray(accts) && accts.length === 0) {
        await apApi.seedAccounts(businessId);
        const seeded = await apApi.getAccounts(businessId);
        setAccounts(seeded);
      } else {
        setAccounts(accts);
      }
      setJournalEntries(Array.isArray(journal) ? journal : journal.data || []);
    } finally { setLoading(false); }
  }, [businessId, journalDateFrom, journalDateTo, journalPage]);

  useEffect(() => { loadData(); }, [loadData]);

  // --- Archive Account ---
  async function handleArchiveAccount(id: string) {
    if (!confirm('Archive this account? It will no longer appear in active lists.')) return;
    await apApi.archiveAccount(id, businessId);
    setAccounts((prev) => prev.map((a) => a.id === id ? { ...a, status: 'archived' } : a));
  }

  // --- Bills ---
  function openAddBill() {
    setBillForm({ vendor_id: '', invoice_number: '', amount: '', due_date: '', description: '', account_id: '' });
    setShowBillForm(true);
  }

  function openEditBill(bill: any) {
    setBillForm({ vendor_id: bill.vendor_id, invoice_number: bill.invoice_number || '', amount: String((bill.amount / 100).toFixed(2)), due_date: bill.due_date ? bill.due_date.split('T')[0] : '', description: bill.description || '', account_id: bill.account_id || '', _editId: bill.id });
    setShowBillForm(true);
  }

  function handleVendorChange(vendorId: string) {
    const vendor = vendors.find((v: any) => v.id === vendorId);
    const terms = vendor?.payment_terms || 30;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + terms);
    setBillForm({ ...billForm, vendor_id: vendorId, due_date: dueDate.toISOString().slice(0, 10) });
  }

  async function saveBill() {
    if (!billForm.vendor_id || !billForm.amount || !billForm.due_date) {
      alert('Vendor, Amount, and Due Date are required');
      return;
    }
    try {
      if ((billForm as any)._editId) {
        await apApi.updateBill((billForm as any)._editId, businessId, {
          vendor_id: billForm.vendor_id,
          invoice_number: billForm.invoice_number || null,
          amount: Math.round(parseFloat(billForm.amount) * 100),
          due_date: billForm.due_date,
          description: billForm.description || null,
          account_id: billForm.account_id || null,
        });
        loadData();
      } else {
        const created = await apApi.createBill({ business_id: businessId, vendor_id: billForm.vendor_id, invoice_number: billForm.invoice_number || null, amount: Math.round(parseFloat(billForm.amount) * 100), due_date: billForm.due_date, description: billForm.description || null, account_id: billForm.account_id || null });
        setBills((prev) => [...prev, created]);
      }
      setShowBillForm(false);
    } catch { alert('Failed to save bill'); }
  }

  async function handleApproveBill(id: string) {
    await apApi.approveBill(id, businessId);
    loadData();
  }

  async function handlePayBill(id: string) {
    const amount = prompt('Enter payment amount (€):');
    if (!amount) return;
    await apApi.payBill(id, businessId, Math.round(parseFloat(amount) * 100));
    loadData();
  }

  // --- Void Journal Entry ---
  async function handleVoidEntry(id: string) {
    if (!confirm('Void this journal entry? A reversing entry will be created.')) return;
    await apApi.voidJournalEntry(id, businessId);
    const journal = await apApi.getJournalEntries(businessId);
    setJournalEntries(Array.isArray(journal) ? journal : journal.entries || []);
  }

  // --- Edit Vendor ---
  function openAddVendor() {
    setEditingVendor(null);
    setEditVendorForm({ name: '', contact_name: '', email: '', phone: '', category: '', payment_terms: 30, address: '', tax_id: '', notes: '' });
    setShowVendorForm(true);
  }

  function startEditVendor(vendor: any) {
    setEditingVendor(vendor);
    setEditVendorForm({ name: vendor.name, contact_name: vendor.contact_name || '', email: vendor.email || '', phone: vendor.phone || '', category: vendor.category || '', payment_terms: vendor.payment_terms || 30, address: vendor.address || '', tax_id: vendor.tax_id || '', notes: vendor.notes || '' });
    setShowVendorForm(true);
  }

  async function saveVendor() {
    if (!editVendorForm.name) return;
    if (editingVendor) {
      const updated = await apApi.updateVendor(editingVendor.id, businessId, editVendorForm);
      setVendors((prev) => prev.map((v) => (v.id === editingVendor.id ? { ...v, ...updated } : v)));
    } else {
      const created = await apApi.createVendor({ business_id: businessId, ...editVendorForm });
      setVendors((prev) => [...prev, created]);
    }
    setShowVendorForm(false);
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
    { key: 'name', header: 'Vendor', sortable: true },
    { key: 'contact_name', header: 'Contact' },
    { key: 'email', header: 'Email' },
    { key: 'category', header: 'Category', sortable: true },
    { key: 'payment_terms', header: 'Terms', render: (v: number) => v ? `Net ${v}` : '—' },
    { key: 'actions', header: '', render: (_: any, row: any) => (
      <TableActionButton label="Edit" variant="edit" onClick={() => startEditVendor(row)} />
    )},
  ];

  const billCols = [
    { key: 'vendor_name', header: 'Vendor', sortable: true },
    { key: 'invoice_number', header: 'Invoice #' },
    { key: 'amount', header: 'Amount', render: (v: number) => formatCurrency(v) },
    { key: 'due_date', header: 'Due', sortable: true, render: (v: string) => new Date(v).toLocaleDateString() },
    { key: 'status', header: 'Status', sortable: true, render: (v: string) => <Badge variant={BILL_STATUS[v] || 'neutral'}>{v}</Badge> },
    { key: 'actions', header: '', render: (_: any, row: any) => (
      <div style={{ display: 'flex', gap: '4px' }}>
        <TableActionButton label="Edit" variant="edit" onClick={() => openEditBill(row)} />
        {row.status !== 'paid' && <TableActionButton label="Pay" variant="activate" onClick={() => handlePayBill(row.id)} />}
      </div>
    )},
  ];

  const expenseCols = [
    { key: 'date', header: 'Date', render: (v: string) => new Date(v).toLocaleDateString() },
    { key: 'amount', header: 'Amount', render: (v: number) => formatCurrency(v) },
    { key: 'account_name', header: 'Category' },
    { key: 'description', header: 'Description' },
    { key: 'status', header: 'Status', render: (v: string) => <Badge variant={v === 'approved' ? 'success' : 'neutral'}>{v}</Badge> },
  ];

  const accountCols = [
    { key: 'code', header: 'Code', sortable: true },
    { key: 'account_type', header: 'Type', sortable: true },
    { key: 'name', header: 'Name', sortable: true },
    { key: 'description', header: 'Description' },
    { key: 'actions', header: '', render: (_: any, row: any) => (
      <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
        <TableActionButton label="Edit" variant="edit" onClick={() => openEditAccount(row)} />
        {row.status === 'active' && (
          <TableActionButton label="Archive" variant="archive" onClick={() => handleArchiveAccount(row.id)} />
        )}
        {row.status === 'archived' && (
          <TableActionButton label="Restore" variant="restore" onClick={() => handleUnarchiveAccount(row.id)} />
        )}
      </div>
    )},
  ];

  function openAddAccount() {
    setEditingAccount(null);
    setAccountForm({ code: '', name: '', account_type: 'expense', description: '' });
    setShowAddAccount(true);
  }

  function openEditAccount(acct: any) {
    setEditingAccount(acct);
    setAccountForm({ code: acct.code, name: acct.name, account_type: acct.account_type, description: acct.description || '' });
    setShowAddAccount(true);
  }

  async function handleSaveAccount() {
    if (!accountForm.code || !accountForm.name) return;
    try {
      if (editingAccount) {
        await apApi.updateAccount(editingAccount.id, businessId, { code: accountForm.code, name: accountForm.name, description: accountForm.description });
      } else {
        await apApi.createAccount({ business_id: businessId, ...accountForm });
      }
      setShowAddAccount(false);
      loadData();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to save account');
    }
  }

  async function handleUnarchiveAccount(id: string) {
    try {
      await apApi.unarchiveAccount(id, businessId);
      loadData();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to unarchive');
    }
  }

  const filteredAccounts = showArchived ? accounts : accounts.filter((a: any) => a.status === 'active');

  const accountsContent = (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
        </label>
        <button style={styles.primaryBtn} onClick={openAddAccount}>Add Account</button>
      </div>
      {showAddAccount && (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', marginBottom: 'var(--space-md)', background: 'var(--color-surface)' }}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end' }}>
            <div><label style={styles.fieldLabel}>Code</label><input style={{ ...styles.input, width: '80px' }} value={accountForm.code} onChange={(e) => setAccountForm({ ...accountForm, code: e.target.value })} placeholder="e.g. 4600" /></div>
            <div><label style={styles.fieldLabel}>Type</label><select style={{ ...styles.input, width: '120px' }} value={accountForm.account_type} onChange={(e) => setAccountForm({ ...accountForm, account_type: e.target.value })} disabled={!!editingAccount}>
              <option value="asset">Asset</option><option value="liability">Liability</option><option value="equity">Equity</option><option value="revenue">Revenue</option><option value="expense">Expense</option>
            </select></div>
            <div><label style={styles.fieldLabel}>Name</label><input style={{ ...styles.input, width: '280px' }} value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} placeholder="Account name" /></div>
            <div><label style={styles.fieldLabel}>Description</label><input style={{ ...styles.input, width: '280px' }} value={accountForm.description} onChange={(e) => setAccountForm({ ...accountForm, description: e.target.value })} placeholder="Optional" /></div>
            <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
              <button style={styles.primaryBtn} onClick={handleSaveAccount}>{editingAccount ? 'Save' : 'Create'}</button>
              <button style={styles.secondaryBtn} onClick={() => setShowAddAccount(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <Table columns={accountCols} data={filteredAccounts} loading={loading} emptyMessage="No accounts" clientSort />
    </div>
  );

  function JournalTab({ entries, loading: ld, onVoid }: { entries: any[]; loading: boolean; onVoid: (id: string) => void }) {
    const [expandedDate, setExpandedDate] = useState<string | null>(null);
    const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'orders' | 'accounts'>('orders');

    function handleExportCsv() {
      if (entries.length === 0) return;
      const rows: string[] = ['Date,Entry Description,Reference Type,Account Code,Account Name,Debit,Credit'];
      for (const entry of entries) {
        const date = new Date(entry.entry_date).toLocaleDateString('sv-SE');
        for (const line of (entry.lines || [])) {
          rows.push([
            date,
            `"${(entry.description || '').replace(/"/g, '""')}"`,
            entry.reference_type || '',
            line.account_code || '',
            `"${(line.account_name || '').replace(/"/g, '""')}"`,
            line.debit > 0 ? (line.debit / 100).toFixed(2) : '',
            line.credit > 0 ? (line.credit / 100).toFixed(2) : '',
          ].join(','));
        }
      }
      const csv = rows.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `journal_${journalDateFrom}_to_${journalDateTo}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    }

    // Group entries by date
    const byDate = new Map<string, any[]>();
    for (const entry of entries) {
      const dateStr = new Date(entry.entry_date).toLocaleDateString();
      if (!byDate.has(dateStr)) byDate.set(dateStr, []);
      byDate.get(dateStr)!.push(entry);
    }

    // For View 2: aggregate lines by account per date
    function getAccountSummary(dateEntries: any[]) {
      const accountMap = new Map<string, { code: string; name: string; totalDebit: number; totalCredit: number; orders: { id: string; description: string; debit: number; credit: number }[] }>();
      for (const entry of dateEntries) {
        for (const line of (entry.lines || [])) {
          const key = line.account_id;
          if (!accountMap.has(key)) {
            accountMap.set(key, { code: line.account_code, name: line.account_name, totalDebit: 0, totalCredit: 0, orders: [] });
          }
          const acct = accountMap.get(key)!;
          acct.totalDebit += line.debit;
          acct.totalCredit += line.credit;
          acct.orders.push({ id: entry.id, description: entry.description, debit: line.debit, credit: line.credit });
        }
      }
      return Array.from(accountMap.values()).sort((a, b) => a.code.localeCompare(b.code));
    }

    return (
      <div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
          <label style={styles.fieldLabel}>From <input style={styles.input} type="date" value={journalDateFrom} onChange={(e) => { setJournalDateFrom(e.target.value); setJournalPage(1); }} /></label>
          <label style={styles.fieldLabel}>To <input style={styles.input} type="date" value={journalDateTo} onChange={(e) => { setJournalDateTo(e.target.value); setJournalPage(1); }} /></label>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
            <button style={styles.secondaryBtn} onClick={handleExportCsv}>Export CSV</button>
            <button style={{ ...styles.secondaryBtn, fontWeight: viewMode === 'orders' ? 700 : 400 }} onClick={() => setViewMode('orders')}>By Order</button>
            <button style={{ ...styles.secondaryBtn, fontWeight: viewMode === 'accounts' ? 700 : 400 }} onClick={() => setViewMode('accounts')}>By Account</button>
          </div>
        </div>

        {ld && <p style={{ color: 'var(--color-text-secondary)' }}>Loading...</p>}
        {!ld && entries.length === 0 && <p style={{ color: 'var(--color-text-secondary)', textAlign: 'center' }}>No journal entries for this period</p>}

        {!ld && entries.length > 0 && viewMode === 'orders' && (
          <div>
            {Array.from(byDate.entries()).map(([dateStr, dateEntries]) => (
              <div key={dateStr} style={{ marginBottom: '4px' }}>
                <div
                  style={{ padding: '10px 8px', cursor: 'pointer', fontWeight: 600, fontSize: '14px', color: 'var(--color-text)', background: expandedDate === dateStr ? 'var(--color-background)' : undefined, borderBottom: '1px solid var(--color-border)' }}
                  onClick={() => setExpandedDate(expandedDate === dateStr ? null : dateStr)}
                >
                  {dateStr} <span style={{ fontWeight: 400, fontSize: '12px', color: 'var(--color-text-secondary)', marginLeft: '8px' }}>({dateEntries.length} {dateEntries.length === 1 ? 'order' : 'orders'})</span>
                </div>
                {expandedDate === dateStr && (
                  <div style={{ paddingLeft: '20px' }}>
                    {dateEntries.map((entry: any) => (
                      <div key={entry.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <div
                          style={{ padding: '8px 4px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                          onClick={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
                        >
                          <span style={{ fontSize: '13px' }}>
                            <strong>{entry.description}</strong>
                            {entry.is_void && <Badge variant="error">voided</Badge>}
                          </span>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <span style={{ fontSize: '13px', fontWeight: 500 }}>{formatCurrency(entry.lines?.reduce((s: number, l: any) => s + l.debit, 0) || 0)}</span>
                            {!entry.is_void && <TableActionButton label="Void" variant="delete" onClick={() => onVoid(entry.id)} />}
                          </div>
                        </div>
                        {expandedEntry === entry.id && entry.lines && (
                          <div style={{ paddingLeft: '20px', paddingBottom: '8px' }}>
                            {entry.lines.map((line: any) => (
                              <div key={line.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                <span>{line.debit > 0 ? 'Debit' : 'Credit'}: {line.account_code} — {line.account_name}</span>
                                <span>{formatCurrency(line.debit || line.credit)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!ld && entries.length > 0 && viewMode === 'accounts' && (
          <div>
            {Array.from(byDate.entries()).map(([dateStr, dateEntries]) => {
              const summary = getAccountSummary(dateEntries);
              return (
                <div key={dateStr} style={{ marginBottom: '4px' }}>
                  <div
                    style={{ padding: '10px 8px', cursor: 'pointer', fontWeight: 600, fontSize: '14px', color: 'var(--color-text)', background: expandedDate === dateStr ? 'var(--color-background)' : undefined, borderBottom: '1px solid var(--color-border)' }}
                    onClick={() => setExpandedDate(expandedDate === dateStr ? null : dateStr)}
                  >
                    {dateStr} <span style={{ fontWeight: 400, fontSize: '12px', color: 'var(--color-text-secondary)', marginLeft: '8px' }}>({summary.length} accounts)</span>
                  </div>
                  {expandedDate === dateStr && (
                    <div style={{ paddingLeft: '20px' }}>
                      {summary.map((acct) => (
                        <div key={acct.code} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <div
                            style={{ padding: '8px 4px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                            onClick={() => setExpandedEntry(expandedEntry === acct.code + dateStr ? null : acct.code + dateStr)}
                          >
                            <span style={{ fontSize: '13px' }}><strong>{acct.code} — {acct.name}</strong></span>
                            <span style={{ fontSize: '13px' }}>
                              {acct.totalDebit > 0 && <span style={{ marginRight: '16px' }}>Debit {formatCurrency(acct.totalDebit)}</span>}
                              {acct.totalCredit > 0 && <span>Credit {formatCurrency(acct.totalCredit)}</span>}
                            </span>
                          </div>
                          {expandedEntry === acct.code + dateStr && (
                            <div style={{ paddingLeft: '20px', paddingBottom: '8px' }}>
                              {acct.orders.map((ord, idx) => (
                                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                  <span>{ord.description}</span>
                                  <span>{ord.debit > 0 ? formatCurrency(ord.debit) : formatCurrency(ord.credit)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

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
      <h1 style={styles.title}>Accounting</h1>

      <Tabs items={[
        { id: 'vendors', label: 'Vendors', content: (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-md)' }}>
              <button style={styles.primaryBtn} onClick={openAddVendor}>Add Vendor</button>
            </div>
            {showVendorForm && (
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', marginBottom: 'var(--space-md)', background: 'var(--color-surface)' }}>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div><label style={styles.fieldLabel}>Name *</label><input style={styles.input} value={editVendorForm.name} onChange={(e) => setEditVendorForm({ ...editVendorForm, name: e.target.value })} placeholder="Vendor name" /></div>
                  <div><label style={styles.fieldLabel}>Contact</label><input style={styles.input} value={editVendorForm.contact_name} onChange={(e) => setEditVendorForm({ ...editVendorForm, contact_name: e.target.value })} placeholder="Contact person" /></div>
                  <div><label style={styles.fieldLabel}>Email</label><input style={styles.input} value={editVendorForm.email} onChange={(e) => setEditVendorForm({ ...editVendorForm, email: e.target.value })} placeholder="Email" /></div>
                  <div><label style={styles.fieldLabel}>Phone</label><input style={styles.input} value={editVendorForm.phone} onChange={(e) => setEditVendorForm({ ...editVendorForm, phone: e.target.value })} placeholder="Phone" /></div>
                  <div><label style={styles.fieldLabel}>Category</label><input style={styles.input} value={editVendorForm.category} onChange={(e) => setEditVendorForm({ ...editVendorForm, category: e.target.value })} placeholder="e.g. Supplies" /></div>
                  <div><label style={styles.fieldLabel}>Terms (days)</label><input style={{ ...styles.input, width: '80px' }} type="number" value={editVendorForm.payment_terms} onChange={(e) => setEditVendorForm({ ...editVendorForm, payment_terms: parseInt(e.target.value) || 0 })} /></div>
                  <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
                    <button style={styles.primaryBtn} onClick={saveVendor}>{editingVendor ? 'Save' : 'Create'}</button>
                    <button style={styles.secondaryBtn} onClick={() => setShowVendorForm(false)}>Cancel</button>
                  </div>
                </div>
              </div>
            )}
            <Table columns={vendorCols} data={vendors} loading={loading} emptyMessage="No vendors" clientSort />
          </div>
        ) },
        { id: 'bills', label: 'Bills', content: (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-md)' }}>
              <button style={styles.primaryBtn} onClick={openAddBill}>Add Bill</button>
            </div>
            {showBillForm && (
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', marginBottom: 'var(--space-md)', background: 'var(--color-surface)' }}>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div><label style={styles.fieldLabel}>Vendor *</label><select style={styles.input} value={billForm.vendor_id} onChange={(e) => handleVendorChange(e.target.value)}>
                    <option value="">— Select —</option>
                    {vendors.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select></div>
                  <div><label style={styles.fieldLabel}>Expense Account</label><select style={styles.input} value={billForm.account_id} onChange={(e) => setBillForm({ ...billForm, account_id: e.target.value })}>
                    <option value="">— Select —</option>
                    {accounts.filter((a: any) => a.account_type === 'expense' && a.status === 'active').map((a: any) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select></div>
                  <div><label style={styles.fieldLabel}>Invoice #</label><input style={styles.input} value={billForm.invoice_number} onChange={(e) => setBillForm({ ...billForm, invoice_number: e.target.value })} placeholder="INV-001" /></div>
                  <div><label style={styles.fieldLabel}>Amount (€) *</label><input style={{ ...styles.input, width: '100px' }} type="number" step="0.01" value={billForm.amount} onChange={(e) => setBillForm({ ...billForm, amount: e.target.value })} /></div>
                  <div><label style={styles.fieldLabel}>Due Date *</label><input style={styles.input} type="date" value={billForm.due_date} onChange={(e) => setBillForm({ ...billForm, due_date: e.target.value })} /></div>
                  <div><label style={styles.fieldLabel}>Description</label><input style={styles.input} value={billForm.description} onChange={(e) => setBillForm({ ...billForm, description: e.target.value })} placeholder="What for" /></div>
                  <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
                    <button style={styles.primaryBtn} onClick={saveBill}>{(billForm as any)._editId ? 'Save' : 'Create'}</button>
                    <button style={styles.secondaryBtn} onClick={() => setShowBillForm(false)}>Cancel</button>
                  </div>
                </div>
              </div>
            )}
            <Table columns={billCols} data={bills} loading={loading} emptyMessage="No bills" clientSort />
          </div>
        ) },
        { id: 'expenses', label: 'Expenses', content: <Table columns={expenseCols} data={expenses} loading={loading} emptyMessage="No expenses" /> },
        { id: 'accounts', label: 'Chart of Accounts', content: accountsContent },
        { id: 'journal', label: 'Journal', content: <JournalTab entries={journalEntries} loading={loading} onVoid={handleVoidEntry} /> },
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
