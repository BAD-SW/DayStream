import { useState, useEffect, useCallback } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { CurrencyInput } from './CurrencyInput';
import { PaymentMethods } from './PaymentMethods';
import { formatCurrency } from '../utils/currency';
import * as payApi from '../api/payments';
import type { TenantCredit } from '../api/payments';

/**
 * TenantBillingTab — Section A (DayStream → Tenant) billing for a single tenant,
 * rendered inside the tenant window's Billing tab. DayStream-admin only.
 *
 * Holds: the negotiated plan (flat / % of net collections / cap / intro / billing
 * day), the Tenant Payment Account (reuses the shared PaymentMethods component),
 * the itemized charge history, credits with carry-forward, and a manual
 * "Charge now" action for a chosen cycle.
 */

interface Props {
  tenantId: string;
  currency: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function TenantBillingTab({ tenantId, currency }: Props) {
  const [credits, setCredits] = useState<TenantCredit[]>([]);
  const [creditBalance, setCreditBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Plan form (cents where monetary).
  const [flat, setFlat] = useState(0);
  const [pct, setPct] = useState('0');
  const [capEnabled, setCapEnabled] = useState(false);
  const [capAmount, setCapAmount] = useState(0);
  const [capAppliesTo, setCapAppliesTo] = useState<'percentage' | 'combined'>('combined');
  const [introMonths, setIntroMonths] = useState('0');
  const [introFlat, setIntroFlat] = useState(0);
  const [introPct, setIntroPct] = useState('0');
  const [billingDay, setBillingDay] = useState('1');
  const [planStartDate, setPlanStartDate] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);

  // Credit form.
  const [creditAmount, setCreditAmount] = useState(0);
  const [creditReason, setCreditReason] = useState('');
  const [issuingCredit, setIssuingCredit] = useState(false);

  // Charge-now form.
  const now = new Date();
  const [chargeYear, setChargeYear] = useState(now.getUTCFullYear());
  const [chargeMonth, setChargeMonth] = useState(now.getUTCMonth()); // 1-12 of just-closed month
  const [charging, setCharging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c, cr] = await Promise.all([
        payApi.getTenantPlan(tenantId),
        payApi.getTenantCharges(tenantId),
        payApi.getTenantCredits(tenantId),
      ]);
      setCreditBalance(c.creditBalance);
      setCredits(cr);
      if (p) {
        setFlat(p.flat_amount_cents);
        setPct(String(parseFloat(p.percentage_rate)));
        setCapEnabled(p.cap_amount_cents != null);
        setCapAmount(p.cap_amount_cents ?? 0);
        setCapAppliesTo(p.cap_applies_to);
        setIntroMonths(String(p.intro_period_months));
        setIntroFlat(p.intro_flat_amount_cents);
        setIntroPct(String(parseFloat(p.intro_percentage_rate)));
        setBillingDay(String(p.billing_day));
        setPlanStartDate(p.plan_start_date ? String(p.plan_start_date).slice(0, 10) : '');
      }
    } catch {
      setMsg({ ok: false, text: 'Failed to load billing information.' });
    } finally { setLoading(false); }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  async function handleSavePlan() {
    setSavingPlan(true); setMsg(null);
    try {
      await payApi.saveTenantPlan(tenantId, {
        flatAmountCents: flat,
        percentageRate: parseFloat(pct) || 0,
        capAmountCents: capEnabled ? capAmount : null,
        capAppliesTo,
        introPeriodMonths: parseInt(introMonths, 10) || 0,
        introFlatAmountCents: introFlat,
        introPercentageRate: parseFloat(introPct) || 0,
        billingDay: parseInt(billingDay, 10) || 1,
        planStartDate: planStartDate || undefined,
      });
      setMsg({ ok: true, text: 'Billing plan saved.' });
      await load();
    } catch (err: any) {
      setMsg({ ok: false, text: err?.response?.data?.error || 'Failed to save plan.' });
    } finally { setSavingPlan(false); }
  }

