import { useState, useEffect, useCallback } from 'react';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { apiClient } from '../api/client';
import { formatCurrency } from '../utils/currency';

const TYPE_VARIANTS: Record<string, 'success' | 'error' | 'info' | 'neutral'> = {
  charge: 'success', refund: 'error', credit: 'info',
};

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', card: 'Card', bank_transfer: 'Bank Transfer', check: 'Check', gift_card: 'Gift Card', google_pay: 'Google Pay', apple_pay: 'Apple Pay', other: 'Other',
};

interface Transaction {
  id: string;
  type: string;
  status: string;
  amount: number;
  currency: string;
  payment_method: string;
  reference_number?: string;
  description?: string;
  customer_id?: string;
  customer_first_name: string;
  customer_last_name: string;
  customer_email: string;
  processed_by_first_name?: string;
  processed_by_last_name?: string;
  booking_id?: string;
  membership_id?: string;
  refund_reason?: string;
  created_at: string;
}

export function Payments() {
  const businessId = localStorage.getItem('business_id') || '';
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [summary, setSummary] = useState<any>(null);

  // Record payment form
  const [showRecord, setShowRecord] = useState(false);
  const [recordForm, setRecordForm] = useState({ customer_id: '', type: 'charge', amount: '', payment_method: 'card', reference_number: '', description: '', refund_of_id: '', refund_reason: '', card_last4: '', card_brand: '', bank_routing_number: '', bank_account_number: '', check_number: '', gift_card_code: '' });
  const [customerSearchInput, setCustomerSearchInput] = useState('');
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState('');
  const [refundSource, setRefundSource] = useState<(Transaction & { remaining: number }) | null>(null);

  // Refundable charges for selected customer (paginated)
  const [refundableCharges, setRefundableCharges] = useState<any[]>([]);
  const [refundableTotal, setRefundableTotal] = useState(0);
  const [refundablePage, setRefundablePage] = useState(0); // offset-based
  const [refundableFilters, setRefundableFilters] = useState({ date_from: '', date_to: '', payment_method: '' });
  const [refundableDistinctMethods, setRefundableDistinctMethods] = useState<string[]>([]);
  const REFUNDABLE_LIMIT = 5;

  // Fetch refundable charges with filters and pagination
  const fetchRefundable = useCallback(async (offset = 0) => {
    if (!selectedCustomer?.id || recordForm.type !== 'refund') { setRefundableCharges([]); setRefundableTotal(0); setRefundableDistinctMethods([]); return; }
    const params = new URLSearchParams({ business_id: businessId, customer_id: selectedCustomer.id, limit: String(REFUNDABLE_LIMIT), offset: String(offset) });
    if (refundableFilters.date_from) params.set('date_from', refundableFilters.date_from);
    if (refundableFilters.date_to) params.set('date_to', refundableFilters.date_to);
    if (refundableFilters.payment_method) params.set('payment_method', refundableFilters.payment_method);
    try {
      const res = await apiClient.get(`/v1/payments/refundable?${params}`);
      setRefundableCharges(res.data.data || []);
      setRefundableTotal(res.data.meta?.total || 0);
      setRefundablePage(offset);
      setRefundableDistinctMethods(res.data.meta?.distinctMethods || []);
    } catch { setRefundableCharges([]); setRefundableTotal(0); setRefundableDistinctMethods([]); }
  }, [selectedCustomer, recordForm.type, businessId, refundableFilters]);

  // Load refundable charges when customer/type/filters change
  useEffect(() => {
    fetchRefundable(0);
  }, [fetchRefundable]);

  // Accepted payment methods for this business
  const [acceptedMethods, setAcceptedMethods] = useState<{ method: string; enabled: boolean }[]>([]);

  // Methods available for manual entry (excludes integration-only methods like google_pay, apple_pay)
  const MANUAL_ENTRY_METHODS = ['cash', 'card', 'bank_transfer', 'check', 'gift_card', 'other'];
  const enabledManualMethods = acceptedMethods.length > 0
    ? acceptedMethods.filter((m) => m.enabled && MANUAL_ENTRY_METHODS.includes(m.method))
    : MANUAL_ENTRY_METHODS.map((m) => ({ method: m, enabled: true }));

  // Fetch accepted methods
  useEffect(() => {
    if (!businessId) return;
    apiClient.get(`/v1/payments/methods?business_id=${businessId}`)
      .then((res) => setAcceptedMethods(res.data.data))
      .catch(() => setAcceptedMethods([]));
  }, [businessId]);

  // Detail modal
  const [detailTransaction, setDetailTransaction] = useState<any>(null);
  const [, setDetailLoading] = useState(false);

  const fetchTransactions = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ business_id: businessId });
      if (typeFilter) params.set('type', typeFilter);
      if (methodFilter) params.set('payment_method', methodFilter);
      if (customerSearch) params.set('customer_search', customerSearch);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      params.set('page', String(page));
      const res = await apiClient.get(`/v1/payments?${params}`);
      setTransactions(res.data.data);
      setTotalPages(res.data.meta?.totalPages || 1);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId, typeFilter, methodFilter, customerSearch, dateFrom, dateTo, page]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  useEffect(() => {
    if (!businessId) return;
    apiClient.get(`/v1/payments/summary?business_id=${businessId}`).then((res) => setSummary(res.data.data)).catch(() => {});
  }, [businessId]);

  // Customer search for record form
  useEffect(() => {
    if (!customerSearchInput || customerSearchInput.length < 2) { setCustomerResults([]); setShowCustomerDropdown(false); return; }
    const timeout = setTimeout(async () => {
      try {
        const res = await apiClient.get(`/v1/customers?business_id=${businessId}&search=${encodeURIComponent(customerSearchInput)}&limit=10`);
        setCustomerResults(res.data.data);
        setShowCustomerDropdown(true);
      } catch { setCustomerResults([]); }
    }, 300);
    return () => clearTimeout(timeout);
  }, [customerSearchInput, businessId]);

  const handleRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer || !recordForm.amount) { setRecordError('Customer and amount required'); return; }
    if (recordForm.type === 'refund' && !refundSource) { setRecordError('Select an original transaction to refund'); return; }
    if (recordForm.type === 'refund' && refundSource && Math.round(parseFloat(recordForm.amount) * 100) > refundSource.remaining) {
      setRecordError(`Refund amount cannot exceed the remaining refundable balance of ${formatCurrency(refundSource.remaining)}`);
      return;
    }
    setRecording(true);
    setRecordError('');
    try {
      const data: any = {
        business_id: businessId,
        customer_id: selectedCustomer.id,
        type: recordForm.type,
        amount: Math.round(parseFloat(recordForm.amount) * 100),
        payment_method: recordForm.type === 'credit' ? 'other' : recordForm.payment_method,
        reference_number: recordForm.reference_number || undefined,
        description: recordForm.description || undefined,
      };
      if (recordForm.type === 'refund' && refundSource) {
        data.refund_of_id = refundSource.id;
        data.refund_reason = recordForm.refund_reason || undefined;
      }
      // Payment method metadata
      const method = recordForm.type === 'credit' ? 'other' : recordForm.payment_method;
      if (method === 'card') {
        if (recordForm.card_last4) data.card_last4 = recordForm.card_last4;
        if (recordForm.card_brand) data.card_brand = recordForm.card_brand;
      } else if (method === 'bank_transfer') {
        if (recordForm.bank_routing_number) data.bank_routing_number = recordForm.bank_routing_number;
        if (recordForm.bank_account_number) data.bank_account_number = recordForm.bank_account_number;
      } else if (method === 'check') {
        if (recordForm.check_number) data.check_number = recordForm.check_number;
      } else if (method === 'gift_card') {
        if (recordForm.gift_card_code) data.gift_card_code = recordForm.gift_card_code;
      }
      await apiClient.post('/v1/payments', data);
      setShowRecord(false);
      setRecordForm({ customer_id: '', type: 'charge', amount: '', payment_method: 'card', reference_number: '', description: '', refund_of_id: '', refund_reason: '', card_last4: '', card_brand: '', bank_routing_number: '', bank_account_number: '', check_number: '', gift_card_code: '' });
      setSelectedCustomer(null);
      setRefundSource(null);
      fetchTransactions();
      // Refresh summary
      apiClient.get(`/v1/payments/summary?business_id=${businessId}`).then((res) => setSummary(res.data.data)).catch(() => {});
    } catch (err: any) {
      setRecordError(err.response?.data?.error || 'Failed to record payment');
    } finally {
      setRecording(false);
    }
  };

  const handleTypeChange = (type: string) => {
    if (type === 'credit') {
      setRecordForm({ ...recordForm, type, payment_method: 'other' });
    } else if (type === 'refund') {
      setRecordForm({ ...recordForm, type, payment_method: refundSource?.payment_method || 'card' });
    } else {
      setRecordForm({ ...recordForm, type });
    }
    setRefundSource(null);
  };

  const selectRefundSource = (t: any) => {
    setRefundSource(t);
    setRecordForm({ ...recordForm, payment_method: t.payment_method, amount: (t.remaining / 100).toFixed(2) });
    if (!selectedCustomer) {
      setSelectedCustomer({ id: t.customer_id || '', first_name: t.customer_first_name, last_name: t.customer_last_name, email: t.customer_email });
    }
  };

  const openDetail = async (t: Transaction) => {
    setDetailLoading(true);
    try {
      const res = await apiClient.get(`/v1/payments/${t.id}?business_id=${businessId}`);
      setDetailTransaction(res.data.data);
    } catch { setDetailTransaction(t); }
    finally { setDetailLoading(false); }
  };

  const columns = [
    {
      key: 'created_at', header: 'Date',
      render: (val: string) => new Date(val).toLocaleDateString(),
    },
    {
      key: 'customer', header: 'Customer',
      render: (_: any, t: Transaction) => `${t.customer_first_name} ${t.customer_last_name}`,
    },
    {
      key: 'type', header: 'Type',
      render: (val: string) => <Badge variant={TYPE_VARIANTS[val] || 'neutral'}>{val}</Badge>,
    },
    {
      key: 'amount', header: 'Amount',
      render: (_: any, t: Transaction) => {
        const prefix = t.type === 'refund' ? '-' : '';
        return <span style={{ color: t.type === 'refund' ? 'var(--color-error)' : 'var(--color-success)' }}>{prefix}{formatCurrency(t.amount, t.currency)}</span>;
      },
    },
    {
      key: 'payment_method', header: 'Method',
      render: (val: string) => METHOD_LABELS[val] || val,
    },
    { key: 'reference_number', header: 'Reference', render: (val: string) => val || '—' },
    { key: 'description', header: 'Note', render: (val: string) => val ? (val.length > 30 ? val.slice(0, 30) + '...' : val) : '—' },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Payments</h1>
        <Button onClick={() => setShowRecord(true)}>Record Payment</Button>
      </div>

      {/* Summary cards */}
      {summary && (
        <div style={styles.summaryRow}>
          <div style={styles.summaryCard}>
            <span style={styles.summaryLabel}>Total Collected</span>
            <span style={styles.summaryValue}>{formatCurrency(summary.total_charges)}</span>
          </div>
          <div style={styles.summaryCard}>
            <span style={styles.summaryLabel}>Total Refunded</span>
            <span style={{ ...styles.summaryValue, color: 'var(--color-error)' }}>{formatCurrency(summary.total_refunds)}</span>
          </div>
          <div style={styles.summaryCard}>
            <span style={styles.summaryLabel}>MTD Revenue</span>
            <span style={styles.summaryValue}>{formatCurrency(summary.mtd_charges - summary.mtd_refunds)}</span>
          </div>
          <div style={styles.summaryCard}>
            <span style={styles.summaryLabel}>Transactions</span>
            <span style={styles.summaryValue}>{summary.charge_count + summary.refund_count}</span>
          </div>
        </div>
      )}

      {/* Record payment modal */}
      {showRecord && (
        <div style={styles.overlay}>
          <div style={styles.recordModal}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--color-text)' }}>Record Payment</h3>
              <button style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--color-text-secondary)' }} onClick={() => setShowRecord(false)}>×</button>
            </div>
            {recordError && <p style={styles.error}>{recordError}</p>}
            <form onSubmit={handleRecord} style={styles.formGrid}>
            <div style={{ ...styles.field, gridColumn: '1 / -1', position: 'relative' as const }}>
              <label style={styles.label}>Customer *</label>
              {selectedCustomer ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', fontSize: '14px' }}>
                  <span>{selectedCustomer.first_name} {selectedCustomer.last_name} ({selectedCustomer.email})</span>
                  <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }} onClick={() => { setSelectedCustomer(null); setCustomerSearchInput(''); }}>×</button>
                </div>
              ) : (
                <input style={styles.input} value={customerSearchInput} onChange={(e) => setCustomerSearchInput(e.target.value)} placeholder="Search customer..." autoComplete="off"
                  onFocus={() => { if (customerResults.length > 0) setShowCustomerDropdown(true); }}
                  onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)} />
              )}
              {showCustomerDropdown && customerResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginTop: '4px', maxHeight: '150px', overflow: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                  {customerResults.map((c: any) => (
                    <button key={c.id} type="button" style={{ display: 'block', width: '100%', padding: '8px 12px', border: 'none', background: 'var(--color-background)', cursor: 'pointer', textAlign: 'left', color: 'var(--color-text)', fontSize: '13px', borderBottom: '1px solid var(--color-border)' }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setSelectedCustomer(c); setShowCustomerDropdown(false); setCustomerSearchInput(''); }}>
                      <strong>{c.first_name} {c.last_name}</strong> — {c.email}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Type *</label>
              <select style={styles.input} value={recordForm.type} onChange={(e) => handleTypeChange(e.target.value)}>
                <option value="charge">Payment Received</option>
                <option value="refund">Refund Issued</option>
                <option value="credit">Credit Applied</option>
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Amount *</label>
              <input style={styles.input} type="number" step="0.01" min="0.01" value={recordForm.amount} onChange={(e) => setRecordForm({ ...recordForm, amount: e.target.value })} required placeholder="0.00"
                max={recordForm.type === 'refund' && refundSource ? (refundSource.remaining / 100).toFixed(2) : undefined} />
              {recordForm.type === 'refund' && refundSource && (
                <small style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>Max refundable: {formatCurrency(refundSource.remaining)}</small>
              )}
            </div>
            {recordForm.type !== 'credit' && (
              <div style={styles.field}>
                <label style={styles.label}>Payment Method *</label>
                <select style={styles.input} value={recordForm.payment_method} onChange={(e) => setRecordForm({ ...recordForm, payment_method: e.target.value })}
                  disabled={recordForm.type === 'refund' && !!refundSource}>
                  {enabledManualMethods.map((m) => (
                    <option key={m.method} value={m.method}>{METHOD_LABELS[m.method] || m.method}</option>
                  ))}
                </select>
                {recordForm.type === 'refund' && refundSource && (
                  <small style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>Locked to match original payment method</small>
                )}
              </div>
            )}
            {/* Payment method metadata fields */}
            {recordForm.type !== 'credit' && recordForm.payment_method === 'card' && (
              <>
                <div style={styles.field}>
                  <label style={styles.label}>Card Last 4 Digits</label>
                  <input style={styles.input} value={recordForm.card_last4} onChange={(e) => setRecordForm({ ...recordForm, card_last4: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="1234" maxLength={4} />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Card Brand</label>
                  <select style={styles.input} value={recordForm.card_brand} onChange={(e) => setRecordForm({ ...recordForm, card_brand: e.target.value })}>
                    <option value="">Select brand...</option>
                    <option value="Visa">Visa</option>
                    <option value="Mastercard">Mastercard</option>
                    <option value="Amex">Amex</option>
                    <option value="Discover">Discover</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </>
            )}
            {recordForm.type !== 'credit' && recordForm.payment_method === 'bank_transfer' && (
              <>
                <div style={styles.field}>
                  <label style={styles.label}>Routing Number</label>
                  <input style={styles.input} value={recordForm.bank_routing_number} onChange={(e) => setRecordForm({ ...recordForm, bank_routing_number: e.target.value })} placeholder="Routing number" maxLength={20} />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Account Number</label>
                  <input style={styles.input} value={recordForm.bank_account_number} onChange={(e) => setRecordForm({ ...recordForm, bank_account_number: e.target.value })} placeholder="Account number" maxLength={30} />
                </div>
              </>
            )}
            {recordForm.type !== 'credit' && recordForm.payment_method === 'check' && (
              <div style={styles.field}>
                <label style={styles.label}>Check Number</label>
                <input style={styles.input} value={recordForm.check_number} onChange={(e) => setRecordForm({ ...recordForm, check_number: e.target.value })} placeholder="Check number" maxLength={20} />
              </div>
            )}
            {recordForm.type !== 'credit' && recordForm.payment_method === 'gift_card' && (
              <div style={styles.field}>
                <label style={styles.label}>Gift Card Code</label>
                <input style={styles.input} value={recordForm.gift_card_code} onChange={(e) => setRecordForm({ ...recordForm, gift_card_code: e.target.value })} placeholder="Gift card code" maxLength={50} />
              </div>
            )}
            {recordForm.type === 'refund' && (
              <>
                <div style={{ ...styles.field, gridColumn: '1 / -1' }}>
                  <label style={styles.label}>Original Transaction *</label>
                  {refundSource ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', fontSize: '13px' }}>
                      <span>{formatCurrency(refundSource.amount)} charged — {formatCurrency(refundSource.remaining)} refundable — {new Date(refundSource.created_at).toLocaleDateString()} ({METHOD_LABELS[refundSource.payment_method]})</span>
                      <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }} onClick={() => { setRefundSource(null); setRecordForm({ ...recordForm, amount: '', payment_method: 'card' }); }}>×</button>
                    </div>
                  ) : (
                    <div>
                      {!selectedCustomer && <small style={{ fontSize: '12px', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>Select a customer first to see their refundable charges.</small>}
                      {selectedCustomer && (
                        <>
                          {/* Refundable charges filters */}
                          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                            <input type="date" style={{ ...styles.input, maxWidth: '140px', padding: '4px 8px', fontSize: '12px' }} value={refundableFilters.date_from}
                              onChange={(e) => setRefundableFilters({ ...refundableFilters, date_from: e.target.value })} title="From date" />
                            <input type="date" style={{ ...styles.input, maxWidth: '140px', padding: '4px 8px', fontSize: '12px' }} value={refundableFilters.date_to}
                              onChange={(e) => setRefundableFilters({ ...refundableFilters, date_to: e.target.value })} title="To date" />
                            <select style={{ ...styles.input, maxWidth: '140px', padding: '4px 8px', fontSize: '12px' }} value={refundableFilters.payment_method}
                              onChange={(e) => setRefundableFilters({ ...refundableFilters, payment_method: e.target.value })}>
                              <option value="">All Methods</option>
                              {refundableDistinctMethods.map((m) => (
                                <option key={m} value={m}>{METHOD_LABELS[m] || m}</option>
                              ))}
                            </select>
                            {(refundableFilters.date_from || refundableFilters.date_to || refundableFilters.payment_method) && (
                              <button type="button" style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', color: 'var(--color-text-secondary)' }}
                                onClick={() => setRefundableFilters({ date_from: '', date_to: '', payment_method: '' })}>Clear</button>
                            )}
                          </div>

                          {refundableCharges.length === 0 && <small style={{ fontSize: '12px', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>No refundable charges found.</small>}
                          {refundableCharges.length > 0 && (
                            <>
                              <small style={{ fontSize: '11px', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
                                Showing {refundablePage + 1}–{Math.min(refundablePage + REFUNDABLE_LIMIT, refundableTotal)} of {refundableTotal} refundable charge{refundableTotal !== 1 ? 's' : ''}
                              </small>
                              <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                                {refundableCharges.map((t: any) => (
                                  <button key={t.id} type="button" onClick={() => selectRefundSource(t)}
                                    style={{ display: 'block', width: '100%', padding: '6px 10px', border: 'none', borderBottom: '1px solid var(--color-border)', background: 'var(--color-background)', cursor: 'pointer', textAlign: 'left', fontSize: '12px', color: 'var(--color-text)' }}>
                                    {formatCurrency(t.amount)} charged — <strong>{formatCurrency(t.remaining)} refundable</strong> — {new Date(t.created_at).toLocaleDateString()} ({METHOD_LABELS[t.payment_method]})
                                  </button>
                                ))}
                              </div>
                              {/* Pagination controls */}
                              {refundableTotal > REFUNDABLE_LIMIT && (
                                <div style={{ display: 'flex', gap: '8px', marginTop: '6px', justifyContent: 'center' }}>
                                  <button type="button" disabled={refundablePage === 0}
                                    style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '3px 10px', fontSize: '12px', cursor: refundablePage === 0 ? 'default' : 'pointer', opacity: refundablePage === 0 ? 0.4 : 1 }}
                                    onClick={() => fetchRefundable(refundablePage - REFUNDABLE_LIMIT)}>Previous</button>
                                  <button type="button" disabled={refundablePage + REFUNDABLE_LIMIT >= refundableTotal}
                                    style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '3px 10px', fontSize: '12px', cursor: refundablePage + REFUNDABLE_LIMIT >= refundableTotal ? 'default' : 'pointer', opacity: refundablePage + REFUNDABLE_LIMIT >= refundableTotal ? 0.4 : 1 }}
                                    onClick={() => fetchRefundable(refundablePage + REFUNDABLE_LIMIT)}>Next</button>
                                </div>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ ...styles.field, gridColumn: '1 / -1' }}>
                  <label style={styles.label}>Refund Reason</label>
                  <input style={styles.input} value={recordForm.refund_reason} onChange={(e) => setRecordForm({ ...recordForm, refund_reason: e.target.value })} placeholder="Reason for refund" />
                </div>
              </>
            )}
            <div style={styles.field}>
              <label style={styles.label}>Reference #</label>
              <input style={styles.input} value={recordForm.reference_number} onChange={(e) => setRecordForm({ ...recordForm, reference_number: e.target.value })} placeholder="Optional" />
            </div>
            <div style={{ ...styles.field, gridColumn: '1 / -1' }}>
              <label style={styles.label}>Description</label>
              <input style={styles.input} value={recordForm.description} onChange={(e) => setRecordForm({ ...recordForm, description: e.target.value })} placeholder="Optional note" />
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button variant="secondary" type="button" onClick={() => setShowRecord(false)}>Cancel</Button>
              <Button type="submit" loading={recording}>Record</Button>
            </div>
          </form>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={styles.toolbar}>
        <select style={styles.select} value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
          <option value="">All Types</option>
          <option value="charge">Charges</option>
          <option value="refund">Refunds</option>
          <option value="credit">Credits</option>
        </select>
        <select style={styles.select} value={methodFilter} onChange={(e) => { setMethodFilter(e.target.value); setPage(1); }}>
          <option value="">All Methods</option>
          <option value="card">Card</option>
          <option value="cash">Cash</option>
          <option value="bank_transfer">Bank Transfer</option>
          <option value="check">Check</option>
          <option value="gift_card">Gift Card</option>
          <option value="google_pay">Google Pay</option>
          <option value="apple_pay">Apple Pay</option>
          <option value="other">Other</option>
        </select>
        <input style={styles.select} type="text" value={customerSearch} onChange={(e) => { setCustomerSearch(e.target.value); setPage(1); }} placeholder="Customer..." />
        <input style={styles.select} type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} title="From" />
        <input style={styles.select} type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} title="To" />
        {(typeFilter || methodFilter || customerSearch || dateFrom || dateTo) && (
          <button style={styles.clearBtn} onClick={() => { setTypeFilter(''); setMethodFilter(''); setCustomerSearch(''); setDateFrom(''); setDateTo(''); setPage(1); }}>Clear</button>
        )}
      </div>

      {/* Transactions table */}
      <Table columns={columns} data={transactions} loading={loading} page={page} totalPages={totalPages} onPageChange={setPage} emptyMessage="No transactions recorded" onRowClick={openDetail} />

      {/* Detail modal */}
      {detailTransaction && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--color-text)' }}>Transaction Detail</h3>
              <button style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--color-text-secondary)' }} onClick={() => setDetailTransaction(null)}>×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '14px' }}>
              <div><strong>Type:</strong> <Badge variant={TYPE_VARIANTS[detailTransaction.type] || 'neutral'}>{detailTransaction.type}</Badge></div>
              <div><strong>Status:</strong> {detailTransaction.status}</div>
              <div><strong>Amount:</strong> {formatCurrency(detailTransaction.amount, detailTransaction.currency)}</div>
              <div><strong>Method:</strong> {METHOD_LABELS[detailTransaction.payment_method] || detailTransaction.payment_method}</div>
              <div><strong>Customer:</strong> {detailTransaction.customer_first_name} {detailTransaction.customer_last_name}</div>
              <div><strong>Email:</strong> {detailTransaction.customer_email}</div>
              <div><strong>Date:</strong> {new Date(detailTransaction.created_at).toLocaleString()}</div>
              <div><strong>Processed By:</strong> {detailTransaction.processed_by_first_name ? `${detailTransaction.processed_by_first_name} ${detailTransaction.processed_by_last_name}` : '—'}</div>
              {detailTransaction.reference_number && <div><strong>Reference:</strong> {detailTransaction.reference_number}</div>}
              {detailTransaction.description && <div style={{ gridColumn: '1 / -1' }}><strong>Description:</strong> {detailTransaction.description}</div>}
              {detailTransaction.refund_reason && <div style={{ gridColumn: '1 / -1' }}><strong>Refund Reason:</strong> {detailTransaction.refund_reason}</div>}
              {detailTransaction.card_last4 && <div><strong>Card:</strong> {detailTransaction.card_brand ? `${detailTransaction.card_brand} ` : ''}•••• {detailTransaction.card_last4}</div>}
              {detailTransaction.bank_routing_number && <div><strong>Routing #:</strong> {detailTransaction.bank_routing_number}</div>}
              {detailTransaction.bank_account_number && <div><strong>Account #:</strong> {detailTransaction.bank_account_number}</div>}
              {detailTransaction.check_number && <div><strong>Check #:</strong> {detailTransaction.check_number}</div>}
              {detailTransaction.gift_card_code && <div><strong>Gift Card:</strong> {detailTransaction.gift_card_code}</div>}
              {detailTransaction.booking_id && <div><strong>Booking:</strong> {detailTransaction.booking_id.slice(0, 8)}...</div>}
              {detailTransaction.membership_id && <div><strong>Membership:</strong> {detailTransaction.membership_id.slice(0, 8)}...</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  summaryRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' },
  summaryCard: { padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  summaryLabel: { fontSize: '12px', color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  summaryValue: { fontSize: '20px', fontWeight: 600, color: 'var(--color-text)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' },
  input: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: '14px', width: '100%', boxSizing: 'border-box' as const, fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)' },
  error: { color: 'var(--color-error)', fontSize: '13px', margin: '0 0 8px 0' },
  toolbar: { display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' as const, alignItems: 'center' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  clearBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  overlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '500px', maxHeight: '80vh', overflow: 'auto', border: '1px solid var(--color-border)', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' },
  recordModal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '600px', maxHeight: '85vh', overflow: 'auto', border: '1px solid var(--color-border)', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' },
};
