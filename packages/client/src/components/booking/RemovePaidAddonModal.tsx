import { useState } from 'react';
import { Modal } from '../../design-system/components/feedback/Modal';
import { Button } from '../../design-system/components/actions/Button';
import { RadioGroup } from '../../design-system/components/forms/RadioGroup';
import { Textarea } from '../../design-system/components/forms/Textarea';
import { Alert } from '../../design-system/components/feedback/Alert';
import { formatCurrency } from '../../utils/currency';
import * as bookingsApi from '../../api/bookings';

type RefundTo = 'original' | 'account_credit' | 'none';

/**
 * Remove an add-on that was already paid (spec 51, gap 15): it was not available on the day. Staff
 * choose the refund: to the payment, as account credit, or none (an alternative is given). The
 * refund is made first; if it fails, nothing changes.
 */
export function RemovePaidAddonModal({ bookingId, businessId, bookingAddonId, name, amount, hasCustomer, onClose, onDone }: {
  bookingId: string; businessId: string; bookingAddonId: string;
  name: string; amount: number; hasCustomer: boolean;
  onClose: () => void; onDone: (message: string) => void;
}) {
  const [refundTo, setRefundTo] = useState<RefundTo>('original');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const options: Array<{ value: RefundTo; label: string }> = [
    { value: 'original', label: `Refund ${formatCurrency(amount)} to the payment` },
    ...(hasCustomer ? [{ value: 'account_credit' as RefundTo, label: `Refund ${formatCurrency(amount)} as account credit` }] : []),
    { value: 'none', label: 'No refund (an alternative is given)' },
  ];

  const remove = async () => {
    setBusy(true); setErr('');
    try {
      const r = await bookingsApi.removePaidAddon(bookingId, businessId, bookingAddonId, refundTo, reason.trim() || undefined);
      const refunded = r.refund?.amount ? formatCurrency(r.refund.amount) : null;
      onDone(`${name} removed${refunded ? `, ${refunded} refunded${refundTo === 'account_credit' ? ' as account credit' : ' to the payment'}` : refundTo === 'none' ? ', not refunded' : ''}.`);
    } catch (e: any) {
      const m = e?.response?.data?.error; setErr(typeof m === 'string' ? m : 'The add-on could not be removed.');
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Remove ${name}`} size="sm"
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Keep it</Button>
        <Button variant="destructive" onClick={remove} loading={busy}>Remove add-on</Button>
      </>}>
      <div style={styles.form}>
        {err && <Alert variant="error">{err}</Alert>}
        <p style={styles.text}>{name} was paid at reservation ({formatCurrency(amount)}).</p>
        <RadioGroup label="Refund" name="remove-addon-refund" value={refundTo} onChange={(v) => setRefundTo(v as RefundTo)} options={options} />
        <Textarea label="Reason" name="remove-addon-reason" value={reason} onChange={setReason} rows={2}
          helperText="Optional, for example not available today. Kept in the appointment's history." />
        <p style={styles.text}>The refund is made now. To give an alternative, add it to this visit after this.</p>
      </div>
    </Modal>
  );
}

const styles: Record<string, React.CSSProperties> = {
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' },
  text: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: 0 },
};