  async function handleIssueCredit() {
    if (creditAmount <= 0 || !creditReason.trim()) {
      setMsg({ ok: false, text: 'Enter a credit amount and reason.' });
      return;
    }
    setIssuingCredit(true); setMsg(null);
    try {
      await payApi.issueTenantCredit(tenantId, creditAmount, creditReason.trim());
      setCreditAmount(0); setCreditReason('');
      setMsg({ ok: true, text: 'Credit issued.' });
      await load();
    } catch (err: any) {
      setMsg({ ok: false, text: err?.response?.data?.error || 'Failed to issue credit.' });
    } finally { setIssuingCredit(false); }
  }

  async function handleChargeNow() {
    setCharging(true); setMsg(null);
    try {
      const r = await payApi.chargeTenantNow(tenantId, chargeYear, chargeMonth, currency);
      const label = r.status === 'settled' ? 'settled'
        : r.status === 'pending' ? 'pending (bank settlement in progress)'
        : r.status === 'zero' ? 'recorded as zero'
        : `failed: ${r.failureReason ?? ''}`;
      setMsg({ ok: r.status !== 'failed', text: `Charge ${r.referenceNumber} ${label}.` });
      await load();
    } catch (err: any) {
      const code = err?.response?.data?.code;
      setMsg({ ok: false, text: code === 'NO_PLAN' ? 'Configure a billing plan first.' : (err?.response?.data?.error || 'Charge failed.') });
    } finally { setCharging(false); }
  }

  if (loading) return <p style={styles.muted}>Loading billing…</p>;

