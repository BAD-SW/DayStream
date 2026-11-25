import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { Table } from '../design-system/components/data/Table';
import type { TableFilters } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { apiClient } from '../api/client';
import { formatCurrency } from '../utils/currency';
import { formatDate, formatDateTime, formatNumber } from '../utils/format';
import { ReceiptActions } from '../components/ReceiptActions';

const TYPE_VARIANTS: Record<string, 'success' | 'error' | 'info' | 'neutral'> = {
  charge: 'success', refund: 'error', credit: 'info',
};

// Stored payment methods, shown through payments:method.<value>.
const METHOD_KEYS = ['cash', 'card', 'bank_transfer', 'check', 'gift_card', 'google_pay', 'apple_pay', 'other'];
// Stored transaction statuses, shown through payments:status.<value>.
const STATUS_KEYS = ['completed', 'pending', 'failed', 'refunded', 'partially_refunded', 'voided', 'cancelled'];
const CARD_BRANDS = ['Visa', 'Mastercard', 'Amex', 'Discover'];

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
  const { t } = useTranslation('payments');
  const navigate = useNavigate();
  const methodLabel = (m: string) => (METHOD_KEYS.includes(m) ? t(`method.${m}`) : m);
  const typeLabel = (v: string) => (v in TYPE_VARIANTS ? t(`type.${v}`) : v);
  const statusLabel = (s: string) => (STATUS_KEYS.includes(s) ? t(`status.${s}`) : s);
  const businessId = localStorage.getItem('business_id') || '';
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  // Column filters from the icon beside each sort icon (David, 2026-11-02).
  const [tableFilters, setTableFilters] = useState<TableFilters>({});
  // No pages: more payments load as the list scrolls.
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
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
      const res = await apiClient.get(`/v1/payments?${listParams(1)}`);
      setTransactions(res.data.data);
      setPage(1);
      setTotal(res.data.meta?.total || 0);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [businessId, tableFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  function listParams(p: number) {
    const params = new URLSearchParams({ business_id: businessId, page: String(p), limit: '50' });
    if (Object.keys(tableFilters).length) params.set('cf', JSON.stringify(tableFilters));
    return params;
  }
  const loadMore = useCallback(async () => {
    if (loadingMore || transactions.length >= total) return;
    setLoadingMore(true);
    try {
      const res = await apiClient.get(`/v1/payments?${listParams(page + 1)}`);
      setTransactions((rows) => [...rows, ...res.data.data]);
      setPage(page + 1);
      setTotal(res.data.meta?.total || 0);
    } catch { /* Show more stays to try again */ }
    finally { setLoadingMore(false); }
  }, [businessId, tableFilters, page, loadingMore, transactions.length, total]); // eslint-disable-line react-hooks/exhaustive-deps

  const filterOptions = useCallback(async (key: string) => {
    const params = new URLSearchParams({ business_id: businessId, column: key });
    if (Object.keys(tableFilters).length) params.set('cf', JSON.stringify(tableFilters));
    const res = await apiClient.get(`/v1/payments/column-values?${params}`);
    return (res.data.data as Array<{ value: string; label: string; count: number }>).map((v) => ({
      value: v.value, count: v.count,
      label: key === 'payment_method' ? methodLabel(v.value)
        : key === 'amount' ? formatCurrency(Number(v.value))
        : v.label || v.value,
    }));
  }, [businessId, tableFilters]);

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
    if (!selectedCustomer || !recordForm.amount) { setRecordError(t('record.customerAmountRequired')); return; }
    if (recordForm.type === 'refund' && !refundSource) { setRecordError(t('record.selectOriginal')); return; }
    if (recordForm.type === 'refund' && refundSource && Math.round(parseFloat(recordForm.amount) * 100) > refundSource.remaining) {
      setRecordError(t('record.refundTooHigh', { amount: formatCurrency(refundSource.remaining) }));
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
      setRecordError(err.response?.data?.error || t('record.failed'));
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

  const selectRefundSource = (tx: any) => {
    setRefundSource(tx);
    setRecordForm({ ...recordForm, payment_method: tx.payment_method, amount: (tx.remaining / 100).toFixed(2) });
    if (!selectedCustomer) {
      setSelectedCustomer({ id: tx.customer_id || '', first_name: tx.customer_first_name, last_name: tx.customer_last_name, email: tx.customer_email });
    }
  };

  const openDetail = async (tx: Transaction) => {
    setDetailLoading(true);
    try {
      const res = await apiClient.get(`/v1/payments/${tx.id}?business_id=${businessId}`);
      setDetailTransaction(res.data.data);
    } catch { setDetailTransaction(tx); }
    finally { setDetailLoading(false); }
  };

  const columns = [
    {
      key: 'created_at', header: t('col.date'), filter: 'date' as const,
      render: (val: string) => formatDate(val),
    },
    {
      key: 'customer', header: t('col.customer'), filter: 'values' as const,
      render: (_: any, tx: Transaction) => `${tx.customer_first_name} ${tx.customer_last_name}`,
    },
    {
      key: 'type', header: t('col.type'),
      render: (val: string) => <Badge variant={TYPE_VARIANTS[val] || 'neutral'}>{typeLabel(val)}</Badge>,
    },
    {
      key: 'amount', header: t('col.amount'), filter: 'amount' as const,
      render: (_: any, tx: Transaction) => {
        const prefix = tx.type === 'refund' ? '-' : '';
        return <span style={{ color: tx.type === 'refund' ? 'var(--color-error)' : 'var(--color-success)' }}>{prefix}{formatCurrency(tx.amount, tx.currency)}</span>;
      },
    },
    {
      key: 'payment_method', header: t('col.method'),
      render: (val: string) => methodLabel(val),
    },
    { key: 'reference_number', header: t('col.reference'), render: (val: string) => val || 'â€”' },
    { key: 'description', header: t('col.note'), render: (val: string) => val ? (val.length > 30 ? val.slice(0, 30) + '...' : val) : 'â€”' },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>{t('title')}</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button variant="secondary" onClick={() => navigate('/gift-cards')}>{t('giftCards')}</Button>
          <Button onClick={() => setShowRecord(true)}>{t('record.title')}</Button>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div style={styles.summaryRow}>
          <div style={styles.summaryCard}>
            <span style={styles.summaryLabel}>{t('summary.totalCollected')}</span>
            <span style={styles.summaryValue}>{formatCurrency(summary.total_charges)}</span>
          </div>
          <div style={styles.summaryCard}>
            <span style={styles.summaryLabel}>{t('summary.totalRefunded')}</span>
            <span style={{ ...styles.summaryValue, color: 'var(--color-error)' }}>{formatCurrency(summary.total_refunds)}</span>
          </div>
          <div style={styles.summaryCard}>
            <span style={styles.summaryLabel}>{t('summary.mtdRevenue')}</span>
            <span style={styles.summaryValue}>{formatCurrency(summary.mtd_charges - summary.mtd_refunds)}</span>
          </div>
          <div style={styles.summaryCard}>
            <span style={styles.summaryLabel}>{t('summary.transactions')}</span>
            <span style={styles.summaryValue}>{formatNumber(summary.charge_count + summary.refund_count)}</span>
          </div>
        </div>
      )}

      {/* Record payment modal */}
      {showRecord && (
        <div style={styles.overlay}>
          <div style={styles.recordModal}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', color: 'var(--color-text)' }}>{t('record.title')}</h3>
              <button style={{ background: 'none', border: 'none', fontSize: 'var(--font-size-xl)', cursor: 'pointer', color: 'var(--color-text-secondary)' }} onClick={() => setShowRecord(false)}>Ã—</button>
            </div>
            {recordError && <p style={styles.error}>{recordError}</p>}
            <form onSubmit={handleRecord} style={styles.formGrid}>
            <div style={{ ...styles.field, gridColumn: '1 / -1', position: 'relative' as const }}>
              <label style={styles.label}>{t('record.customer')}</label>
              {selectedCustomer ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', fontSize: 'var(--font-size-base)' }}>
                  <span>{selectedCustomer.first_name} {selectedCustomer.last_name} ({selectedCustomer.email})</span>
                  <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-base)' }} onClick={() => { setSelectedCustomer(null); setCustomerSearchInput(''); }}>Ã—</button>
                </div>
              ) : (
                <input style={styles.input} value={customerSearchInput} onChange={(e) => setCustomerSearchInput(e.target.value)} placeholder={t('record.searchCustomer')} autoComplete="off"
                  onFocus={() => { if (customerResults.length > 0) setShowCustomerDropdown(true); }}
                  onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)} />
              )}
              {showCustomerDropdown && customerResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginTop: '4px', maxHeight: '150px', overflow: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                  {customerResults.map((c: any) => (
                    <button key={c.id} type="button" style={{ display: 'block', width: '100%', padding: '8px 12px', border: 'none', background: 'var(--color-background)', cursor: 'pointer', textAlign: 'left', color: 'var(--color-text)', fontSize: 'var(--font-size-sm)', borderBottom: '1px solid var(--color-border)' }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setSelectedCustomer(c); setShowCustomerDropdown(false); setCustomerSearchInput(''); }}>
                      <strong>{c.first_name} {c.last_name}</strong> â€” {c.email}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={styles.field}>
              <label style={styles.label}>{t('record.type')}</label>
              <select style={styles.input} value={recordForm.type} onChange={(e) => handleTypeChange(e.target.value)}>
                <option value="charge">{t('record.typeCharge')}</option>
                <option value="refund">{t('record.typeRefund')}</option>
                <option value="credit">{t('record.typeCredit')}</option>
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>{t('record.amount')}</label>
              <input style={styles.input} type="number" step="0.01" min="0.01" value={recordForm.amount} onChange={(e) => setRecordForm({ ...recordForm, amount: e.target.value })} required placeholder="0.00"
                max={recordForm.type === 'refund' && refundSource ? (refundSource.remaining / 100).toFixed(2) : undefined} />
              {recordForm.type === 'refund' && refundSource && (
                <small style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>{t('record.maxRefundable', { amount: formatCurrency(refundSource.remaining) })}</small>
              )}
            </div>
            {recordForm.type !== 'credit' && (
              <div style={styles.field}>
                <label style={styles.label}>{t('record.method')}</label>
                <select style={styles.input} value={recordForm.payment_method} onChange={(e) => setRecordForm({ ...recordForm, payment_method: e.target.value })}
                  disabled={recordForm.type === 'refund' && !!refundSource}>
                  {enabledManualMethods.map((m) => (
                    <option key={m.method} value={m.method}>{methodLabel(m.method)}</option>
                  ))}
                </select>
                {recordForm.type === 'refund' && refundSource && (
                  <small style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>{t('record.methodLocked')}</small>
                )}
              </div>
            )}
            {/* Payment method metadata fields */}
            {recordForm.type !== 'credit' && recordForm.payment_method === 'card' && (
              <>
                <div style={styles.field}>
                  <label style={styles.label}>{t('record.cardLast4')}</label>
                  <input style={styles.input} value={recordForm.card_last4} onChange={(e) => setRecordForm({ ...recordForm, card_last4: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="1234" maxLength={4} />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>{t('record.cardBrand')}</label>
                  <select style={styles.input} value={recordForm.card_brand} onChange={(e) => setRecordForm({ ...recordForm, card_brand: e.target.value })}>
                    <option value="">{t('record.selectBrand')}</option>
                    {CARD_BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                    <option value="Other">{t('record.brandOther')}</option>
                  </select>
                </div>
              </>
            )}
            {recordForm.type !== 'credit' && recordForm.payment_method === 'bank_transfer' && (
              <>
                <div style={styles.field}>
                  <label style={styles.label}>{t('record.routingNumber')}</label>
                  <input style={styles.input} value={recordForm.bank_routing_number} onChange={(e) => setRecordForm({ ...recordForm, bank_routing_number: e.target.value })} placeholder={t('record.routingPlaceholder')} maxLength={20} />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>{t('record.accountNumber')}</label>
                  <input style={styles.input} value={recordForm.bank_account_number} onChange={(e) => setRecordForm({ ...recordForm, bank_account_number: e.target.value })} placeholder={t('record.accountPlaceholder')} maxLength={30} />
                </div>
              </>
            )}
            {recordForm.type !== 'credit' && recordForm.payment_method === 'check' && (
              <div style={styles.field}>
                <label style={styles.label}>{t('record.checkNumber')}</label>
                <input style={styles.input} value={recordForm.check_number} onChange={(e) => setRecordForm({ ...recordForm, check_number: e.target.value })} placeholder={t('record.checkPlaceholder')} maxLength={20} />
              </div>
            )}
            {recordForm.type !== 'credit' && recordForm.payment_method === 'gift_card' && (
              <div style={styles.field}>
                <label style={styles.label}>{t('record.giftCardCode')}</label>
                <input style={styles.input} value={recordForm.gift_card_code} onChange={(e) => setRecordForm({ ...recordForm, gift_card_code: e.target.value })} placeholder={t('record.giftCardPlaceholder')} maxLength={50} />
              </div>
            )}
            {recordForm.type === 'refund' && (
              <>
                <div style={{ ...styles.field, gridColumn: '1 / -1' }}>
                  <label style={styles.label}>{t('record.originalTransaction')}</label>
                  {refundSource ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', fontSize: 'var(--font-size-sm)' }}>
                      <span>{t('record.sourceLine', { amount: formatCurrency(refundSource.amount), remaining: formatCurrency(refundSource.remaining), date: formatDate(refundSource.created_at), method: methodLabel(refundSource.payment_method) })}</span>
                      <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-base)' }} onClick={() => { setRefundSource(null); setRecordForm({ ...recordForm, amount: '', payment_method: 'card' }); }}>Ã—</button>
                    </div>
                  ) : (
                    <div>
                      {!selectedCustomer && <small style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>{t('record.selectCustomerFirst')}</small>}
                      {selectedCustomer && (
                        <>
                          {/* Refundable charges filters */}
                          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                            <input type="date" style={{ ...styles.input, maxWidth: '140px', padding: '4px 8px', fontSize: 'var(--font-size-sm)' }} value={refundableFilters.date_from}
                              onChange={(e) => setRefundableFilters({ ...refundableFilters, date_from: e.target.value })} title={t('common:dateRange.fromDate')} />
                            <input type="date" style={{ ...styles.input, maxWidth: '140px', padding: '4px 8px', fontSize: 'var(--font-size-sm)' }} value={refundableFilters.date_to}
                              onChange={(e) => setRefundableFilters({ ...refundableFilters, date_to: e.target.value })} title={t('common:dateRange.toDate')} />
                            <select style={{ ...styles.input, maxWidth: '140px', padding: '4px 8px', fontSize: 'var(--font-size-sm)' }} value={refundableFilters.payment_method}
                              onChange={(e) => setRefundableFilters({ ...refundableFilters, payment_method: e.target.value })}>
                              <option value="">{t('record.allMethods')}</option>
                              {refundableDistinctMethods.map((m) => (
                                <option key={m} value={m}>{methodLabel(m)}</option>
                              ))}
                            </select>
                            {(refundableFilters.date_from || refundableFilters.date_to || refundableFilters.payment_method) && (
                              <button type="button" style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 8px', fontSize: 'var(--font-size-xs)', cursor: 'pointer', color: 'var(--color-text-secondary)' }}
                                onClick={() => setRefundableFilters({ date_from: '', date_to: '', payment_method: '' })}>{t('common:dateRange.clear')}</button>
                            )}
                          </div>

                          {refundableCharges.length === 0 && <small style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>{t('record.noRefundable')}</small>}
                          {refundableCharges.length > 0 && (
                            <>
                              <small style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
                                {t('record.showing', { from: refundablePage + 1, to: Math.min(refundablePage + REFUNDABLE_LIMIT, refundableTotal), count: refundableTotal })}
                              </small>
                              <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                                {refundableCharges.map((tx: any) => (
                                  <button key={tx.id} type="button" onClick={() => selectRefundSource(tx)}
                                    style={{ display: 'block', width: '100%', padding: '6px 10px', border: 'none', borderBottom: '1px solid var(--color-border)', background: 'var(--color-background)', cursor: 'pointer', textAlign: 'left', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
                                    <Trans t={t} i18nKey="record.listLine" values={{ amount: formatCurrency(tx.amount), remaining: formatCurrency(tx.remaining), date: formatDate(tx.created_at), method: methodLabel(tx.payment_method) }} components={[<strong key="s" />]} />
                                  </button>
                                ))}
                              </div>
                              {/* Pagination controls */}
                              {refundableTotal > REFUNDABLE_LIMIT && (
                                <div style={{ display: 'flex', gap: '8px', marginTop: '6px', justifyContent: 'center' }}>
                                  <button type="button" disabled={refundablePage === 0}
                                    style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '3px 10px', fontSize: 'var(--font-size-sm)', cursor: refundablePage === 0 ? 'default' : 'pointer', opacity: refundablePage === 0 ? 0.4 : 1 }}
                                    onClick={() => fetchRefundable(refundablePage - REFUNDABLE_LIMIT)}>{t('record.previous')}</button>
                                  <button type="button" disabled={refundablePage + REFUNDABLE_LIMIT >= refundableTotal}
                                    style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '3px 10px', fontSize: 'var(--font-size-sm)', cursor: refundablePage + REFUNDABLE_LIMIT >= refundableTotal ? 'default' : 'pointer', opacity: refundablePage + REFUNDABLE_LIMIT >= refundableTotal ? 0.4 : 1 }}
                                    onClick={() => fetchRefundable(refundablePage + REFUNDABLE_LIMIT)}>{t('common:next')}</button>
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
                  <label style={styles.label}>{t('record.refundReason')}</label>
                  <input style={styles.input} value={recordForm.refund_reason} onChange={(e) => setRecordForm({ ...recordForm, refund_reason: e.target.value })} placeholder={t('record.refundReasonPlaceholder')} />
                </div>
              </>
            )}
            <div style={styles.field}>
              <label style={styles.label}>{t('record.reference')}</label>
              <input style={styles.input} value={recordForm.reference_number} onChange={(e) => setRecordForm({ ...recordForm, reference_number: e.target.value })} placeholder={t('record.optional')} />
            </div>
            <div style={{ ...styles.field, gridColumn: '1 / -1' }}>
              <label style={styles.label}>{t('record.description')}</label>
              <input style={styles.input} value={recordForm.description} onChange={(e) => setRecordForm({ ...recordForm, description: e.target.value })} placeholder={t('record.optionalNote')} />
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button variant="secondary" type="button" onClick={() => setShowRecord(false)}>{t('common:cancel')}</Button>
              <Button type="submit" loading={recording}>{t('record.submit')}</Button>
            </div>
          </form>
          </div>
        </div>
      )}

      {/* Transactions table */}
      <Table columns={columns} data={transactions} loading={loading} emptyMessage={t('empty')} onRowClick={openDetail}
        filters={tableFilters} onFiltersChange={setTableFilters} filterOptions={filterOptions}
        onLoadMore={loadMore} hasMore={transactions.length < total} loadingMore={loadingMore} />

      {/* Detail modal */}
      {detailTransaction && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', color: 'var(--color-text)' }}>{t('detail.title')}</h3>
              <button style={{ background: 'none', border: 'none', fontSize: 'var(--font-size-xl)', cursor: 'pointer', color: 'var(--color-text-secondary)' }} onClick={() => setDetailTransaction(null)}>Ã—</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: 'var(--font-size-base)' }}>
              <div><strong>{t('detail.type')}</strong> <Badge variant={TYPE_VARIANTS[detailTransaction.type] || 'neutral'}>{typeLabel(detailTransaction.type)}</Badge></div>
              <div><strong>{t('detail.status')}</strong> {statusLabel(detailTransaction.status)}</div>
              <div><strong>{t('detail.amount')}</strong> {formatCurrency(detailTransaction.amount, detailTransaction.currency)}</div>
              <div><strong>{t('detail.method')}</strong> {methodLabel(detailTransaction.payment_method)}</div>
              <div><strong>{t('detail.customer')}</strong> {detailTransaction.customer_first_name} {detailTransaction.customer_last_name}</div>
              <div><strong>{t('detail.email')}</strong> {detailTransaction.customer_email}</div>
              <div><strong>{t('detail.date')}</strong> {formatDateTime(detailTransaction.created_at)}</div>
              <div><strong>{t('detail.processedBy')}</strong> {detailTransaction.processed_by_first_name ? `${detailTransaction.processed_by_first_name} ${detailTransaction.processed_by_last_name}` : 'â€”'}</div>
              {detailTransaction.reference_number && <div><strong>{t('detail.reference')}</strong> {detailTransaction.reference_number}</div>}
              {detailTransaction.description && <div style={{ gridColumn: '1 / -1' }}><strong>{t('detail.description')}</strong> {detailTransaction.description}</div>}
              {detailTransaction.refund_reason && <div style={{ gridColumn: '1 / -1' }}><strong>{t('detail.refundReason')}</strong> {detailTransaction.refund_reason}</div>}
              {detailTransaction.card_last4 && <div><strong>{t('detail.card')}</strong> {detailTransaction.card_brand ? `${detailTransaction.card_brand} ` : ''}â€¢â€¢â€¢â€¢ {detailTransaction.card_last4}</div>}
              {detailTransaction.bank_routing_number && <div><strong>{t('detail.routing')}</strong> {detailTransaction.bank_routing_number}</div>}
              {detailTransaction.bank_account_number && <div><strong>{t('detail.account')}</strong> {detailTransaction.bank_account_number}</div>}
              {detailTransaction.check_number && <div><strong>{t('detail.check')}</strong> {detailTransaction.check_number}</div>}
              {detailTransaction.gift_card_code && <div><strong>{t('detail.giftCard')}</strong> {detailTransaction.gift_card_code}</div>}
              {detailTransaction.booking_id && <div><strong>{t('detail.booking')}</strong> {detailTransaction.booking_id.slice(0, 8)}...</div>}
              {detailTransaction.membership_id && <div><strong>{t('detail.membership')}</strong> {detailTransaction.membership_id.slice(0, 8)}...</div>}
            </div>
            {/* A receipt for any payment taken, at any time (spec 51, gap 5) */}
            {detailTransaction.type === 'charge' && ['completed', 'pending', 'partially_refunded', 'refunded'].includes(detailTransaction.status) && (
              <div style={{ marginTop: 'var(--space-md)' }}>
                <ReceiptActions kind="transaction" id={detailTransaction.id} businessId={businessId} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', margin: 0 },
  summaryRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' },
  summaryCard: { padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  summaryLabel: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  summaryValue: { fontSize: 'var(--font-size-xl)', fontWeight: 600, color: 'var(--color-text)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)' },
  input: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 'var(--font-size-base)', width: '100%', boxSizing: 'border-box' as const, fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)' },
  error: { color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: '0 0 8px 0' },
  toolbar: { display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' as const, alignItems: 'center' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  clearBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--button-radius)', padding: '8px 12px', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', minHeight: 'var(--button-height-sm)' },
  overlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '500px', maxHeight: '80vh', overflow: 'auto', border: '1px solid var(--color-border)', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' },
  recordModal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '600px', maxHeight: '85vh', overflow: 'auto', border: '1px solid var(--color-border)', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' },
};
