import { askConfirm, showMessage } from '../design-system/components/feedback/dialogs';
import { useState, useEffect } from 'react';
import { formatNumber } from '../utils/format';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../api/client';
import { runPayroll, finalizePayroll, getPayrollEntries } from '../api/payroll';
import { Button } from '../design-system/components/actions/Button';
import { Table, applyTableFilters } from '../design-system/components/data/Table';
import type { TableFilters } from '../design-system/components/data/Table';
import { formatCurrency } from '../utils/currency';
import { useDraft, fieldMark, checkMark, draftBox } from '../components/unsaved/DraftSections';
import { formatDateOnly } from '../utils/date';
import { TipPoolPanel } from './TipPoolPanel';

interface PayPeriod {
  id: string;
  period_start: string;
  period_end: string;
  status: 'open' | 'processing' | 'finalized';
}

interface PayrollEntry {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  hours_worked: number;
  sessions_delivered: number;
  gross_pay: number;
  total_deductions: number;
  net_pay: number;
  status: string;
  breakdown: any;
}

export function PayrollTab() {
  const { t } = useTranslation('staff');
  const businessId = localStorage.getItem('business_id') || '';
  const [activeView, setActiveView] = useState<'current' | 'history' | 'tip-pool'>('current');

  // Current/Unprocessed
  const [unprocessedPeriods, setUnprocessedPeriods] = useState<PayPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  // History
  const [historyPeriods, setHistoryPeriods] = useState<PayPeriod[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>('');
  const [historyEntries, setHistoryEntries] = useState<PayrollEntry[]>([]);
  const [historyEntriesLoading, setHistoryEntriesLoading] = useState(false);

  // Tax profiles
  const [taxSectionOpen, setTaxSectionOpen] = useState(false);
  const [taxProfiles, setTaxProfiles] = useState<any[]>([]);
  const [taxProfilesLoading, setTaxProfilesLoading] = useState(false);
  const [editingTaxUserId, setEditingTaxUserId] = useState<string | null>(null);
  // The tax profile being edited: its own Save stores it, or Accounting's Save changes with the rest (decision 8).
  const EMPTY_TAX = { user_id: '', country_code: 'US', state_code: '', filing_status: 'single', allowances: 0, additional_withholding: 0, exempt: false };
  const taxDraft = useDraft('payroll-tax-profile', t('payrollTab.draftTaxProfile'), EMPTY_TAX, async ({ user_id, ...form }) => {
    await apiClient.put(`/v1/payroll/tax-profiles/${user_id}`, { business_id: businessId, ...form });
    setEditingTaxUserId(null);
    await loadTaxProfiles();
    return EMPTY_TAX;
  });
  const taxEditForm = taxDraft.value;
  const setTaxEditForm = taxDraft.setValue;
  const markTax = (k: keyof typeof EMPTY_TAX) => fieldMark(taxDraft.changed((v) => v[k]));
  const [taxError, setTaxError] = useState('');

  // Load unprocessed periods
  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    loadUnprocessed();
  }, [businessId]);

  const loadUnprocessed = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`/v1/payroll/periods/unprocessed?business_id=${businessId}`);
      const periods = res.data.data || [];
      setUnprocessedPeriods(periods);
      if (periods.length > 0 && !selectedPeriodId) setSelectedPeriodId(periods[0].id);
    } catch { setUnprocessedPeriods([]); }
    finally { setLoading(false); }
  };

  // Load entries when period selected
  useEffect(() => {
    if (!selectedPeriodId) { setEntries([]); return; }
    loadEntries(selectedPeriodId);
  }, [selectedPeriodId]);

  const loadEntries = async (periodId: string) => {
    setEntriesLoading(true);
    try {
      const data = await getPayrollEntries(periodId, businessId);
      setEntries(data || []);
    } catch { setEntries([]); }
    finally { setEntriesLoading(false); }
  };

  const handleRunPayroll = async () => {
    if (!selectedPeriodId) return;
    setRunning(true);
    try {
      await runPayroll(selectedPeriodId, businessId);
      await loadEntries(selectedPeriodId);
      await loadUnprocessed();
    } catch (err: any) { void showMessage({ message: err?.response?.data?.error || t('payrollTab.errRun'), tone: 'error' }); }
    finally { setRunning(false); }
  };

  const handleFinalize = async () => {
    if (!selectedPeriodId) return;
    if (!(await askConfirm({ message: t('payrollTab.confirmFinalize'), confirmLabel: t('common:action.continue') }))) return;
    try {
      await finalizePayroll(selectedPeriodId, businessId);
      await loadUnprocessed();
      setSelectedPeriodId(unprocessedPeriods.length > 1 ? unprocessedPeriods[0].id : '');
      setEntries([]);
    } catch (err: any) { void showMessage({ message: err?.response?.data?.error || t('payrollTab.errFinalize'), tone: 'error' }); }
  };

  // History
  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await apiClient.get(`/v1/payroll/periods/history?business_id=${businessId}`);
      setHistoryPeriods(res.data.data || []);
    } catch { setHistoryPeriods([]); }
    finally { setHistoryLoading(false); }
  };

  useEffect(() => {
    if (activeView === 'history' && historyPeriods.length === 0) loadHistory();
  }, [activeView]);

  useEffect(() => {
    if (!selectedHistoryId) { setHistoryEntries([]); return; }
    setHistoryEntriesLoading(true);
    getPayrollEntries(selectedHistoryId, businessId).then(setHistoryEntries).catch(() => setHistoryEntries([])).finally(() => setHistoryEntriesLoading(false));
  }, [selectedHistoryId]);

  // Tax profiles
  const loadTaxProfiles = async () => {
    setTaxProfilesLoading(true);
    try {
      const res = await apiClient.get(`/v1/payroll/tax-profiles?business_id=${businessId}`);
      setTaxProfiles(res.data.data || []);
    } catch { setTaxProfiles([]); }
    finally { setTaxProfilesLoading(false); }
  };

  const handleSaveTaxProfile = async () => {
    if (!editingTaxUserId) return;
    setTaxError('');
    try { await taxDraft.save(); } catch (err: any) { setTaxError(err?.response?.data?.error || t('payrollTab.errTaxProfile')); }
  };

  const selectedPeriod = unprocessedPeriods.find(p => p.id === selectedPeriodId);

  return (
    <div>
      {/* View Toggle */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button onClick={() => { setActiveView('current'); setTaxSectionOpen(false); }} style={{ ...styles.viewBtn, ...(activeView === 'current' && !taxSectionOpen ? styles.viewBtnActive : {}) }}>{t('payrollTab.current')}</button>
        <button onClick={() => { setActiveView('history'); setTaxSectionOpen(false); }} style={{ ...styles.viewBtn, ...(activeView === 'history' && !taxSectionOpen ? styles.viewBtnActive : {}) }}>{t('payrollTab.history')}</button>
        <button onClick={() => { setActiveView('tip-pool'); setTaxSectionOpen(false); }} style={{ ...styles.viewBtn, ...(activeView === 'tip-pool' && !taxSectionOpen ? styles.viewBtnActive : {}) }}>{t('payrollTab.tipPool')}</button>
        <button onClick={() => { setTaxSectionOpen(!taxSectionOpen); if (!taxSectionOpen && taxProfiles.length === 0) loadTaxProfiles(); }} style={{ ...styles.viewBtn, ...(taxSectionOpen ? styles.viewBtnActive : {}) }}>{t('payrollTab.taxProfiles')}</button>
      </div>

      {/* Current/Unprocessed View */}
      {activeView === 'current' && !taxSectionOpen && (
        <div>
          {loading ? <p style={styles.muted}>{t('common:loading')}</p> : unprocessedPeriods.length === 0 ? (
            <p style={styles.muted}>{t('payrollTab.noOutstanding')}</p>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
                <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('payrollTab.period')}</label>
                <select value={selectedPeriodId} onChange={(e) => setSelectedPeriodId(e.target.value)} style={styles.select}>
                  {unprocessedPeriods.map(p => (
                    <option key={p.id} value={p.id}>
                      {formatDateOnly(p.period_start)} — {formatDateOnly(p.period_end)} ({t(`payrollTab.status_${p.status}`, { defaultValue: p.status })})
                    </option>
                  ))}
                </select>
                {selectedPeriod?.status === 'open' && (
                  <Button size="sm" onClick={handleRunPayroll} loading={running}>{t('payrollTab.runPayroll')}</Button>
                )}
                {selectedPeriod?.status === 'processing' && (
                  <Button size="sm" onClick={handleFinalize}>{t('payrollTab.finalize')}</Button>
                )}
              </div>

              {entriesLoading ? <p style={styles.muted}>{t('payrollTab.loadingEntries')}</p> : entries.length === 0 ? (
                <p style={styles.muted}>{t('payrollTab.noEntriesYet')}</p>
              ) : (
                <EntriesTable entries={entries} expandedId={expandedEntryId} onToggle={setExpandedEntryId} />
              )}
            </div>
          )}
        </div>
      )}

      {/* History View */}
      {activeView === 'history' && !taxSectionOpen && (
        <div>
          {historyLoading ? <p style={styles.muted}>{t('payrollTab.loadingHistory')}</p> : historyPeriods.length === 0 ? (
            <p style={styles.muted}>{t('payrollTab.noFinalized')}</p>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
                <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('payrollTab.period')}</label>
                <select value={selectedHistoryId} onChange={(e) => setSelectedHistoryId(e.target.value)} style={styles.select}>
                  <option value="">{t('payrollTab.selectPeriod')}</option>
                  {historyPeriods.map(p => (
                    <option key={p.id} value={p.id}>
                      {formatDateOnly(p.period_start)} — {formatDateOnly(p.period_end)}
                    </option>
                  ))}
                </select>
              </div>
              {historyEntriesLoading ? <p style={styles.muted}>{t('common:loading')}</p> : historyEntries.length > 0 && (
                <EntriesTable entries={historyEntries} expandedId={expandedEntryId} onToggle={setExpandedEntryId} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Tip pool: tips with no staff member on the order, shared out here (spec 51, gap 14) */}
      {activeView === 'tip-pool' && !taxSectionOpen && <TipPoolPanel businessId={businessId} />}

      {/* Tax Profiles View */}
      {taxSectionOpen && (
        <div>
          {taxProfilesLoading ? <p style={styles.muted}>{t('common:loading')}</p> : taxProfiles.length === 0 ? (
            <p style={styles.muted}>{t('payrollTab.noStaff')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {taxProfiles.map((profile: any) => (
                <div key={profile.user_id} style={{ ...styles.taxCard, ...(editingTaxUserId === profile.user_id ? draftBox(taxDraft.dirty) : {}) }}>
                  {editingTaxUserId === profile.user_id ? (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                      <div><label style={styles.label}>{t('payrollTab.country')}</label><select style={{ ...styles.input, ...markTax('country_code') }} value={taxEditForm.country_code} onChange={(e) => setTaxEditForm({ ...taxEditForm, country_code: e.target.value })}><option value="US">{t('payrollTab.countryUS')}</option><option value="ES">{t('payrollTab.countryES')}</option></select></div>
                      <div><label style={styles.label}>{t('payrollTab.state')}</label><input style={{ ...styles.input, ...markTax('state_code') }} value={taxEditForm.state_code} onChange={(e) => setTaxEditForm({ ...taxEditForm, state_code: e.target.value })} /></div>
                      <div><label style={styles.label}>{t('payrollTab.filingStatus')}</label><select style={{ ...styles.input, ...markTax('filing_status') }} value={taxEditForm.filing_status} onChange={(e) => setTaxEditForm({ ...taxEditForm, filing_status: e.target.value })}><option value="single">{t('payrollTab.filing.single')}</option><option value="married">{t('payrollTab.filing.married')}</option><option value="head_of_household">{t('payrollTab.filing.head_of_household')}</option></select></div>
                      <div><label style={styles.label}>{t('payrollTab.allowances')}</label><input style={{ ...styles.input, ...markTax('allowances') }} type="number" min="0" value={taxEditForm.allowances} onChange={(e) => setTaxEditForm({ ...taxEditForm, allowances: parseInt(e.target.value) || 0 })} /></div>
                      <div><label style={styles.label}>{t('payrollTab.exempt')}</label><input type="checkbox" style={checkMark(taxDraft.changed((v) => v.exempt))} checked={taxEditForm.exempt} onChange={(e) => setTaxEditForm({ ...taxEditForm, exempt: e.target.checked })} /></div>
                      <Button size="sm" onClick={handleSaveTaxProfile}>{t('common:save')}</Button>
                      <button style={styles.linkBtn} onClick={() => { setEditingTaxUserId(null); taxDraft.load(EMPTY_TAX); setTaxError(''); }}>{t('common:cancel')}</button>
                      {taxError && <span role="alert" style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}>{taxError}</span>}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)' }}>{profile.first_name} {profile.last_name}</span>
                        <span style={{ marginLeft: '12px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                          {profile.country_code || '—'} · {profile.filing_status ? t(`payrollTab.filingShown.${profile.filing_status}`, { defaultValue: profile.filing_status }) : t('payrollTab.notSet')} · {t('payrollTab.allowancesCount', { count: profile.allowances ?? 0 })}
                          {profile.exempt && ` · ${t('payrollTab.exempt')}`}
                        </span>
                      </div>
                      <button style={styles.linkBtn} onClick={() => { setEditingTaxUserId(profile.user_id); taxDraft.load({ user_id: profile.user_id, country_code: profile.country_code || 'US', state_code: profile.state_code || '', filing_status: profile.filing_status || 'single', allowances: profile.allowances || 0, additional_withholding: profile.additional_withholding || 0, exempt: profile.exempt || false }); }}>{t('common:edit')}</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Payroll entries on the shared table (David, 2026-11-02, decision 1): sort and filter on every
// column (amounts with the slider); a row opens its breakdown; totals are for the rows shown.
const ENTRY_FILTER_COLUMNS = [
  { key: 'employee', kind: 'values' as const, value: (e: PayrollEntry) => `${e.first_name} ${e.last_name}` },
  { key: 'hours_worked', kind: 'number' as const, value: (e: PayrollEntry) => e.hours_worked },
  { key: 'sessions_delivered', kind: 'number' as const, value: (e: PayrollEntry) => e.sessions_delivered },
  { key: 'gross_pay', kind: 'amount' as const, value: (e: PayrollEntry) => e.gross_pay },
  { key: 'total_deductions', kind: 'amount' as const, value: (e: PayrollEntry) => e.total_deductions },
  { key: 'net_pay', kind: 'amount' as const, value: (e: PayrollEntry) => e.net_pay },
];

function EntriesTable({ entries, expandedId, onToggle }: { entries: PayrollEntry[]; expandedId: string | null; onToggle: (id: string | null) => void }) {
  const { t } = useTranslation('staff');
  const [filters, setFilters] = useState<TableFilters>({});
  const shown = applyTableFilters(entries, ENTRY_FILTER_COLUMNS, filters);
  const totals = shown.reduce((acc, e) => ({ gross: acc.gross + e.gross_pay, deductions: acc.deductions + e.total_deductions, net: acc.net + e.net_pay }), { gross: 0, deductions: 0, net: 0 });
  const right = 'right' as const;

  return (
    <Table
      data={shown}
      filterSource={entries}
      filters={filters}
      onFiltersChange={setFilters}
      rowId={(e) => e.id}
      clientSort
      onRowClick={(e) => onToggle(expandedId === e.id ? null : e.id)}
      expandedRowId={expandedId}
      renderExpanded={(entry) => entry.breakdown ? (
        <div style={{ display: 'flex', gap: '24px', fontSize: 'var(--font-size-sm)' }}>
          <div>
            <strong>{t('payrollTab.compensation')}</strong>
            {(entry.breakdown.compensation || []).map((c: any, i: number) => (
              <div key={i}>{c.type === 'tips' ? t('payrollTab.tipsElectronic') : c.type}: {formatCurrency(c.amount)}{c.hours ? ` (${t('payrollTab.hoursShort', { n: formatNumber(Number(c.hours)) })})` : ''}{c.sessions ? ` (${t('payrollTab.sessionsCount', { count: Number(c.sessions) })})` : ''}</div>
            ))}
          </div>
          <div>
            <strong>{t('payrollTab.deductions')}</strong>
            {(entry.breakdown.deductions || []).map((d: any, i: number) => (
              <div key={i}>{d.name}: {formatCurrency(d.amount)}</div>
            ))}
          </div>
        </div>
      ) : <span style={styles.muted}>{t('payrollTab.noBreakdown')}</span>}
      columns={[
        { key: 'employee', header: t('payrollTab.employee'), sortable: true, filterValue: (e) => `${e.first_name} ${e.last_name}`, render: (_: any, e: PayrollEntry) => `${e.first_name} ${e.last_name}` },
        { key: 'hours_worked', header: t('payrollTab.hours'), sortable: true, align: right, filter: 'number', filterUnit: 'h', render: (v: number | null) => <div style={{ textAlign: 'right' }}>{v ?? '—'}</div> },
        { key: 'sessions_delivered', header: t('payrollTab.sessions'), sortable: true, align: right, filter: 'number', render: (v: number | null) => <div style={{ textAlign: 'right' }}>{v ?? '—'}</div> },
        { key: 'gross_pay', header: t('payrollTab.grossPay'), sortable: true, align: right, filter: 'amount', render: (v: number) => <div style={{ textAlign: 'right' }}>{formatCurrency(v)}</div> },
        { key: 'total_deductions', header: t('payrollTab.deductions'), sortable: true, align: right, filter: 'amount', render: (v: number) => <div style={{ textAlign: 'right' }}>{formatCurrency(v)}</div> },
        { key: 'net_pay', header: t('payrollTab.netPay'), sortable: true, align: right, filter: 'amount', render: (v: number) => <div style={{ textAlign: 'right' }}><strong>{formatCurrency(v)}</strong></div> },
      ]}
      footerRows={[{
        strong: true,
        cells: [
          { content: shown.length === entries.length ? t('payrollTab.totals') : t('payrollTab.totalsShown', { shown: shown.length, total: entries.length }) },
          { content: '' }, { content: '' },
          { content: formatCurrency(totals.gross), align: right },
          { content: formatCurrency(totals.deductions), align: right },
          { content: formatCurrency(totals.net), align: right },
        ],
      }]}
    />
  );
}

const styles: Record<string, React.CSSProperties> = {
  muted: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  select: { padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', background: 'var(--color-background)' },
  viewBtn: { padding: '6px 14px', fontSize: 'var(--font-size-sm)', border: '1px solid var(--color-border)', borderRadius: 'var(--button-radius)', background: 'transparent', color: 'var(--color-text)', cursor: 'pointer', minHeight: 'var(--button-height-sm)' },
  viewBtnActive: { background: 'var(--color-primary)', color: 'var(--color-primary-contrast, #fff)', borderColor: 'var(--color-primary)', borderRadius: 'var(--button-radius)', minHeight: 'var(--button-height-sm)' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 'var(--font-size-sm)' },
  th: { textAlign: 'left' as const, padding: '8px 12px', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '2px solid var(--color-border)' },
  td: { padding: '8px 12px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' },
  taxCard: { padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: '6px' },
  label: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '2px' },
  input: { padding: '4px 8px', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: 'var(--font-size-sm)' },
  linkBtn: { background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)' },
};
