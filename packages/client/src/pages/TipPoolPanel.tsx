import { askConfirm } from '../design-system/components/feedback/dialogs';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

const MODES: TipPoolMode[] = ['hand', 'hours', 'even'];

const today = () => new Date().toLocaleDateString('sv-SE');
const errText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

interface StaffRow { user_id: string; name: string; hours: number | null; amount_cents: number }

export function TipPoolPanel({ businessId }: { businessId: string }) {
  const { t } = useTranslation('staff');
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
    } catch (e) { setLoadError(errText(e, t('tipPool.errLoad'))); }
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
    const timer = setTimeout(async () => {
      try { const p = await checkoutApi.planTipPool(businessId, request()); if (live) { setPlan(p); setPlanError(''); } }
      catch (e) { if (live) { setPlan(null); setPlanError(errText(e, t('tipPool.errPlan'))); } }
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [businessId, summary, mode, start, end, amounts]);

  const share = async () => {
    if (!plan) return;
    const giving = plan.total_cents - plan.left_cents;
    if (!(await askConfirm({ message: t('tipPool.confirmShare', { amount: formatCurrency(giving) }), confirmLabel: t('common:action.continue') }))) return;
    setSharing(true); setDone('');
    try {
      const r = await checkoutApi.shareTipPool(businessId, request());
      setDone(r.left_cents > 0 ? t('tipPool.sharedLeft', { amount: formatCurrency(r.shared_cents), left: formatCurrency(r.left_cents) }) : t('tipPool.shared', { amount: formatCurrency(r.shared_cents) }));
      setAmounts({}); setStart('');
      await load();
    } catch (e) { setPlanError(errText(e, t('tipPool.errShare'))); }
    finally { setSharing(false); }
  };

  if (loadError) return <Alert variant="error">{loadError}</Alert>;
  if (!summary) return <p style={s.muted}>{t('common:loading')}</p>;

  const byHand = mode === 'hand';
  const hint = t(`tipPool.mode.${mode}.hint`);
  const canShare = !!plan && plan.unassigned_cents === 0 && plan.total_cents - plan.left_cents > 0;
  const right = 'right' as const;

  // By hand: every staff member, with an amount to enter. By the clock: the staff the plan gives a part to.
  const rows: StaffRow[] = byHand
    ? summary.staff.map((m) => ({ user_id: m.user_id, name: m.name, hours: null, amount_cents: amounts[m.user_id] ?? 0 }))
    : (plan?.staff || []).map((m) => ({ user_id: m.user_id, name: m.name, hours: m.hours, amount_cents: m.amount_cents }));
  const givenOut = rows.reduce((sum, r) => sum + r.amount_cents, 0);

  const footer = plan ? [
    { strong: true, cells: [{ content: t('tipPool.totalShared') }, ...(byHand ? [] : [{ content: '' }]), { content: formatCurrency(givenOut), align: right }] },
    { cells: [{ content: t('tipPool.tipsInPool') }, ...(byHand ? [] : [{ content: '' }]), { content: formatCurrency(plan.total_cents), align: right }] },
    ...(byHand && plan.unassigned_cents !== 0
      ? [{ cells: [{ content: t('tipPool.stillToShare') }, { content: <span style={{ color: 'var(--color-error)' }}>{formatCurrency(plan.unassigned_cents)}</span>, align: right }] }]
      : []),
    ...(!byHand && plan.left_cents > 0
      ? [{ cells: [{ content: t('tipPool.staysInPool') }, { content: '' }, { content: formatCurrency(plan.left_cents), align: right }] }]
      : []),
  ] : undefined;

  return (
    <div style={s.wrap}>
      <Card padding="lg">
        <div style={s.stats}>
          <Stat label={t('tipPool.waiting')} value={formatCurrency(summary.waiting_cents)} />
          <Stat label={t('tipPool.electronic')} value={formatCurrency(summary.electronic_cents)} />
          <Stat label={t('tipPool.cash')} value={formatCurrency(summary.cash_cents)} />
          <Stat label={t('tipPool.tips')} value={summary.tips} />
          {summary.first_day && (
            <Stat label={t('tipPool.tipped')} value={summary.first_day === summary.last_day
              ? formatDateOnly(summary.first_day)
              : `${formatDateOnly(summary.first_day)} – ${formatDateOnly(summary.last_day || summary.first_day)}`} />
          )}
        </div>
      </Card>

      {done && <Alert variant="success">{done}</Alert>}

      {summary.waiting_cents === 0 ? (
        <p style={s.empty}>{t('tipPool.noTips')}</p>
      ) : (
        <Card title={t('tipPool.shareThePool')} padding="lg">
          <div style={s.toolbar}>
            <div>
              <label style={s.fieldLabel} htmlFor="tip-pool-mode">{t('tipPool.method')}</label>
              <select id="tip-pool-mode" style={{ ...s.input, minWidth: '240px' }} value={mode} onChange={(e) => setMode(e.target.value as TipPoolMode)}>
                {MODES.map((m) => <option key={m} value={m}>{t(`tipPool.mode.${m}.label`)}</option>)}
              </select>
            </div>
            <div>
              <label style={s.fieldLabel} htmlFor="tip-pool-start">{t('tipPool.tipsFrom')}</label>
              <input id="tip-pool-start" type="date" style={s.input} value={start} max={end} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <label style={s.fieldLabel} htmlFor="tip-pool-end">{t('tipPool.to')}</label>
              <input id="tip-pool-end" type="date" style={s.input} value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <p style={s.help}>{hint}</p>

          {planError && <div style={s.block}><Alert variant="error">{planError}</Alert></div>}

          {!byHand && plan && plan.left_cents > 0 && (
            <div style={s.block}>
              <Alert variant="warning">
                {t('tipPool.nobodyClocked', { days: plan.days_without_staff.map((d) => formatDateOnly(d)).join(', '), amount: formatCurrency(plan.left_cents) })}
              </Alert>
            </div>
          )}

          <div style={s.block}>
            <Table<StaffRow>
              data={rows}
              rowId={(r) => r.user_id}
              emptyMessage={byHand ? t('tipPool.noStaff') : t('tipPool.nobodyOnDates')}
              columns={[
                { key: 'name', header: t('tipPool.staff') },
                ...(byHand ? [] : [{ key: 'hours', header: t('tipPool.hours'), align: right, render: (v: number | null) => <div style={{ textAlign: right }}>{v ?? '—'}</div> }]),
                {
                  key: 'amount_cents', header: t('tipPool.amount'), align: right, width: '160px',
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
            <Button onClick={share} loading={sharing} disabled={!canShare}>{t('tipPool.shareTips')}</Button>
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
