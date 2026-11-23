import { useEffect, useRef, useState } from 'react';
import * as bookingsApi from '../../api/bookings';
import type { BenefitOption, BenefitRef } from '../../api/bookings';
import { formatDateOnly } from '../../utils/date';

// ============================================================
// Paying with a membership or package (spec 51, gap 19; design 19.4). As soon as a customer and a
// service are chosen, New Appointment lists the customer's memberships and packages for it, with
// what is used and left. Paying with one comes first, preselected: a membership first, then the
// package that expires soonest (owner, 23 Nov 2026); "Pay normally" when none covers it, and always
// there. Ones that do not cover it are greyed, with why.
// ============================================================

const windowWord = (f: string | null) => (f === 'daily' ? 'today' : f === 'weekly' ? 'this week' : 'this month');
const unitWord = (o: BenefitOption, n: number) => (o.unit === 'minutes' ? 'minutes' : o.unit === 'sessions' ? (n === 1 ? 'session' : 'sessions') : o.unit === 'items' ? (n === 1 ? 'item' : 'items') : (n === 1 ? 'use' : 'uses'));
const nextDay = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };

/** "1 of 2 left this month, renews 5 Dec" or "3 of 5 sessions left, expires 31 Dec". */
export function describeBenefit(o: BenefitOption): string {
  if (o.allowance === null) return 'Without limit';
  const left = Math.max(o.left ?? 0, 0);
  if (o.kind === 'membership') {
    return `${left} of ${o.allowance} ${unitWord(o, o.allowance)} left ${windowWord(o.frequency)}${o.window_end ? `, renews ${formatDateOnly(nextDay(o.window_end))}` : ''}`;
  }
  return `${left} of ${o.allowance} ${unitWord(o, o.allowance)} left${o.expires_at ? `, expires ${formatDateOnly(o.expires_at.slice(0, 10))}` : ''}`;
}

const keyOf = (r: BenefitRef) => `${r.kind}:${r.source_id}:${r.item_id}`;

export function BenefitChooser({ businessId, customerId, serviceId, variantId, startTime, date, participants, bookingId, value, onChange, disabled }: {
  businessId: string; customerId: string; serviceId: string; variantId: string; startTime?: string | null; participants: number;
  /** The day chosen (YYYY-MM-DD), used until a time is chosen. */
  date?: string | null;
  bookingId?: string | null;
  /** The choice: a membership or package, null to pay normally, undefined until one is made (then the best is preselected). */
  value: BenefitRef | null | undefined;
  onChange: (ref: BenefitRef | null) => void;
  disabled?: boolean;
}) {
  const [options, setOptions] = useState<BenefitOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  // The default follows the choices (service, option, day, time, people) until staff pick one
  // themselves, or the booking is already held against one. A new customer starts again.
  const picked = useRef(false);
  useEffect(() => { if (value === undefined) picked.current = false; }, [value]);
  const choose = (ref: BenefitRef | null) => { picked.current = true; onChange(ref); };

  useEffect(() => {
    let off = false;
    setFailed(false);
    const t = window.setTimeout(() => {
      bookingsApi.getBookingBenefits(businessId, { customerId, serviceId, variantId, startTime, date, participants, bookingId })
        .then((r) => {
          if (off) return;
          setOptions(r.options);
          const covering = r.options.filter((o) => o.covers);
          const held = r.held && r.held.status !== 'released' ? bookingsApi.refOf(r.held) : null;
          // The best one, in the server's order: a membership first, then the package that expires
          // soonest; none covers: pay normally.
          const best = covering[0] ? { kind: covering[0].kind, source_id: covering[0].source_id, item_id: covering[0].item_id } : null;
          if (value === undefined && held) { picked.current = true; onChange(held); }
          else if (!picked.current) { if (!(best === null ? value === null : bookingsApi.sameRef(best, value))) onChange(best); }
          else if (value && !covering.some((o) => bookingsApi.sameRef(o, value)) && !(r.held && bookingsApi.sameRef(bookingsApi.refOf(r.held), value) && r.held.status === 'used')) {
            // The one chosen no longer covers this (another option, day, time or number of people):
            // back to the best one, or pay normally when none covers.
            picked.current = false;
            onChange(best);
          }
        })
        .catch(() => { if (!off) { setOptions(null); setFailed(true); } });
    }, 250);
    return () => { off = true; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, customerId, serviceId, variantId, startTime, date, participants, bookingId]);

  if (failed) return <p className="mk-warn">The memberships and packages could not be loaded.</p>;
  if (!options || options.length === 0) return null;
  const name = `benefit-${serviceId}`;
  return (
    <div className="pay-uses" role="radiogroup" aria-label="Pay with membership or package">
      <span className="q-lab">Pay with membership or package</span>
      {options.map((o) => (
        <label key={keyOf(o)} className="pay-use" style={o.covers ? undefined : { opacity: 0.55 }}>
          <input type="radio" name={name} disabled={disabled || !o.covers} checked={!!value && bookingsApi.sameRef(o, value)}
            onChange={() => choose({ kind: o.kind, source_id: o.source_id, item_id: o.item_id })} />
          <span><b>{o.name}</b> <small>{o.kind === 'membership' ? 'Membership' : 'Package'} · {o.covers ? describeBenefit(o) : o.reason}</small></span>
        </label>
      ))}
      <label className="pay-use">
        <input type="radio" name={name} disabled={disabled} checked={value === null} onChange={() => choose(null)} />
        <span>Pay normally</span>
      </label>
    </div>
  );
}
