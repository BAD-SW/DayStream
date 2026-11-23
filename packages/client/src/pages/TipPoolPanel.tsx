import { useEffect, useState } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { Card } from '../design-system/components/data/Card';
import { Stat } from '../design-system/components/data/Stat';
import { Table } from '../design-system/components/data/Table';
import { Alert } from '../design-system/components/feedback/Alert';
import { CurrencyInput } from '../components/CurrencyInput';
import * as checkoutApi from '../api/checkout';
import type { TipPoolMode, TipPoolPlan, TipPoolSummary } from '../api/checkout';
import { formatCurrency } from '../utils/currency';
import { formatDateOnly } from '../utils/date';

// The tip pool (spec 51, gap 14): tips on orders with no staff member on them wait here until the
// owner or a manager shares them out, by hand or among the staff clocked in on the day of each tip.

const MODES: Array<{ value: TipPoolMode; label: string; hint: string }> = [
  { value: 'hand', label: 'By hand', hint: 'Enter the amount each staff member gets. The amounts must add up to the tips in the pool for these dates.' },
  { value: 'hours', label: 'By hours clocked in', hint: 'Each tip is shared among the staff clocked in on the day it was given, by the hours they worked that day.' },
  { value: 'even', label: 'Evenly among staff clocked in', hint: 'Each tip is shared evenly among the staff clocked in on the day it was given.' },
];

const today = () => new Date().toLocaleDateString('sv-SE');
const errText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

interface StaffRow { user_id: string; name: string; hours: number | null; amount_cents: number }

