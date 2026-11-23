import { useEffect, useState } from 'react';
import { Modal } from '../../design-system/components/feedback/Modal';
import { Button } from '../../design-system/components/actions/Button';
import { RadioGroup } from '../../design-system/components/forms/RadioGroup';
import { formatCurrency } from '../../utils/currency';
import * as bookingsApi from '../../api/bookings';
import type { NoShowPreview, NoShowFeeOutcome } from '../../api/bookings';

/**
 * The no-show fee is the owner's call each time (spec 51, requirement 5): the option's fee is
 * offered, with the card it would go to, and staff choose to charge it or not.
 */

/** Loads what marking this booking a no-show would charge, and to which card. */
export function useNoShowPreview(bookingId: string | null, businessId: string) {
  const [preview, setPreview] = useState<NoShowPreview | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setPreview(null); setFailed(false);
    if (!bookingId) return;
    let live = true;
    bookingsApi.getNoShowPreview(bookingId, businessId)
      .then((p) => { if (live) setPreview(p); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [bookingId, businessId]);
  return { preview, failed };
}

/** The charge / no charge choice, with what charging would actually do. */
export function NoShowFeeChoice({ preview, failed, charge, onChange }: {
  preview: NoShowPreview | null; failed: boolean; charge: boolean; onChange: (charge: boolean) => void;
}) {
  if (failed) return <p style={styles.text}>The no-show fee could not be checked. Marking the no-show still works.</p>;
  if (!preview) return <p style={styles.text}>Checking the no-show fee…</p>;
  if (preview.fee <= 0) return <p style={styles.text}>No no-show fee is set for this option, so nothing is charged. The time is freed.</p>;

  // Reserved with a membership or package: the no-show is charged to it, never to a card.
  if (preview.benefit) {
    const { name, kind } = preview.benefit;
    return (
      <>
        <p style={styles.text}>This appointment was reserved with the {kind} {name}. A no-show is charged to it, not to a card. The time is freed.</p>
        <RadioGroup
          label="No-show charge"
          name="no-show-fee"
          value={charge ? 'charge' : 'waive'}
          onChange={(v) => onChange(v === 'charge')}
          options={[
            { value: 'charge', label: kind === 'package' ? `Charge to ${name}: the session held for it is used` : `Charge to ${name}: it counts as a visit` },
            { value: 'waive', label: `No charge: ${name} is given back` },
          ]}
        />
      </>
    );
  }

  const fee = formatCurrency(preview.fee);
  const chargeLabel = preview.card
    ? `Charge ${fee} to ${preview.card.label}`
    : `Charge ${fee}. There is no card on file, so it is left as an open order to collect at Checkout`;
  return (
    <>
      <p style={styles.text}>The no-show fee for this option is {fee}. The time is freed.</p>
      <RadioGroup
        label="No-show fee"
        name="no-show-fee"
        value={charge ? 'charge' : 'waive'}
        onChange={(v) => onChange(v === 'charge')}
        options={[{ value: 'charge', label: chargeLabel }, { value: 'waive', label: 'No charge' }]}
      />
    </>
  );
}

/** What happened to the fee, in a sentence for staff. */
export function noShowOutcomeText(fee: NoShowFeeOutcome | undefined): string {
  if (!fee || fee.status === 'none') return 'Marked as no-show.';
  if (fee.status === 'benefit') return `Marked as no-show. Charged to ${fee.benefit?.name || 'the membership or package'}; no card was charged.`;
  if (fee.status === 'waived' && fee.benefit) return `Marked as no-show. Not charged: ${fee.benefit.name} was given back.`;
  const amount = formatCurrency(fee.amount);
  if (fee.status === 'waived') return `Marked as no-show. The ${amount} fee was not charged.`;
  if (fee.status === 'charged') return `Marked as no-show. ${amount} charged${fee.card_label ? ` to ${fee.card_label}` : ''}.`;
  const why = fee.reason === 'declined'
    ? `The card${fee.card_label ? ` (${fee.card_label})` : ''} was declined`
    : fee.reason === 'no_customer' ? 'There is no customer to charge' : 'There is no card on file';
  return `Marked as no-show. ${why}, so ${amount} was not charged. It is waiting${fee.order_number ? ` as order ${fee.order_number}` : ''} to collect at Checkout.`;
}

/** The Bookings list's No-show dialog. */
export function NoShowModal({ booking, businessId, onClose, onDone }: {
  booking: { id: string } | null;
  businessId: string;
  onClose: () => void;
  onDone: (result: { ok: boolean; text: string; orderId?: string }) => void;
}) {
  const { preview, failed } = useNoShowPreview(booking?.id ?? null, businessId);
  const [charge, setCharge] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setCharge(true); }, [booking?.id]);

  const hasFee = !!preview && preview.fee > 0;
  const confirm = async () => {
    if (!booking) return;
    setSaving(true);
    try {
      const r = await bookingsApi.noShowBooking(booking.id, businessId, !hasFee || charge);
      onDone({ ok: r.fee?.status !== 'unpaid', text: noShowOutcomeText(r.fee), orderId: r.fee?.status === 'unpaid' ? r.fee.order_id : undefined });
    } catch (e: any) {
      onDone({ ok: false, text: e?.response?.data?.error || 'The no-show could not be marked. Please try again.' });
    } finally { setSaving(false); onClose(); }
  };

  return (
    <Modal open={!!booking} onClose={onClose} title="Mark as No-Show" size="sm"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="destructive" onClick={confirm} disabled={saving || (!preview && !failed)}>
          {saving ? 'Working…' : hasFee && charge ? 'Charge & Mark No-Show' : 'Mark No-Show'}
        </Button>
      </>}>
      <NoShowFeeChoice preview={preview} failed={failed} charge={charge} onChange={setCharge} />
    </Modal>
  );
}

const styles: Record<string, React.CSSProperties> = {
  text: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-md)' },
};