  return (
    <div style={styles.wrap}>
      {msg && (
        <p style={{ ...styles.msg, color: msg.ok ? 'var(--color-success, #17794A)' : 'var(--color-error, #C4291C)' }}>{msg.text}</p>
      )}

      <div style={styles.grid}>
        {/* ---- Plan editor ---- */}
        <section style={styles.card}>
          <h4 style={styles.cardTitle}>Billing Plan</h4>
          <p style={styles.help}>What DayStream charges this tenant each cycle. Flat and/or a percentage of net collections.</p>

          <div style={styles.row2}>
            <Field label="Flat amount / cycle">
              <CurrencyInput style={styles.input} value={flat} onChange={setFlat} />
            </Field>
            <Field label="Percentage of net collections (%)">
              <input style={styles.input} value={pct} onChange={(e) => setPct(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" />
            </Field>
          </div>

          <div style={styles.capRow}>
            <label style={styles.checkLabel}>
              <input type="checkbox" checked={capEnabled} onChange={(e) => setCapEnabled(e.target.checked)} />
              Per-cycle cap
            </label>
            {capEnabled && (
              <div style={styles.row2}>
                <Field label="Cap amount">
                  <CurrencyInput style={styles.input} value={capAmount} onChange={setCapAmount} />
                </Field>
                <Field label="Cap applies to">
                  <select style={styles.input} value={capAppliesTo} onChange={(e) => setCapAppliesTo(e.target.value as any)}>
                    <option value="combined">Flat + percentage</option>
                    <option value="percentage">Percentage only</option>
                  </select>
                </Field>
              </div>
            )}
          </div>

          <div style={styles.row3}>
            <Field label="Intro period (months)">
              <input style={styles.input} value={introMonths} onChange={(e) => setIntroMonths(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
            </Field>
            <Field label="Intro flat / cycle">
              <CurrencyInput style={styles.input} value={introFlat} onChange={setIntroFlat} />
            </Field>
            <Field label="Intro % rate">
              <input style={styles.input} value={introPct} onChange={(e) => setIntroPct(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" />
            </Field>
          </div>

          <div style={styles.row2}>
            <Field label="Billing day (of month)">
              <input style={styles.input} value={billingDay} onChange={(e) => setBillingDay(e.target.value.replace(/\D/g, '').slice(0, 2))} inputMode="numeric" />
            </Field>
            <Field label="Plan start date">
              <input style={styles.input} type="date" value={planStartDate} onChange={(e) => setPlanStartDate(e.target.value)} />
            </Field>
          </div>
          <p style={styles.help}>The intro period counts from the plan start date. Defaults to today if left blank.</p>

          <div style={styles.actions}>
            <Button variant="primary" size="sm" loading={savingPlan} onClick={handleSavePlan}>Save plan</Button>
          </div>
        </section>

        {/* ---- Payment account ---- */}
        <section style={styles.card}>
          <PaymentMethods
            owner={{ owner_level: 'tenant', tenant_id: tenantId }}
            allowedTypes={['card', 'bank_draw']}
            title="Payment Methods on File (charged for platform billing)"
          />
        </section>
      </div>

      {/* ---- Charge now + credits ---- */}
      <div style={styles.grid}>
        <section style={styles.card}>
          <h4 style={styles.cardTitle}>Charge now</h4>
          <p style={styles.help}>Manually bill a cycle (billed in arrears). Idempotent — re-running a settled cycle won't double-charge.</p>
          <div style={styles.row2}>
            <Field label="Year">
              <input style={styles.input} value={chargeYear} onChange={(e) => setChargeYear(parseInt(e.target.value.replace(/\D/g, '') || '0', 10))} inputMode="numeric" />
            </Field>
            <Field label="Month">
              <select style={styles.input} value={chargeMonth} onChange={(e) => setChargeMonth(parseInt(e.target.value, 10))}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </Field>
          </div>
          <div style={styles.actions}>
            <Button variant="outline" size="sm" loading={charging} onClick={handleChargeNow}>Charge this cycle</Button>
          </div>
        </section>

        <section style={styles.card}>
          <h4 style={styles.cardTitle}>Credits</h4>
          <p style={styles.help}>Carry-forward balance: <strong>{formatCurrency(creditBalance, currency)}</strong></p>
          <div style={styles.row2}>
            <Field label="Amount">
              <CurrencyInput style={styles.input} value={creditAmount} onChange={setCreditAmount} />
            </Field>
            <Field label="Reason">
              <input style={styles.input} value={creditReason} onChange={(e) => setCreditReason(e.target.value)} placeholder="e.g. service outage" />
            </Field>
          </div>
          <div style={styles.actions}>
            <Button variant="outline" size="sm" loading={issuingCredit} onClick={handleIssueCredit}>Issue credit</Button>
          </div>
          {(() => {
            const active = credits.filter((c) => c.remaining_cents > 0);
            if (active.length === 0) {
              return <p style={styles.help}>No credits with a remaining balance.</p>;
            }
            return (
              <>
                <p style={styles.help}>{active.length} credit{active.length === 1 ? '' : 's'} with a remaining balance</p>
                <ul style={styles.scrollList}>
                  {active.map((c) => (
                    <li key={c.id} style={styles.listItem}>
                      <span>{formatCurrency(c.amount_cents, currency)} — {c.reason}</span>
                      <span style={styles.help}>{formatCurrency(c.remaining_cents, currency)} left</span>
                    </li>
                  ))}
                </ul>
              </>
            );
          })()}
        </section>
      </div>

    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={styles.field}>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-md)' },
  card: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)' },
  cardTitle: { fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-bold)' as any, margin: '0 0 var(--space-xs)', color: 'var(--color-text)' },
  field: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: 0 },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text)' },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  row2: { display: 'flex', gap: 'var(--space-sm)' },
  row3: { display: 'flex', gap: 'var(--space-sm)' },
  capRow: { display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', margin: 'var(--space-sm) 0' },
  checkLabel: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  actions: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', marginTop: 'var(--space-sm)' },
  help: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-sm)' },
  muted: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  msg: { fontSize: 'var(--font-size-sm)', margin: 0 },
  list: { listStyle: 'none', margin: 'var(--space-sm) 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' },
  scrollList: { listStyle: 'none', margin: 'var(--space-xs) 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '160px', overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' },
  listItem: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', padding: '6px 10px', borderBottom: '1px solid var(--color-border)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' },
  th: { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  thRight: { textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  td: { padding: '6px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' },
  tdRight: { padding: '6px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)', textAlign: 'right' },
  linkBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-xs)', fontFamily: 'var(--font-family)', textDecoration: 'underline', padding: 0 },
};