export function TipPoolPanel({ businessId }: { businessId: string }) {
  const [summary, setSummary] = useState<TipPoolSummary | null>(null);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState<TipPoolMode>('hand');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState(today());
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [plan, setPlan] = useState<TipPoolPlan | null>(null);
  const [planError, setPlanError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [done, setDone] = useState('');

  const load = async () => {
    setLoadError('');
    try {
      const s = await checkoutApi.getTipPool(businessId);
      setSummary(s);
      // Start on the first day with a tip waiting, so the dates cover the whole pool.
      setStart((cur) => cur || s.first_day || '');
    } catch (e) { setLoadError(errText(e, 'Failed to load the tip pool')); }
  };
  useEffect(() => { if (businessId) load(); }, [businessId]);

  const request = () => ({
    mode, start: start || null, end,
    amounts: mode === 'hand' ? Object.entries(amounts).filter(([, c]) => c > 0).map(([user_id, amount_cents]) => ({ user_id, amount_cents })) : [],
  });

  // Preview the plan whenever the choices change (nothing is changed on the server).
  useEffect(() => {
    if (!businessId || !summary || summary.waiting_cents === 0 || !end) { setPlan(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      try { const p = await checkoutApi.planTipPool(businessId, request()); if (live) { setPlan(p); setPlanError(''); } }
      catch (e) { if (live) { setPlan(null); setPlanError(errText(e, 'Failed to work out the shares')); } }
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [businessId, summary, mode, start, end, amounts]);

  const share = async () => {
    if (!plan) return;
    const giving = plan.total_cents - plan.left_cents;
    if (!confirm(`Share ${formatCurrency(giving)} from the tip pool? Card and electronic tips go into the next pay run; cash tips are handed over from the till now.`)) return;
    setSharing(true); setDone('');
    try {
      const r = await checkoutApi.shareTipPool(businessId, request());
      setDone(`${formatCurrency(r.shared_cents)} shared.${r.left_cents > 0 ? ` ${formatCurrency(r.left_cents)} stays in the pool.` : ''}`);
      setAmounts({}); setStart('');
      await load();
    } catch (e) { setPlanError(errText(e, 'Failed to share the tip pool')); }
    finally { setSharing(false); }
  };

  if (loadError) return <Alert variant="error">{loadError}</Alert>;
  if (!summary) return <p style={s.muted}>Loading...</p>;

  const byHand = mode === 'hand';
  const hint = MODES.find((m) => m.value === mode)?.hint;
  const canShare = !!plan && plan.unassigned_cents === 0 && plan.total_cents - plan.left_cents > 0;
  const right = 'right' as const;

  // By hand: every staff member, with an amount to enter. By the clock: the staff the plan gives a part to.
  const rows: StaffRow[] = byHand
    ? summary.staff.map((m) => ({ user_id: m.user_id, name: m.name, hours: null, amount_cents: amounts[m.user_id] ?? 0 }))
    : (plan?.staff || []).map((m) => ({ user_id: m.user_id, name: m.name, hours: m.hours, amount_cents: m.amount_cents }));
  const givenOut = rows.reduce((t, r) => t + r.amount_cents, 0);

  const footer = plan ? [
    { strong: true, cells: [{ content: 'Total shared' }, ...(byHand ? [] : [{ content: '' }]), { content: formatCurrency(givenOut), align: right }] },
    { cells: [{ content: 'Tips in the pool for these dates' }, ...(byHand ? [] : [{ content: '' }]), { content: formatCurrency(plan.total_cents), align: right }] },
    ...(byHand && plan.unassigned_cents !== 0
      ? [{ cells: [{ content: 'Still to share' }, { content: <span style={{ color: 'var(--color-error)' }}>{formatCurrency(plan.unassigned_cents)}</span>, align: right }] }]
      : []),
    ...(!byHand && plan.left_cents > 0
      ? [{ cells: [{ content: 'Stays in the pool' }, { content: '' }, { content: formatCurrency(plan.left_cents), align: right }] }]
      : []),
  ] : undefined;

  return (
    <div style={s.wrap}>
      <Card padding="lg">
        <div style={s.stats}>
          <Stat label="Waiting to be shared" value={formatCurrency(summary.waiting_cents)} />
          <Stat label="Card and electronic" value={formatCurrency(summary.electronic_cents)} />
          <Stat label="Cash in the till" value={formatCurrency(summary.cash_cents)} />
          <Stat label="Tips" value={summary.tips} />
          {summary.first_day && (
            <Stat label="Tipped" value={summary.first_day === summary.last_day
              ? formatDateOnly(summary.first_day)
              : `${formatDateOnly(summary.first_day)} – ${formatDateOnly(summary.last_day || summary.first_day)}`} />
          )}
        </div>
      </Card>

      {done && <Alert variant="success">{done}</Alert>}

      {summary.waiting_cents === 0 ? (
        <p style={s.empty}>No tips are waiting. Tips on orders with no staff member on them come here to be shared.</p>
      ) : (
        <Card title="Share the pool" padding="lg">
          <div style={s.toolbar}>
            <div>
              <label style={s.fieldLabel} htmlFor="tip-pool-mode">Share method</label>
              <select id="tip-pool-mode" style={{ ...s.input, minWidth: '240px' }} value={mode} onChange={(e) => setMode(e.target.value as TipPoolMode)}>
                {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label style={s.fieldLabel} htmlFor="tip-pool-start">Tips from</label>
              <input id="tip-pool-start" type="date" style={s.input} value={start} max={end} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <label style={s.fieldLabel} htmlFor="tip-pool-end">To</label>
              <input id="tip-pool-end" type="date" style={s.input} value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <p style={s.help}>{hint}</p>

          {planError && <div style={s.block}><Alert variant="error">{planError}</Alert></div>}

          {!byHand && plan && plan.left_cents > 0 && (
            <div style={s.block}>
              <Alert variant="warning">
                Nobody was clocked in on {plan.days_without_staff.map((d) => formatDateOnly(d)).join(', ')}, so {formatCurrency(plan.left_cents)} stays in the pool. Share it by hand if needed.
              </Alert>
            </div>
          )}

          <div style={s.block}>
            <Table<StaffRow>
              data={rows}
              rowId={(r) => r.user_id}
              emptyMessage={byHand ? 'No staff found.' : 'Nobody was clocked in on these dates.'}
              columns={[
                { key: 'name', header: 'Staff' },
                ...(byHand ? [] : [{ key: 'hours', header: 'Hours', align: right, render: (v: number | null) => <div style={{ textAlign: right }}>{v ?? '—'}</div> }]),
                {
                  key: 'amount_cents', header: 'Amount', align: right, width: '160px',
                  render: (v: number, r: StaffRow) => byHand ? (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <CurrencyInput value={v} onChange={(c) => setAmounts({ ...amounts, [r.user_id]: Math.max(0, c) })}
                        style={{ ...s.input, width: '120px', textAlign: right }} />
                    </div>
                  ) : <div style={{ textAlign: right }}>{formatCurrency(v)}</div>,
                },
              ]}
              footerRows={footer}
            />
          </div>

          <div style={s.actions}>
            <Button onClick={share} loading={sharing} disabled={!canShare}>Share tips</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-lg)' },
  toolbar: { display: 'flex', gap: 'var(--space-md)', alignItems: 'flex-end', flexWrap: 'wrap' },
  fieldLabel: { display: 'block', marginBottom: 'calc(var(--space-xs) * 1.5)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontWeight: 'var(--font-weight-medium)' as React.CSSProperties['fontWeight'] },
  input: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)', color: 'var(--color-text)', background: 'var(--color-surface)', boxSizing: 'border-box' },
  help: { margin: 'var(--space-sm) 0 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  block: { marginTop: 'var(--space-md)' },
  actions: { display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-md)' },
  muted: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  empty: { padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: 0 },
};
