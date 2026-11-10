import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCustomerForms } from '../../api/forms';
import type { CustomerFormStatus } from '../../api/forms';

/**
 * A clear warning that a customer still has forms to complete (spec 51, gap 1). Shown wherever
 * staff deal with the customer: the profile, scheduling an appointment, a booking, and check-in.
 * It names the forms and links to the customer's Forms tab. It is information only: it never
 * stops a booking or a check-in.
 *
 * Context decides which forms apply: a `serviceId` while a booking is being made, a `bookingId`
 * for an existing booking, or neither (the customer's upcoming bookings and first visit).
 * Change `refreshKey` to make it check again, for example after a form was completed.
 */
interface Props {
  customerId: string;
  businessId: string;
  bookingId?: string;
  serviceId?: string;
  refreshKey?: number;
  /** Opens the Forms tab in place (the profile). Without it the notice links to the customer's profile. */
  onOpenForms?: () => void;
}

export function FormsNeededNotice({ customerId, businessId, bookingId, serviceId, refreshKey = 0, onOpenForms }: Props) {
  const [needed, setNeeded] = useState<CustomerFormStatus[]>([]);

  useEffect(() => {
    let cancelled = false;
    setNeeded([]);
    if (!customerId || !businessId) return;
    getCustomerForms(customerId, businessId, bookingId, serviceId)
      .then((d) => {
        if (!cancelled) setNeeded(d.forms.filter((f) => f.status === 'missing' || f.status === 'out_of_date'));
      })
      .catch(() => { if (!cancelled) setNeeded([]); });
    return () => { cancelled = true; };
  }, [customerId, businessId, bookingId, serviceId, refreshKey]);

  if (needed.length === 0) return null;

  const names = needed.map((f) => `${f.name}${f.status === 'out_of_date' ? ' (out of date)' : ''}`).join(', ');
  return (
    <div role="alert" style={s.box}>
      <span style={s.icon} aria-hidden="true">!</span>
      <div style={s.text}>
        <strong style={s.title}>{needed.length === 1 ? '1 form needs to be completed' : `${needed.length} forms need to be completed`}</strong>
        <span style={s.names}>{names}</span>
      </div>
      {onOpenForms
        ? <button type="button" style={s.action} onClick={onOpenForms}>Open forms</button>
        : <Link to={`/customers/${customerId}?tab=forms`} style={s.action}>Open forms</Link>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  box: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)', padding: 'var(--space-md)', margin: 'var(--space-sm) 0', background: 'var(--color-warning-bg)', border: '2px solid var(--color-warning)', borderRadius: 'var(--radius-md)', color: 'var(--color-text)' },
  icon: { flexShrink: 0, width: '28px', height: '28px', borderRadius: 'var(--radius-full)', background: 'var(--color-warning)', color: 'var(--color-text-inverse, var(--color-surface))', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 },
  text: { display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 },
  title: { fontSize: 'var(--font-size-base)', fontWeight: 700 },
  names: { fontSize: 'var(--font-size-sm)', overflowWrap: 'anywhere' },
  action: { flexShrink: 0, background: 'transparent', border: '1px solid var(--color-warning)', borderRadius: 'var(--radius-md)', color: 'var(--color-text)', padding: '8px 14px', minHeight: '36px', fontWeight: 600, fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)', cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' },
};
