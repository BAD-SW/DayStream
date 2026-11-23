import { useEffect, useState } from 'react';
import { Button } from '../design-system/components/actions/Button';
import * as checkoutApi from '../api/checkout';
import * as bookingsApi from '../api/bookings';
import type { Order } from '../api/checkout';
import type { BenefitOption, BenefitRef } from '../api/bookings';
import { describeBenefit } from './booking/BenefitChooser';

/**
 * Checkout: pay one line with a membership or package, change to another, or pay it normally
 * (spec 51, gap 19, criterion 6). Lists the customer's memberships and packages for the line,
 * covering or not (with why not).
 */
export function LineBenefitPicker({ order, itemId, businessId, onChanged, onClose }: {
  order: Order; itemId: string; businessId: string; onChanged: (o: Order) => void; onClose: () => void;
}) {
  const [options, setOptions] = useState<BenefitOption[] | null>(null);
  const [choice, setChoice] = useState<BenefitRef | null>(null);
  const [current, setCurrent] = useState<BenefitRef | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let off = false;
    checkoutApi.getLineBenefits(order.id, itemId, businessId).then((r) => {
      if (off) return;
      setOptions(r.options);
      const now = r.use ? bookingsApi.refOf(r.use) : null;
      setCurrent(now); setChoice(now);
    }).catch(() => { if (!off) setErr('The memberships and packages could not be loaded.'); });
    return () => { off = true; };
  }, [order.id, itemId, businessId]);

  const apply = async () => {
    setBusy(true); setErr('');
    try { onChanged(await checkoutApi.setLineBenefit(order.id, itemId, businessId, choice)); onClose(); }
    catch (e) { setErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'It could not be changed.'); }
    finally { setBusy(false); }
  };

  const unchanged = (choice === null && current === null) || bookingsApi.sameRef(choice, current);
  return (
    <div style={s.box} role="radiogroup" aria-label="Pay this line with">
      {!options && !err && <span style={s.hint}>Loading…</span>}
      {options && options.length === 0 && <span style={s.hint}>The customer has no membership or package for this.</span>}
      {options?.map((o) => (
        <label key={`${o.kind}:${o.source_id}:${o.item_id}`} style={{ ...s.row, opacity: o.covers ? 1 : 0.55 }}>
          <input type="radio" name={`line-benefit-${itemId}`} disabled={!o.covers || busy} checked={bookingsApi.sameRef(o, choice)}
            onChange={() => setChoice({ kind: o.kind, source_id: o.source_id, item_id: o.item_id })} />
          <span><strong>{o.name}</strong> <span style={s.hint}>{o.kind === 'membership' ? 'Membership' : 'Package'} · {o.covers ? describeBenefit(o) : o.reason}</span></span>
        </label>
      ))}
      <label style={s.row}>
        <input type="radio" name={`line-benefit-${itemId}`} disabled={busy} checked={choice === null} onChange={() => setChoice(null)} />
        <span>Pay normally</span>
      </label>
      {err && <span role="alert" style={{ ...s.hint, color: 'var(--color-error)' }}>{err}</span>}
      <div style={s.actions}>
        <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={apply} loading={busy} disabled={unchanged || !options}>Apply</Button>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  box: { display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', marginTop: 'var(--space-sm)', padding: 'var(--space-sm) var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', maxWidth: '460px' },
  row: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', cursor: 'pointer' },
  hint: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)', marginTop: 'var(--space-xs)' },
};
