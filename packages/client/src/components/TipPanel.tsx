import { useEffect, useState, useCallback, useRef } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { CurrencyInput } from './CurrencyInput';
import * as checkoutApi from '../api/checkout';
import type { Order, TipSettings, OrderTip } from '../api/checkout';
import { formatCurrency } from '../utils/currency';

/**
 * The tip at Checkout (spec 51, gap 14): a slider, like a kiosk, from no tip up to the business's
 * highest percentage of the total (after discounts; before tax or including it, as the business
 * chose), starting at its default (owner, 23 Nov 2026); or a typed amount. And who gets it, shared
 * as the business chose, which staff can change before payment. The tip is charged with the sale.
 */
export function TipPanel({ order, businessId, settings, locked, onChange }: {
  order: Order; businessId: string; settings: TipSettings; locked: boolean; onChange: (o: Order) => void;
}) {
  const tip = order.tip_amount || 0;
  const [info, setInfo] = useState<OrderTip | null>(null);
  const [custom, setCustom] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [splitting, setSplitting] = useState<Record<string, number> | null>(null);

  const load = useCallback(() => {
    checkoutApi.getOrderTip(order.id, businessId).then(setInfo).catch(() => setInfo(null));
  }, [order.id, businessId]);
  // The shares follow the tip, the order's lines and who each line (or the order) is credited to.
  const staffKey = `${order.credited_to || ''}|${order.prepaid?.id || ''}|${order.items.map((i) => `${i.id}:${i.credited_to || ''}:${i.total_price}`).join(',')}`;
  useEffect(() => { load(); }, [load, tip, staffKey, order.total_amount]);
  // A changed order drops a split by hand (the server does too), so close an open one.
  useEffect(() => { setSplitting(null); }, [staffKey]);

  // A percentage is of the total before tax (the default) or including tax, as the business chose.
  // The server's base: with a service paid at reservation (unless refunded) and lines paid with a
  // membership or package at their normal price (spec 51, gaps 14 and 19).
  const pre = order.prepaid?.status === 'completed' ? order.prepaid : null;
  const total = order.tip_base?.total ?? order.total_amount + (pre?.total_amount || 0);
  const taxTotal = order.tip_base?.tax ?? order.tax_amount + (pre?.tax_amount || 0);
  const base = settings.base === 'after_tax' ? total : total - taxTotal;
  const pct = (p: number) => Math.round((base * p) / 100);
  // The percentage the tip was picked as (0: no tip): the server works the tip out from it again
  // whenever the order changes before payment. A typed amount has none.
  const currentPct = order.tip_percent != null ? Number(order.tip_percent) : null;
  const typed = currentPct === null && tip > 0;
  const save = async (cents: number, split?: Array<{ user_id: string; amount_cents: number }> | null, percent: number | null = null) => {
    setBusy(true); setErr('');
    try { onChange(await checkoutApi.setOrderTip(order.id, businessId, cents, split, percent)); setSplitting(null); }
    catch (e) { setErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not set the tip.'); }
    finally { setBusy(false); }
  };

  // The slider: where it is being dragged to, else the order's percentage (a typed amount shows
  // as the nearest percentage), else the business's default.
  const [slide, setSlide] = useState<number | null>(null);
  const shown = slide ?? (currentPct ?? (typed && base > 0 ? Math.round((tip / base) * 100) : settings.default_percent));
  const max = Math.max(settings.max_percent, shown);
  // Save where the slider is let go (a short pause while dragging), so each step is not a request.
  useEffect(() => {
    if (slide === null) return;
    const id = setTimeout(() => { const at = slide; save(pct(at), null, at).finally(() => setSlide((cur) => (cur === at ? null : cur))); }, 350);
    return () => clearTimeout(id);
  }, [slide]);
  // A new order starts at the business's default tip; a choice made (even no tip) is kept.
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (started.current === order.id || locked || base <= 0) return;
    started.current = order.id;
    if (order.tip_percent == null && tip === 0 && settings.default_percent > 0) save(pct(settings.default_percent), null, settings.default_percent);
  }, [order.id, locked, base]);
  const splitTotal = splitting ? Object.values(splitting).reduce((a, b) => a + b, 0) : 0;
  const staff = info ? [...info.staff, ...info.shares.filter((s) => !info.staff.some((x) => x.user_id === s.user_id)).map((s) => ({ user_id: s.user_id, name: s.name }))] : [];

  return (
    <div style={s.card}>
      <h3 style={s.title}>Tip</h3>
      <div style={s.slider}>
        <div style={s.readout} aria-live="polite">
          {typed && slide === null
            ? <><strong>{formatCurrency(tip)}</strong><span style={s.label}>typed amount</span></>
            : shown === 0
              ? <strong>No tip</strong>
              : <><strong>{shown}%</strong><span style={s.amount}>{formatCurrency(slide !== null ? pct(slide) : (currentPct !== null ? tip : pct(shown)))}</span></>}
        </div>
        <input type="range" min={0} max={max} step={1} value={shown} disabled={locked || base <= 0}
          aria-label="Tip percentage" aria-valuetext={shown === 0 ? 'No tip' : `${shown}%, ${formatCurrency(pct(shown))}`}
          onChange={(e) => { setCustom(null); setSlide(Number(e.target.value)); }}
          style={{ ...s.range, opacity: typed && slide === null ? 0.5 : 1 }} />
        <div style={s.ends}><span>No tip</span><span>{max}%</span></div>
      </div>
      <div style={s.row}>
        <span style={s.label}>Or enter an amount</span>
        <CurrencyInput value={custom ?? (typed ? tip : 0)} disabled={locked || busy}
          onChange={(v) => setCustom(Math.max(0, v))} style={s.amountInput} />
        <Button size="sm" variant="secondary" disabled={locked || busy || custom === null || (typed && custom === tip)} onClick={() => save(custom ?? 0, null, (custom ?? 0) === 0 ? 0 : null)}>Add</Button>
      </div>
      {locked && <p style={s.hint}>The card is being charged; the tip can no longer change. Cancel the card entry to change it.</p>}
      {tip > 0 && info && (
        info.shares.length === 0 ? (
          <p style={s.hint}>No staff member is on this order, so the tip goes to the tip pool. To give it to someone, credit the order or a line to them.</p>
        ) : splitting ? (
          <div style={s.split}>
            {staff.map((m) => (
              <label key={m.user_id} style={s.splitRow}>
                <span style={{ flex: 1 }}>{m.name}</span>
                <CurrencyInput value={splitting[m.user_id] ?? 0} onChange={(v) => setSplitting({ ...splitting, [m.user_id]: Math.max(0, v) })} style={{ width: '90px' }} />
              </label>
            ))}
            <div style={s.row}>
              <span style={{ ...s.hint, color: splitTotal === tip ? 'var(--color-text-secondary)' : 'var(--color-error)' }}>
                {formatCurrency(splitTotal)} of {formatCurrency(tip)}{splitTotal !== tip ? ' — the shares must add up to the tip' : ''}
              </span>
              <span style={{ flex: 1 }} />
              <Button size="sm" variant="secondary" onClick={() => setSplitting(null)}>Cancel</Button>
              <Button size="sm" disabled={busy || splitTotal !== tip}
                onClick={() => save(tip, Object.entries(splitting).map(([user_id, amount_cents]) => ({ user_id, amount_cents })), currentPct)}>Save split</Button>
            </div>
          </div>
        ) : (
          <div style={s.row}>
            <span style={s.hint}>
              Goes to {info.shares.map((x) => `${x.name} ${formatCurrency(x.amount_cents)}`).join(', ')}
              {info.by_hand ? ' (split by hand)' : info.shares.length > 1 ? (settings.split === 'even' ? ' (split evenly)' : ' (split by the value of their services)') : ''}
            </span>
            {!locked && <button type="button" style={s.link} onClick={() => setSplitting(Object.fromEntries(info.shares.map((x) => [x.user_id, x.amount_cents])))}>Change</button>}
            {!locked && info.by_hand && <button type="button" style={s.link} onClick={() => save(tip, null, currentPct)}>Use the usual split</button>}
          </div>
        )
      )}
      {err && <p role="alert" style={{ ...s.hint, color: 'var(--color-error)' }}>{err}</p>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)', marginBottom: 'var(--space-md)' },
  title: { color: 'var(--color-text)', margin: '0 0 var(--space-sm)', fontSize: 'var(--font-size-md)' },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm)' },
  slider: { display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', maxWidth: '480px', marginBottom: 'var(--space-md)' },
  readout: { display: 'flex', alignItems: 'baseline', gap: 'var(--space-sm)', fontSize: 'var(--font-size-xl)', color: 'var(--color-text)' },
  amount: { fontSize: 'var(--font-size-md)', color: 'var(--color-text-secondary)' },
  range: { width: '100%', minHeight: '44px', accentColor: 'var(--color-accent)', cursor: 'pointer' },
  ends: { display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  amountInput: { width: '110px', padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 'var(--font-size-sm)' },
  label: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  hint: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 'var(--space-sm) 0 0' },
  link: { background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)', textDecoration: 'underline', marginTop: 'var(--space-sm)' },
  split: { display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', marginTop: 'var(--space-sm)', maxWidth: '420px' },
  splitRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
};
