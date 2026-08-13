import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import {
  getPayPeriods,
  openPayPeriod,
  runPayroll,
  finalizePayroll,
  getPayrollEntries,
} from '../api/payroll';
import { Button } from '../design-system/components/actions/Button';
import { formatCurrency } from '../utils/currency';

interface PayPeriod {
  id: string;
  business_id: string;
  period_start: string;
  period_end: string;
  status: 'open' | 'processing' | 'finalized';
  created_at: string;
}

interface PayrollEntry {
  id: string;
  period_id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  hours_worked: number;
  sessions_delivered: number;
  gross_pay: number;
  total_deductions: number;
  net_pay: number;
  status: string;
  compensation_breakdown: Record<string, number>;
  deduction_breakdown: Record<string, number>;
}

interface TaxProfile {
  user_id: string;
  first_name: string;
  last_name: string;
  country_code: string;
  state_code: string;
  filing_status: string;
  allowances: number;
  additional_withholding: number;
  exempt: boolean;
}

export function PayrollTab() {
  const businessId = localStorage.getItem('business_id') || '';

  const [periods, setPeriods] = useState<PayPeriod[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(true);
  const [expandedPeriodId, setExpandedPeriodId] = useState<string | null>(null);
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  const [showNewPeriodForm, setShowNewPeriodForm] = useState(false);
  const [newPeriodStart, setNewPeriodStart] = useState('');
  const [newPeriodEnd, setNewPeriodEnd] = useState('');
  const [creatingPeriod, setCreatingPeriod] = useState(false);

  const [taxProfiles, setTaxProfiles] = useState<TaxProfile[]>([]);
  const [taxProfilesLoading, setTaxProfilesLoading] = useState(false);
  const [taxSectionOpen, setTaxSectionOpen] = useState(false);
  const [editingTaxUserId, setEditingTaxUserId] = useState<string | null>(null);
  const [taxEditForm, setTaxEditForm] = useState({
    country_code: 'US',
    state_code: '',
    filing_status: 'single',
    allowances: 0,
    additional_withholding: 0,
    exempt: false,
  });

  // Load pay periods
  useEffect(() => {
    if (!businessId) {
      setPeriodsLoading(false);
      return;
    }
    loadPeriods();
  }, [businessId]);

  const loadPeriods = async () => {
    setPeriodsLoading(true);
    try {
      const data = await getPayPeriods(businessId);
      setPeriods(data);
    } catch {
      setPeriods([]);
    } finally {
      setPeriodsLoading(false);
    }
  };

  // Load entries for expanded period
  const handleExpandPeriod = async (periodId: string) => {
    if (expandedPeriodId === periodId) {
      setExpandedPeriodId(null);
      setEntries([]);
      return;
    }
    setExpandedPeriodId(periodId);
    setExpandedEntryId(null);
    setEntriesLoading(true);
    try {
      const data = await getPayrollEntries(periodId);
      setEntries(data);
    } catch {
      setEntries([]);
    } finally {
      setEntriesLoading(false);
    }
  };

  // Create new pay period
  const handleCreatePeriod = async () => {
    if (!newPeriodStart || !newPeriodEnd) return;
    setCreatingPeriod(true);
    try {
      await openPayPeriod({
        business_id: businessId,
        period_start: newPeriodStart,
        period_end: newPeriodEnd,
      });
      setShowNewPeriodForm(false);
      setNewPeriodStart('');
      setNewPeriodEnd('');
      await loadPeriods();
    } finally {
      setCreatingPeriod(false);
    }
  };

  // Run payroll for a period
  const handleRunPayroll = async (periodId: string) => {
    await runPayroll(periodId, businessId);
    await loadPeriods();
    if (expandedPeriodId === periodId) {
      const data = await getPayrollEntries(periodId);
      setEntries(data);
    }
  };

  // Finalize a period
  const handleFinalizePayroll = async (periodId: string) => {
    await finalizePayroll(periodId, businessId);
    await loadPeriods();
  };

  // Tax profiles
  const loadTaxProfiles = async () => {
    setTaxProfilesLoading(true);
    try {
      const res = await apiClient.get(`/v1/payroll/tax-profiles?business_id=${businessId}`);
      setTaxProfiles(res.data.data || []);
    } catch {
      setTaxProfiles([]);
    } finally {
      setTaxProfilesLoading(false);
    }
  };

  const handleToggleTaxSection = () => {
    const next = !taxSectionOpen;
    setTaxSectionOpen(next);
    if (next && taxProfiles.length === 0) {
      loadTaxProfiles();
    }
  };

  const handleEditTaxProfile = (profile: TaxProfile) => {
    setEditingTaxUserId(profile.user_id);
    setTaxEditForm({
      country_code: profile.country_code || 'US',
      state_code: profile.state_code || '',
      filing_status: profile.filing_status || 'single',
      allowances: profile.allowances || 0,
      additional_withholding: profile.additional_withholding || 0,
      exempt: profile.exempt || false,
    });
  };

  const handleSaveTaxProfile = async () => {
    if (!editingTaxUserId) return;
    try {
      await apiClient.put(`/v1/payroll/tax-profiles/${editingTaxUserId}`, {
        business_id: businessId,
        ...taxEditForm,
      });
      setEditingTaxUserId(null);
      await loadTaxProfiles();
    } catch {
      // handle error silently
    }
  };

  const getStatusBadgeStyle = (status: string): React.CSSProperties => {
    if (status === 'finalized') return { ...styles.badge, background: 'var(--color-success, #22c55e)', color: '#fff' };
    if (status === 'processing') return { ...styles.badge, background: 'var(--color-primary, #3b82f6)', color: '#fff' };
    return { ...styles.badge, background: 'var(--color-border, #e5e7eb)', color: 'var(--color-text, #111827)' };
  };

  return (
    <div style={styles.container}>
      {/* Pay Periods Section */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>Pay Periods</h2>
          <Button size="sm" onClick={() => setShowNewPeriodForm(!showNewPeriodForm)}>
            New Period
          </Button>
        </div>

        {showNewPeriodForm && (
          <div style={styles.inlineForm}>
            <div style={styles.formRow}>
              <div style={styles.formField}>
                <label style={styles.label}>Period Start</label>
                <input
                  type="date"
                  style={styles.input}
                  value={newPeriodStart}
                  onChange={(e) => setNewPeriodStart(e.target.value)}
                />
              </div>
              <div style={styles.formField}>
                <label style={styles.label}>Period End</label>
                <input
                  type="date"
                  style={styles.input}
                  value={newPeriodEnd}
                  onChange={(e) => setNewPeriodEnd(e.target.value)}
                />
              </div>
              <div style={styles.formActions}>
                <Button size="sm" onClick={handleCreatePeriod} loading={creatingPeriod}>
                  Create
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowNewPeriodForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        {periodsLoading ? (
          <p style={styles.loadingText}>Loading pay periods...</p>
        ) : periods.length === 0 ? (
          <p style={styles.emptyText}>No pay periods found.</p>
        ) : (
          <div style={styles.periodsList}>
            {periods.map((period) => (
              <div key={period.id}>
                <div
                  style={{
                    ...styles.periodRow,
                    background: expandedPeriodId === period.id
                      ? 'var(--color-background, #f9fafb)'
                      : 'transparent',
                  }}
                  onClick={() => handleExpandPeriod(period.id)}
                >
                  <div style={styles.periodInfo}>
                    <span style={styles.periodDates}>
                      {new Date(period.period_start).toLocaleDateString()} — {new Date(period.period_end).toLocaleDateString()}
                    </span>
                    <span style={getStatusBadgeStyle(period.status)}>{period.status}</span>
                  </div>
                  <div style={styles.periodActions}>
                    {period.status === 'open' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => { e.stopPropagation(); handleRunPayroll(period.id); }}
                      >
                        Run Payroll
                      </Button>
                    )}
                    {period.status === 'processing' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => { e.stopPropagation(); handleFinalizePayroll(period.id); }}
                      >
                        Finalize
                      </Button>
                    )}
                  </div>
                </div>

                {/* Expanded entries */}
                {expandedPeriodId === period.id && (
                  <div style={styles.entriesContainer}>
                    {entriesLoading ? (
                      <p style={styles.loadingText}>Loading entries...</p>
                    ) : entries.length === 0 ? (
                      <p style={styles.emptyText}>No payroll entries for this period.</p>
                    ) : (
                      <table style={styles.table}>
                        <thead>
                          <tr>
                            <th style={styles.th}>Name</th>
                            <th style={styles.th}>Hours Worked</th>
                            <th style={styles.th}>Sessions</th>
                            <th style={styles.th}>Gross Pay</th>
                            <th style={styles.th}>Deductions</th>
                            <th style={styles.th}>Net Pay</th>
                            <th style={styles.th}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entries.map((entry, idx) => (
                            <>
                              <tr
                                key={entry.id}
                                style={{
                                  ...styles.tr,
                                  background: idx % 2 === 0
                                    ? 'transparent'
                                    : 'var(--color-background, #f9fafb)',
                                  cursor: 'pointer',
                                }}
                                onClick={() =>
                                  setExpandedEntryId(expandedEntryId === entry.id ? null : entry.id)
                                }
                              >
                                <td style={styles.td}>{entry.first_name} {entry.last_name}</td>
                                <td style={styles.td}>{entry.hours_worked ?? '—'}</td>
                                <td style={styles.td}>{entry.sessions_delivered ?? '—'}</td>
                                <td style={styles.td}>{formatCurrency(entry.gross_pay)}</td>
                                <td style={styles.td}>{formatCurrency(entry.total_deductions)}</td>
                                <td style={styles.td}>{formatCurrency(entry.net_pay)}</td>
                                <td style={styles.td}>
                                  <span style={getStatusBadgeStyle(entry.status)}>{entry.status}</span>
                                </td>
                              </tr>
                              {expandedEntryId === entry.id && (
                                <tr key={`${entry.id}-breakdown`}>
                                  <td colSpan={7} style={styles.breakdownCell}>
                                    <div style={styles.breakdownContainer}>
                                      <div style={styles.breakdownSection}>
                                        <strong style={styles.breakdownTitle}>Compensation Breakdown</strong>
                                        {entry.compensation_breakdown &&
                                        Object.keys(entry.compensation_breakdown).length > 0 ? (
                                          <ul style={styles.breakdownList}>
                                            {Object.entries(entry.compensation_breakdown).map(([key, val]) => (
                                              <li key={key} style={styles.breakdownItem}>
                                                <span>{key}</span>
                                                <span>{formatCurrency(val)}</span>
                                              </li>
                                            ))}
                                          </ul>
                                        ) : (
                                          <p style={styles.emptyText}>No breakdown available</p>
                                        )}
                                      </div>
                                      <div style={styles.breakdownSection}>
                                        <strong style={styles.breakdownTitle}>Deduction Breakdown</strong>
                                        {entry.deduction_breakdown &&
                                        Object.keys(entry.deduction_breakdown).length > 0 ? (
                                          <ul style={styles.breakdownList}>
                                            {Object.entries(entry.deduction_breakdown).map(([key, val]) => (
                                              <li key={key} style={styles.breakdownItem}>
                                                <span>{key}</span>
                                                <span>{formatCurrency(val)}</span>
                                              </li>
                                            ))}
                                          </ul>
                                        ) : (
                                          <p style={styles.emptyText}>No breakdown available</p>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Employee Tax Profiles Section (Collapsible) */}
      <div style={styles.section}>
        <div
          style={{ ...styles.sectionHeader, cursor: 'pointer' }}
          onClick={handleToggleTaxSection}
        >
          <h2 style={styles.sectionTitle}>
            {taxSectionOpen ? '▾' : '▸'} Employee Tax Profiles
          </h2>
        </div>

        {taxSectionOpen && (
          <div style={styles.taxContainer}>
            {taxProfilesLoading ? (
              <p style={styles.loadingText}>Loading tax profiles...</p>
            ) : taxProfiles.length === 0 ? (
              <p style={styles.emptyText}>No tax profiles found.</p>
            ) : (
              <div style={styles.taxList}>
                {taxProfiles.map((profile) => (
                  <div key={profile.user_id} style={styles.taxCard}>
                    {editingTaxUserId === profile.user_id ? (
                      <div style={styles.taxEditForm}>
                        <div style={styles.taxEditGrid}>
                          <div style={styles.formField}>
                            <label style={styles.label}>Country</label>
                            <select
                              style={styles.input}
                              value={taxEditForm.country_code}
                              onChange={(e) =>
                                setTaxEditForm({ ...taxEditForm, country_code: e.target.value })
                              }
                            >
                              <option value="US">US</option>
                              <option value="ES">ES</option>
                            </select>
                          </div>
                          <div style={styles.formField}>
                            <label style={styles.label}>State</label>
                            <input
                              type="text"
                              style={styles.input}
                              value={taxEditForm.state_code}
                              onChange={(e) =>
                                setTaxEditForm({ ...taxEditForm, state_code: e.target.value })
                              }
                            />
                          </div>
                          <div style={styles.formField}>
                            <label style={styles.label}>Filing Status</label>
                            <select
                              style={styles.input}
                              value={taxEditForm.filing_status}
                              onChange={(e) =>
                                setTaxEditForm({ ...taxEditForm, filing_status: e.target.value })
                              }
                            >
                              <option value="single">Single</option>
                              <option value="married">Married</option>
                              <option value="head_of_household">Head of Household</option>
                            </select>
                          </div>
                          <div style={styles.formField}>
                            <label style={styles.label}>Allowances</label>
                            <input
                              type="number"
                              min="0"
                              style={styles.input}
                              value={taxEditForm.allowances}
                              onChange={(e) =>
                                setTaxEditForm({ ...taxEditForm, allowances: parseInt(e.target.value) || 0 })
                              }
                            />
                          </div>
                          <div style={styles.formField}>
                            <label style={styles.label}>Additional Withholding</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              style={styles.input}
                              value={(taxEditForm.additional_withholding / 100).toFixed(2)}
                              onChange={(e) =>
                                setTaxEditForm({
                                  ...taxEditForm,
                                  additional_withholding: Math.round(parseFloat(e.target.value || '0') * 100),
                                })
                              }
                            />
                          </div>
                          <div style={{ ...styles.formField, display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '20px' }}>
                            <input
                              type="checkbox"
                              checked={taxEditForm.exempt}
                              onChange={(e) =>
                                setTaxEditForm({ ...taxEditForm, exempt: e.target.checked })
                              }
                            />
                            <label style={{ fontSize: '13px', color: 'var(--color-text, #111827)' }}>Exempt</label>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                          <Button size="sm" onClick={handleSaveTaxProfile}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingTaxUserId(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div style={styles.taxCardContent}>
                        <div style={styles.taxCardInfo}>
                          <span style={styles.taxName}>{profile.first_name} {profile.last_name}</span>
                          <span style={styles.taxDetail}>
                            {profile.country_code || '—'} · {profile.state_code || '—'} · {profile.filing_status || '—'} · {profile.allowances ?? 0} allowances
                            {profile.exempt && ' · Exempt'}
                          </span>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => handleEditTaxProfile(profile)}>
                          Edit
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  section: {
    border: '1px solid var(--color-border, #e5e7eb)',
    borderRadius: '8px',
    padding: '16px',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--color-text, #111827)',
    margin: 0,
  },
  inlineForm: {
    border: '1px solid var(--color-border, #e5e7eb)',
    borderRadius: '6px',
    padding: '12px',
    marginBottom: '12px',
    background: 'var(--color-background, #f9fafb)',
  },
  formRow: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-end',
    flexWrap: 'wrap' as const,
  },
  formField: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  formActions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  label: {
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--color-text-secondary, #6b7280)',
  },
  input: {
    border: '1px solid var(--color-border, #e5e7eb)',
    borderRadius: '4px',
    padding: '6px 10px',
    fontSize: '13px',
    color: 'var(--color-text, #111827)',
    background: '#fff',
    outline: 'none',
    minWidth: '140px',
  },
  loadingText: {
    fontSize: '13px',
    color: 'var(--color-text-secondary, #6b7280)',
  },
  emptyText: {
    fontSize: '13px',
    color: 'var(--color-text-secondary, #6b7280)',
  },
  periodsList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1px',
  },
  periodRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    borderRadius: '4px',
    cursor: 'pointer',
    border: '1px solid var(--color-border, #e5e7eb)',
    marginBottom: '4px',
  },
  periodInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  periodDates: {
    fontSize: '13px',
    color: 'var(--color-text, #111827)',
    fontWeight: 500,
  },
  periodActions: {
    display: 'flex',
    gap: '8px',
  },
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'capitalize' as const,
  },
  entriesContainer: {
    padding: '8px 12px 12px',
    marginBottom: '8px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '13px',
  },
  th: {
    textAlign: 'left' as const,
    padding: '8px 10px',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--color-text-secondary, #6b7280)',
    borderBottom: '1px solid var(--color-border, #e5e7eb)',
  },
  tr: {
    borderBottom: '1px solid var(--color-border, #e5e7eb)',
  },
  td: {
    padding: '8px 10px',
    fontSize: '13px',
    color: 'var(--color-text, #111827)',
  },
  breakdownCell: {
    padding: '12px',
    background: 'var(--color-background, #f9fafb)',
    borderBottom: '1px solid var(--color-border, #e5e7eb)',
  },
  breakdownContainer: {
    display: 'flex',
    gap: '24px',
    flexWrap: 'wrap' as const,
  },
  breakdownSection: {
    flex: '1 1 200px',
  },
  breakdownTitle: {
    fontSize: '12px',
    color: 'var(--color-text-secondary, #6b7280)',
    display: 'block',
    marginBottom: '6px',
  },
  breakdownList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  breakdownItem: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    color: 'var(--color-text, #111827)',
    padding: '2px 0',
  },
  taxContainer: {
    marginTop: '4px',
  },
  taxList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  taxCard: {
    border: '1px solid var(--color-border, #e5e7eb)',
    borderRadius: '6px',
    padding: '10px 12px',
  },
  taxCardContent: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  taxCardInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
  },
  taxName: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--color-text, #111827)',
  },
  taxDetail: {
    fontSize: '12px',
    color: 'var(--color-text-secondary, #6b7280)',
  },
  taxEditForm: {
    padding: '4px 0',
  },
  taxEditGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '12px',
  },
};
