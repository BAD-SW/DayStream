import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('calendar');
  const [refundTo, setRefundTo] = useState<RefundTo>('original');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const options: Array<{ value: RefundTo; label: string }> = [
    { value: 'original', label: t('removeAddon.refundToPayment', { amount: formatCurrency(amount) }) },
    ...(hasCustomer ? [{ value: 'account_credit' as RefundTo, label: t('removeAddon.refundAsCredit', { amount: formatCurrency(amount) }) }] : []),
    { value: 'none', label: t('removeAddon.noRefund') },
  ];

  const remove = async () => {
    setBusy(true); setErr('');
    try {
      const r = await bookingsApi.removePaidAddon(bookingId, businessId, bookingAddonId, refundTo, reason.trim() || undefined);
      const refunded = r.refund?.amount ? formatCurrency(r.refund.amount) : null;
      onDone(refunded
        ? t(refundTo === 'account_credit' ? 'removeAddon.doneRefundedCredit' : 'removeAddon.doneRefundedPayment', { name, amount: refunded })
        : t(refundTo === 'none' ? 'removeAddon.doneNotRefunded' : 'removeAddon.done', { name }));
    } catch (e: any) {
      const m = e?.response?.data?.error; setErr(typeof m === 'string' ? m : t('removeAddon.failed'));
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={t('removeAddon.title', { name })} size="sm"
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t('removeAddon.keep')}</Button>
        <Button variant="destructive" onClick={remove} loading={busy}>{t('removeAddon.remove')}</Button>
      </>}>
      <div style={styles.form}>
        {err && <Alert variant="error">{err}</Alert>}
        <p style={styles.text}>{t('removeAddon.paidAtReservation', { name, amount: formatCurrency(amount) })}</p>
        <RadioGroup label={t('removeAddon.refund')} name="remove-addon-refund" value={refundTo} onChange={(v) => setRefundTo(v as RefundTo)} options={options} />
        <Textarea label={t('removeAddon.reason')} name="remove-addon-reason" value={reason} onChange={setReason} rows={2}
          helperText={t('removeAddon.reasonHelper')} />
        <p style={styles.text}>{t('removeAddon.refundNote')}</p>
      </div>
    </Modal>
  );
}

const styles: Record<string, React.CSSProperties> = {
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' },
  text: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: 0 },
};
