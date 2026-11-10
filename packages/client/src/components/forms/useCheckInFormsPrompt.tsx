import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../design-system/components/actions/Button';
import { Modal } from '../../design-system/components/feedback/Modal';
import { getOutstandingForms, startFormRequest } from '../../api/forms';
import type { OutstandingForms } from '../../api/forms';

/**
 * At check-in, tell staff about forms the customer still has to complete (spec 51, gap 1).
 *
 * `requestCheckIn(booking, proceed)` looks the booking up at that moment. With nothing missing it
 * calls `proceed()` straight away. Otherwise it shows a prompt that names the forms and lets staff
 * hand the customer a device to fill one in now, open the customer's forms, check in anyway, or
 * cancel. It informs; it never forces: "Check in anyway" always works, and a failed lookup checks in.
 *
 * Put the returned `prompt` anywhere in the page.
 */
export interface CheckInBooking {
  id: string;
  customer_id?: string | null;
}

export function useCheckInFormsPrompt(businessId: string): {
  requestCheckIn: (booking: CheckInBooking, proceed: () => void | Promise<void>) => Promise<void>;
  prompt: ReactNode;
} {
  const navigate = useNavigate();
  const [open, setOpen] = useState<{ booking: CheckInBooking; proceed: () => void | Promise<void> } | null>(null);
  const [forms, setForms] = useState<OutstandingForms['forms']>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const lookup = useCallback(async (bookingId: string): Promise<OutstandingForms['forms']> => {
    const result = await getOutstandingForms(businessId, [bookingId]);
    return result[bookingId]?.forms ?? [];
  }, [businessId]);

  const requestCheckIn = useCallback(async (booking: CheckInBooking, proceed: () => void | Promise<void>) => {
    // A walk-in with no customer record has no forms to complete.
    if (!booking.customer_id || !businessId) { await proceed(); return; }
    let needed: OutstandingForms['forms'] = [];
    try { needed = await lookup(booking.id); } catch { needed = []; }
    if (needed.length === 0) { await proceed(); return; }
    setMessage(null);
    setForms(needed);
    setOpen({ booking, proceed });
  }, [businessId, lookup]);

  // Forms are usually completed in another tab; check again when staff come back to this one.
  useEffect(() => {
    const onFocus = () => {
      const current = openRef.current;
      if (current) lookup(current.booking.id).then(setForms).catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [lookup]);

  const close = () => setOpen(null);
  const proceed = async () => {
    const current = open;
    close();
    if (current) await current.proceed();
  };

  /** Hand the customer a device: open the form page in a new tab (a blank one first, so it isn't blocked). */
  const fillInHere = async (groupId: string) => {
    if (!open?.booking.customer_id) return;
    setMessage(null); setBusy(groupId);
    const tab = window.open('', '_blank');
    try {
      const r = await startFormRequest(open.booking.customer_id, businessId, {
        group_id: groupId, channel: 'device', booking_id: open.booking.id,
      });
      if (tab && r.url) tab.location.href = r.url;
    } catch (err) {
      tab?.close();
      setMessage((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'The form could not be started.');
    } finally { setBusy(null); }
  };

  const prompt = open ? (
    <Modal open onClose={close} title="Forms still to complete" size="md" footer={(
      <div style={s.footer}>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant={forms.length === 0 ? 'primary' : 'secondary'} onClick={proceed}>
          {forms.length === 0 ? 'Check in' : 'Check in anyway'}
        </Button>
      </div>
    )}>
      {forms.length === 0 ? (
        <p role="status" style={s.done}>All the forms are complete. You can check in now.</p>
      ) : (
        <>
          <p style={s.lead}>
            {forms.length === 1 ? 'This customer has not completed this form' : 'This customer has not completed these forms'} for the appointment:
          </p>
          <ul style={s.list}>
            {forms.map((f) => (
              <li key={f.groupId} style={s.row}>
                <span style={s.name}>
                  {f.name}
                  {f.status === 'out_of_date' && <span style={s.tag}>out of date</span>}
                </span>
                <Button size="sm" variant="secondary" loading={busy === f.groupId} onClick={() => fillInHere(f.groupId)}>
                  Fill in on this device
                </Button>
              </li>
            ))}
          </ul>
          <p style={s.hint}>
            You can check in now and collect the {forms.length === 1 ? 'form' : 'forms'} later, or have the customer complete
            {forms.length === 1 ? ' it' : ' them'} first. This window updates when you come back.
          </p>
          <button type="button" style={s.link}
            onClick={() => { const c = open.booking.customer_id; close(); if (c) navigate(`/customers/${c}?tab=forms`); }}>
            Open the customer's forms
          </button>
        </>
      )}
      {message && <p role="alert" style={s.error}>{message}</p>}
    </Modal>
  ) : null;

  return { requestCheckIn, prompt };
}

const s: Record<string, React.CSSProperties> = {
  footer: { display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' },
  lead: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-base)', color: 'var(--color-text)', fontWeight: 600 },
  list: { listStyle: 'none', margin: '0 0 var(--space-md) 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap', padding: 'var(--space-sm) var(--space-md)', border: '1px solid var(--color-warning)', background: 'var(--color-warning-bg)', borderRadius: 'var(--radius-md)' },
  name: { display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', fontWeight: 600, color: 'var(--color-text)', flexWrap: 'wrap' },
  tag: { fontSize: 'var(--font-size-xs)', fontWeight: 400, padding: '1px 8px', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-warning)' },
  hint: { margin: '0 0 var(--space-sm) 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  done: { margin: 0, fontSize: 'var(--font-size-base)', color: 'var(--color-success)', fontWeight: 600 },
  link: { background: 'none', border: 'none', padding: 0, color: 'var(--color-accent)', cursor: 'pointer', font: 'inherit', fontSize: 'var(--font-size-sm)', fontWeight: 700 },
  error: { color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: 'var(--space-sm) 0 0 0' },
};
