import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../design-system/components/actions/Button';
import { Modal } from '../../design-system/components/feedback/Modal';
import { getCustomerForms, startFormRequest } from '../../api/forms';
import type { CustomerFormStatus } from '../../api/forms';
import { FormFillModal } from './FormFillModal';

/**
 * The forms a customer still has to complete, with a button to fill each one in on this device,
 * all in a window over the current page (spec 51, gap 3). Nothing here navigates away, so staff
 * keep their place on the waiting list, in a booking, or while making an appointment.
 *
 * Context decides which forms apply, as in the profile notice: a `bookingId` for an existing
 * booking, a `serviceId` while one is being made, or neither.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  customerId: string;
  businessId: string;
  bookingId?: string;
  serviceId?: string;
  /** Called after a form was submitted, so the page behind can refresh. */
  onChanged?: () => void;
}

export function FormsToCompleteModal({ open, onClose, customerId, businessId, bookingId, serviceId, onChanged }: Props) {
  const [forms, setForms] = useState<CustomerFormStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fill, setFill] = useState<{ url: string; name: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await getCustomerForms(customerId, businessId, bookingId, serviceId);
      setForms(d.forms.filter((f) => f.status === 'missing' || f.status === 'out_of_date'));
    } catch {
      setForms([]);
    } finally {
      setLoading(false);
    }
  }, [customerId, businessId, bookingId, serviceId]);

  useEffect(() => { if (open) { setLoading(true); setError(null); setFill(null); load(); } }, [open, load]);

  const fillIn = async (f: CustomerFormStatus) => {
    setBusy(f.groupId); setError(null);
    try {
      const r = await startFormRequest(customerId, businessId, { group_id: f.groupId, channel: 'device', booking_id: bookingId ?? null });
      if (!r.url) throw new Error('no link');
      setFill({ url: r.url, name: f.name });
    } catch (err) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'The form could not be started.');
    } finally { setBusy(null); }
  };

  const done = () => {
    setFill(null);
    onChanged?.();
    load();
  };

  if (!open) return null;
  if (fill) return <FormFillModal url={fill.url} title={fill.name} onClose={() => setFill(null)} onDone={done} />;

  return (
    <Modal open onClose={onClose} title="Forms to complete" size="md" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {loading ? (
        <p style={s.muted} role="status">Loading…</p>
      ) : forms.length === 0 ? (
        <p role="status" style={s.done}>All the forms are complete.</p>
      ) : (
        <>
          <p style={s.lead}>{forms.length === 1 ? 'This form is' : 'These forms are'} still to complete:</p>
          <ul style={s.list}>
            {forms.map((f) => (
              <li key={f.groupId} style={s.row}>
                <span style={s.name}>
                  {f.name}
                  {f.status === 'out_of_date' && <span style={s.tag}>out of date</span>}
                </span>
                <Button size="sm" variant="secondary" loading={busy === f.groupId} onClick={() => fillIn(f)}>Fill in now</Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p role="alert" style={s.error}>{error}</p>}
    </Modal>
  );
}

const s: Record<string, React.CSSProperties> = {
  muted: { margin: 0, color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
  lead: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-base)', color: 'var(--color-text)', fontWeight: 600 },
  done: { margin: 0, fontSize: 'var(--font-size-base)', color: 'var(--color-success)', fontWeight: 600 },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap', padding: 'var(--space-sm) var(--space-md)', border: '1px solid var(--color-warning)', background: 'var(--color-warning-bg)', borderRadius: 'var(--radius-md)' },
  name: { display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', fontWeight: 600, color: 'var(--color-text)', flexWrap: 'wrap' },
  tag: { fontSize: 'var(--font-size-xs)', fontWeight: 400, padding: '1px 8px', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-warning)' },
  error: { color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: 'var(--space-sm) 0 0 0' },
};
