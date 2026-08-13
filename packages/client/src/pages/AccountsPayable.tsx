import { useState, useEffect } from 'react';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Tabs } from '../design-system/components/navigation/Tabs';
import { TableActionButton } from '../design-system/components/actions/TableActionButton';
import * as apApi from '../api/accounts-payable';
import { formatCurrency } from '../utils/currency';
import { PayrollTab } from './PayrollTab';

const BILL_STATUS: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = { draft: 'neutral', pending: 'neutral', approved: 'info' as any, paid: 'success', overdue: 'error', void: 'error' };

export function AccountsPayable() {
  const [vendors, setVendors] = useState<any[]>([]);
  const [bills, setBills] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [journalEntries, setJournalEntries] = useState<any[]>([]);
  const [vendorSearch, setVendorSearch] = useState('');
  const [billDateFrom, setBillDateFrom] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [billDateTo, setBillDateTo] = useState(() => {
    return new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);
  });
  const [billStatusFilter, setBillStatusFilter] = useState('all');
  const [expenseDateFrom, setExpenseDateFrom] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [expenseDateTo, setExpenseDateTo] = useState(() => {
    return new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);
  });
  const [expenseAccountFilter, setExpenseAccountFilter] = useState('all');
  const [expenseMethodFilter, setExpenseMethodFilter] = useState('all');
  const [accountTypeFilter, setAccountTypeFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [editingVendor, setEditingVendor] = useState<any | null>(null);
  const [editVendorForm, setEditVendorForm] = useState<any>({});
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [showBillForm, setShowBillForm] = useState(false);
  const [billForm, setBillForm] = useState<any>({ vendor_id: '', invoice_number: '', amount: '', due_date: '', description: '', account_id: '' });
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ date: new Date().toISOString().slice(0, 10), amount: '', account_id: '', description: '', payment_method: 'cash' });
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ bill_id: '', amount: '', payment_date: '', payment_method: 'transfer', reference: '' });
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
  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => { loadTab('vendors'); }, [businessId]);

  async function loadTab(tabId: string) {
    if (!businessId) return;
    setLoading(true);
    try {
      if (tabId === 'vendors') {
        const v = await apApi.getVendors(businessId);
        setVendors(v);
      } else if (tabId === 'bills') {
        const [v, b] = await Promise.all([apApi.getVendors(businessId), apApi.getBills(businessId)]);
        setVendors(v);
        setBills(b);
      } else if (tabId === 'expenses') {
        const [e, accts] = await Promise.all([apApi.getExpenses(businessId), apApi.getAccounts(businessId)]);
        setExpenses(e);
        setAccounts(accts);
      } else if (tabId === 'accounts') {
        const accts = await apApi.getAccounts(businessId);
        if (Array.isArray(accts) && accts.length === 0) {
          await apApi.seedAccounts(businessId);
          const seeded = await apApi.getAccounts(businessId);
          setAccounts(seeded);
        } else {
          setAccounts(accts);
        }
      } else if (tabId === 'journal') {
        const [accts, journal] = await Promise.all([
          apApi.getAccounts(businessId),
          apApi.getJournalEntries(businessId, { date_from: journalDateFrom, date_to: journalDateTo, page: journalPage }),
        ]);
        setAccounts(accts);
        setJournalEntries(Array.isArray(journal) ? journal : journal.data || []);
      }
    } finally { setLoading(false); }
  }

  // Reload journal when date filters change
  useEffect(() => {
    if (businessId) loadTab('journal');
  }, [journalDateFrom, journalDateTo, journalPage]);

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
    setBillForm({ ...billForm, vendor_id: vendorId, due_date: dueDate.toISOString().slice(0, 10), account_id: vendor?.default_account_id || billForm.account_id });
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
        loadTab('bills');
      } else {
        const created = await apApi.createBill({ business_id: businessId, vendor_id: billForm.vendor_id, invoice_number: billForm.invoice_number || null, amount: Math.round(parseFloat(billForm.amount) * 100), due_date: billForm.due_date, description: billForm.description || null, account_id: billForm.account_id || null });
        setBills((prev) => [...prev, created]);
      }
      setShowBillForm(false);
    } catch { alert('Failed to save bill'); }
  }

  async function handlePayBill(id: string) {
    const bill = bills.find((b: any) => b.id === id);
    const remaining = bill ? (bill.amount - bill.amount_paid) / 100 : 0;
    setPaymentForm({ bill_id: id, amount: String(remaining.toFixed(2)), payment_date: new Date().toISOString().slice(0, 10), payment_method: 'transfer', reference: '' });
    setShowPaymentForm(true);
  }

  async function submitPayment() {
    if (!paymentForm.amount || !paymentForm.bill_id) return;
    try {
      await apApi.payBill(paymentForm.bill_id, businessId, {
        amount: Math.round(parseFloat(paymentForm.amount) * 100),
        payment_date: paymentForm.payment_date || undefined,
        payment_method: paymentForm.payment_method || undefined,
        reference: paymentForm.reference || undefined,
      });
      setShowPaymentForm(false);
      loadTab('bills');
    } catch { alert('Failed to record payment'); }
  }

  // --- Expenses ---
  function openAddExpense() {
    setExpenseForm({ date: new Date().toISOString().slice(0, 10), amount: '', account_id: '', description: '', payment_method: 'cash' });
    setShowExpenseForm(true);
  }

  async function saveExpense() {
    if (!expenseForm.amount || !expenseForm.date) {
      alert('Date and Amount are required');
      return;
    }
    try {
      if ((expenseForm as any)._editId) {
        const updated = await apApi.updateExpense((expenseForm as any)._editId, businessId, {
          date: expenseForm.date,
          amount: Math.round(parseFloat(expenseForm.amount) * 100),
          account_id: expenseForm.account_id || null,
          description: expenseForm.description || null,
          payment_method: expenseForm.payment_method || 'cash',
        });
        setExpenses((prev: any[]) => prev.map((e) => e.id === (expenseForm as any)._editId ? { ...e, ...updated } : e));
      } else {
        const created = await apApi.createExpense({
          business_id: businessId,
          date: expenseForm.date,
          amount: Math.round(parseFloat(expenseForm.amount) * 100),
          account_id: expenseForm.account_id || null,
          description: expenseForm.description || null,
          payment_method: expenseForm.payment_method || 'cash',
        });
        setExpenses((prev: any[]) => [...prev, created]);
      }
      setShowExpenseForm(false);
    } catch { alert('Failed to save expense'); }
  }

  function openEditExpense(expense: any) {
    setExpenseForm({
      date: expense.date ? expense.date.split('T')[0] : '',
      amount: String((expense.amount / 100).toFixed(2)),
      account_id: expense.account_id || '',
      description: expense.description || '',
      payment_method: expense.payment_method || 'cash',
      _editId: expense.id,
    } as any);
    setShowExpenseForm(true);
  }

  async function handleDeleteExpense(id: string) {
    if (!confirm('Delete this expense? The associated journal entry will also be removed.')) return;
    try {
      await apApi.deleteExpense(id, businessId);
      setExpenses((prev: any[]) => prev.filter((e) => e.id !== id));
    } catch { alert('Failed to delete expense'); }
  }

  // --- Void Journal Entry ---
  async function handleVoidEntry(id: string) {
    if (!confirm('Void this journal entry? A reversing entry will be created.')) return;
    await apApi.voidJournalEntry(id, businessId);
    loadTab('journal');
  }

  // --- Edit Vendor ---
  function openAddVendor() {
    setEditingVendor(null);
    setEditVendorForm({ name: '', contact_name: '', email: '', phone: '', category: '', payment_terms: 30, address: '', tax_id: '', notes: '', default_account_id: '' });
    setShowVendorForm(true);
  }

  function startEditVendor(vendor: any) {
    setEditingVendor(vendor);
    setEditVendorForm({ name: vendor.name, contact_name: vendor.contact_name || '', email: vendor.email || '', phone: vendor.phone || '', category: vendor.category || '', payment_terms: vendor.payment_terms || 30, address: vendor.address || '', tax_id: vendor.tax_id || '', notes: vendor.notes || '', default_account_id: vendor.default_account_id || '' });
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

  // --- Column definitions ---
  const vendorCols = [
    { key: 'name', header: 'Vendor', sortable: true },
    { key: 'contact_name', header: 'Contact' },
    { key: 'email', header: 'Email' },
    { key: 'phone', header: 'Phone' },
    { key: 'payment_terms', header: 'Terms', render: (v: number) => v ? `Net ${v}` : '—' },
    { key: 'actions', header: '', render: (_: any, row: any) => (
      <div style={{ display: 'flex', gap: '4px' }}>
        <TableActionButton label="Edit" variant="edit" onClick={() => startEditVendor(row)} />
        <TableActionButton label="Archive" variant="archive" onClick={() => handleArchiveVendor(row.id)} />
      </div>
    )},
  ];

  const billCols = [
    { key: 'vendor_name', header: 'Vendor', sortable: true },
    { key: 'invoice_number', header: 'Invoice #' },
    { key: 'amount', header: 'Amount', render: (v: number) => formatCurrency(v) },
    { key: 'amount_paid', header: 'Paid', render: (v: number) => v > 0 ? formatCurrency(v) : '—' },
    { key: 'balance', header: 'Balance', render: (_: any, row: any) => formatCurrency(row.amount - row.amount_paid) },
    { key: 'due_date', header: 'Due', sortable: true, render: (v: string) => new Date(v).toLocaleDateString() },
    { key: 'status', header: 'Status', sortable: true, render: (v: string) => <Badge variant={BILL_STATUS[v] || 'neutral'}>{v}</Badge> },
    { key: 'actions', header: '', render: (_: any, row: any) => (
      <div style={{ display: 'flex', gap: '4px' }}>
        <TableActionButton label="Edit" variant="edit" onClick={() => openEditBill(row)} />
        {row.status !== 'paid' && <TableActionButton label="Record Payment" variant="activate" onClick={() => handlePayBill(row.id)} />}
      </div>
    )},
  ];

  const expenseCols = [
    { key: 'date', header: 'Date', sortable: true, render: (v: string) => new Date(v).toLocaleDateString() },
    { key: 'amount', header: 'Amount', sortable: true, render: (v: number) => formatCurrency(v) },
    { key: 'account_name', header: 'Account' },
    { key: 'description', header: 'Description' },
    { key: 'payment_method', header: 'Paid via' },
    { key: 'actions', header: '', render: (_: any, row: any) => (
      <div style={{ display: 'flex', gap: '4px' }}>
        <TableActionButton label="Edit" variant="edit" onClick={() => openEditExpense(row)} />
        <TableActionButton label="Delete" variant="delete" onClick={() => handleDeleteExpense(row.id)} />
      </div>
    )},
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
      loadTab('accounts');
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to save account');
    }
  }

  async function handleUnarchiveAccount(id: string) {
    try {
      await apApi.unarchiveAccount(id, businessId);
      loadTab('accounts');
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to unarchive');
    }
  }

  // --- Archive Vendor ---
  async function handleArchiveVendor(id: string) {
    if (!confirm('Archive this vendor? It will no longer appear in active lists.')) return;
    await apApi.updateVendor(id, businessId, { status: 'archived' });
    setVendors((prev) => prev.filter((v) => v.id !== id));
  }

  const filteredAccounts = (() => {
    let result = showArchived ? accounts : accounts.filter((a: any) => a.status === 'active');
    if (accountTypeFilter !== 'all') {
      result = result.filter((a: any) => a.account_type === accountTypeFilter);
    }
    return result;
  })();

  const accountsContent = (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <label style={styles.fieldLabel}>Type <select style={styles.input} value={accountTypeFilter} onChange={(e) => setAccountTypeFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="asset">Asset</option>
            <option value="liability">Liability</option>
            <option value="equity">Equity</option>
            <option value="revenue">Revenue</option>
            <option value="expense">Expense</option>
          </select></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
        </div>
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
    const [journalAccountFilter, setJournalAccountFilter] = useState('all');

    // Filter entries by account if selected
    const filteredEntries = journalAccountFilter === 'all'
      ? entries
      : entries.filter((entry: any) => entry.lines?.some((line: any) => line.account_id === journalAccountFilter));

    function handleExportCsv() {
      if (filteredEntries.length === 0) return;
      const rows: string[] = ['Date,Entry Description,Reference Type,Account Code,Account Name,Debit,Credit'];
      for (const entry of filteredEntries) {
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
    for (const entry of filteredEntries) {
      const dateStr = new Date(entry.entry_date).toLocaleDateString();
      if (!byDate.has(dateStr)) byDate.set(dateStr, []);
      byDate.get(dateStr)!.push(entry);
    }

    // For View 2: aggregate lines by account per date
    function getAccountSummary(dateEntries: any[]) {
      const accountMap = new Map<string, { accountId: string; code: string; name: string; totalDebit: number; totalCredit: number; orders: { id: string; description: string; debit: number; credit: number }[] }>();
      for (const entry of dateEntries) {
        for (const line of (entry.lines || [])) {
          const key = line.account_id;
          if (!accountMap.has(key)) {
            accountMap.set(key, { accountId: key, code: line.account_code, name: line.account_name, totalDebit: 0, totalCredit: 0, orders: [] });
          }
          const acct = accountMap.get(key)!;
          acct.totalDebit += line.debit;
          acct.totalCredit += line.credit;
          acct.orders.push({ id: entry.id, description: entry.description, debit: line.debit, credit: line.credit });
        }
      }
      let result = Array.from(accountMap.values()).sort((a, b) => a.code.localeCompare(b.code));
      if (journalAccountFilter !== 'all') {
        result = result.filter((a) => a.accountId === journalAccountFilter);
      }
      return result;
    }

    return (
      <div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
          <label style={styles.fieldLabel}>From <input style={styles.input} type="date" value={journalDateFrom} onChange={(e) => { setJournalDateFrom(e.target.value); setJournalPage(1); }} /></label>
          <label style={styles.fieldLabel}>To <input style={styles.input} type="date" value={journalDateTo} onChange={(e) => { setJournalDateTo(e.target.value); setJournalPage(1); }} /></label>
          <label style={styles.fieldLabel}>Account <select style={styles.input} value={journalAccountFilter} onChange={(e) => setJournalAccountFilter(e.target.value)}>
            <option value="all">All Accounts</option>
            {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select></label>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
            <button style={styles.secondaryBtn} onClick={handleExportCsv}>Export CSV</button>
            <button style={{ ...styles.secondaryBtn, fontWeight: viewMode === 'orders' ? 700 : 400 }} onClick={() => setViewMode('orders')}>By Order</button>
            <button style={{ ...styles.secondaryBtn, fontWeight: viewMode === 'accounts' ? 700 : 400 }} onClick={() => setViewMode('accounts')}>By Account</button>
          </div>
        </div>

        {ld && <p style={{ color: 'var(--color-text-secondary)' }}>Loading...</p>}
        {!ld && filteredEntries.length === 0 && <p style={{ color: 'var(--color-text-secondary)', textAlign: 'center' }}>No journal entries for this period</p>}

        {!ld && filteredEntries.length > 0 && viewMode === 'orders' && (
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
                            {(journalAccountFilter === 'all' ? entry.lines : entry.lines.filter((l: any) => l.account_id === journalAccountFilter)).map((line: any) => (
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

        {!ld && filteredEntries.length > 0 && viewMode === 'accounts' && (
          <div>
            {Array.from(byDate.entries()).map(([dateStr, dateEntries]) => {
              const summary = getAccountSummary(dateEntries);
              if (summary.length === 0) return null;
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


  // --- Render ---
  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Accounting</h1>

      <Tabs onTabChange={(tabId) => loadTab(tabId)} items={[
        { id: 'vendors', label: 'Vendors', content: (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
              <label style={styles.fieldLabel}>Search <input style={{ ...styles.input, width: '200px' }} type="text" placeholder="Filter by name..." value={vendorSearch} onChange={(e) => setVendorSearch(e.target.value)} /></label>
              <button style={styles.primaryBtn} onClick={openAddVendor}>Add Vendor</button>
            </div>
            {showVendorForm && (
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', marginBottom: 'var(--space-md)', background: 'var(--color-surface)' }}>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div><label style={styles.fieldLabel}>Name *</label><input style={{ ...styles.input, width: '150px' }} value={editVendorForm.name} onChange={(e) => setEditVendorForm({ ...editVendorForm, name: e.target.value })} placeholder="Vendor name" /></div>
                  <div><label style={styles.fieldLabel}>Contact</label><input style={{ ...styles.input, width: '130px' }} value={editVendorForm.contact_name} onChange={(e) => setEditVendorForm({ ...editVendorForm, contact_name: e.target.value })} placeholder="Contact person" /></div>
                  <div><label style={styles.fieldLabel}>Email</label><input style={{ ...styles.input, width: '160px' }} value={editVendorForm.email} onChange={(e) => setEditVendorForm({ ...editVendorForm, email: e.target.value })} placeholder="Email" /></div>
                  <div><label style={styles.fieldLabel}>Phone</label><input style={{ ...styles.input, width: '120px' }} value={editVendorForm.phone} onChange={(e) => setEditVendorForm({ ...editVendorForm, phone: e.target.value })} placeholder="Phone" /></div>
                  <div><label style={styles.fieldLabel}>Terms</label><input style={{ ...styles.input, width: '50px' }} type="number" value={editVendorForm.payment_terms} onChange={(e) => setEditVendorForm({ ...editVendorForm, payment_terms: parseInt(e.target.value) || 0 })} /></div>
                  <div><label style={styles.fieldLabel}>Default Account</label><select style={{ ...styles.input, width: '180px' }} value={editVendorForm.default_account_id} onChange={(e) => setEditVendorForm({ ...editVendorForm, default_account_id: e.target.value })}>
                    <option value="">— None —</option>
                    {accounts.filter((a: any) => a.account_type === 'expense' && a.status === 'active').map((a: any) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select></div>
                  <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
                    <button style={styles.primaryBtn} onClick={saveVendor}>{editingVendor ? 'Save' : 'Create'}</button>
                    <button style={styles.secondaryBtn} onClick={() => setShowVendorForm(false)}>Cancel</button>
                  </div>
                </div>
              </div>
            )}
            <Table columns={vendorCols} data={vendors.filter((v: any) => !vendorSearch || v.name?.toLowerCase().includes(vendorSearch.toLowerCase()))} loading={loading} emptyMessage="No vendors" clientSort />
          </div>
        ) },
        { id: 'bills', label: 'Bills', content: (
          <div>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
              <label style={styles.fieldLabel}>From <input style={styles.input} type="date" value={billDateFrom} onChange={(e) => setBillDateFrom(e.target.value)} /></label>
              <label style={styles.fieldLabel}>To <input style={styles.input} type="date" value={billDateTo} onChange={(e) => setBillDateTo(e.target.value)} /></label>
              <label style={styles.fieldLabel}>Status <select style={styles.input} value={billStatusFilter} onChange={(e) => setBillStatusFilter(e.target.value)}>
                <option value="all">All</option>
                <option value="draft">Draft</option>
                <option value="paid">Paid</option>
              </select></label>
              <button style={{ ...styles.primaryBtn, marginLeft: 'auto' }} onClick={openAddBill}>Add Bill</button>
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
                  <div><label style={styles.fieldLabel}>Invoice #</label><input style={styles.input} value={billForm.invoice_number} onChange={(e) => setBillForm({ ...billForm, invoice_number: e.target.value })} /></div>
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
            {showPaymentForm && (
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', marginBottom: 'var(--space-md)', background: 'var(--color-surface)' }}>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div><label style={styles.fieldLabel}>Amount (€) *</label><input style={{ ...styles.input, width: '100px' }} type="number" step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} /></div>
                  <div><label style={styles.fieldLabel}>Payment Date</label><input style={styles.input} type="date" value={paymentForm.payment_date} onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })} /></div>
                  <div><label style={styles.fieldLabel}>Method</label><select style={{ ...styles.input, width: '120px' }} value={paymentForm.payment_method} onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}>
                    <option value="transfer">Transfer</option>
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="check">Check</option>
                    <option value="other">Other</option>
                  </select></div>
                  <div><label style={styles.fieldLabel}>Reference</label><input style={{ ...styles.input, width: '150px' }} value={paymentForm.reference} onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })} placeholder="Check #, transfer ref" /></div>
                  <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
                    <button style={styles.primaryBtn} onClick={submitPayment}>Record Payment</button>
                    <button style={styles.secondaryBtn} onClick={() => setShowPaymentForm(false)}>Cancel</button>
                  </div>
                </div>
              </div>
            )}
            <Table columns={billCols} data={bills.filter((b: any) => {
              if (billDateFrom && b.due_date && b.due_date.slice(0, 10) < billDateFrom) return false;
              if (billDateTo && b.due_date && b.due_date.slice(0, 10) > billDateTo) return false;
              if (billStatusFilter !== 'all' && b.status !== billStatusFilter) return false;
              return true;
            })} loading={loading} emptyMessage="No bills" clientSort />
          </div>
        ) },
        { id: 'expenses', label: 'Expenses', content: (
          <div>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
              <label style={styles.fieldLabel}>From <input style={styles.input} type="date" value={expenseDateFrom} onChange={(e) => setExpenseDateFrom(e.target.value)} /></label>
              <label style={styles.fieldLabel}>To <input style={styles.input} type="date" value={expenseDateTo} onChange={(e) => setExpenseDateTo(e.target.value)} /></label>
              <label style={styles.fieldLabel}>Account <select style={styles.input} value={expenseAccountFilter} onChange={(e) => setExpenseAccountFilter(e.target.value)}>
                <option value="all">All</option>
                {accounts.filter((a: any) => a.account_type === 'expense' && a.status === 'active').map((a: any) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select></label>
              <label style={styles.fieldLabel}>Paid via <select style={styles.input} value={expenseMethodFilter} onChange={(e) => setExpenseMethodFilter(e.target.value)}>
                <option value="all">All</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="transfer">Transfer</option>
                <option value="other">Other</option>
              </select></label>
              <button style={{ ...styles.primaryBtn, marginLeft: 'auto' }} onClick={openAddExpense}>Add Expense</button>
            </div>
            {showExpenseForm && (
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', marginBottom: 'var(--space-md)', background: 'var(--color-surface)' }}>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div><label style={styles.fieldLabel}>Date *</label><input style={styles.input} type="date" value={expenseForm.date} onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })} /></div>
                  <div><label style={styles.fieldLabel}>Amount (€) *</label><input style={{ ...styles.input, width: '100px' }} type="number" step="0.01" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} /></div>
                  <div><label style={styles.fieldLabel}>Expense Account</label><select style={{ ...styles.input, width: '180px' }} value={expenseForm.account_id} onChange={(e) => setExpenseForm({ ...expenseForm, account_id: e.target.value })}>
                    <option value="">— Select —</option>
                    {accounts.filter((a: any) => a.account_type === 'expense' && a.status === 'active').map((a: any) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select></div>
                  <div><label style={styles.fieldLabel}>Description</label><input style={{ ...styles.input, width: '200px' }} value={expenseForm.description} onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })} placeholder="What was purchased" /></div>
                  <div><label style={styles.fieldLabel}>Paid via</label><select style={{ ...styles.input, width: '100px' }} value={expenseForm.payment_method} onChange={(e) => setExpenseForm({ ...expenseForm, payment_method: e.target.value })}>
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="transfer">Transfer</option>
                    <option value="other">Other</option>
                  </select></div>
                  <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
                    <button style={styles.primaryBtn} onClick={saveExpense}>{(expenseForm as any)._editId ? 'Save' : 'Create'}</button>
                    <button style={styles.secondaryBtn} onClick={() => setShowExpenseForm(false)}>Cancel</button>
                  </div>
                </div>
              </div>
            )}
            <Table columns={expenseCols} data={expenses.filter((e: any) => {
              const eDate = e.date ? e.date.slice(0, 10) : '';
              if (expenseDateFrom && eDate < expenseDateFrom) return false;
              if (expenseDateTo && eDate > expenseDateTo) return false;
              if (expenseAccountFilter !== 'all' && e.account_id !== expenseAccountFilter) return false;
              if (expenseMethodFilter !== 'all' && e.payment_method !== expenseMethodFilter) return false;
              return true;
            })} loading={loading} emptyMessage="No expenses" clientSort />
          </div>
        ) },
        { id: 'accounts', label: 'Chart of Accounts', content: accountsContent },
        { id: 'journal', label: 'Journal', content: <JournalTab entries={journalEntries} loading={loading} onVoid={handleVoidEntry} /> },
        { id: 'payroll', label: 'Payroll', content: <PayrollTab /> },
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
