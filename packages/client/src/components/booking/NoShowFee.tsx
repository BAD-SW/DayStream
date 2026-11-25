import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
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
  const { t } = useTranslation('calendar');
  if (failed) return <p style={styles.text}>{t('noShow.checkFailed')}</p>;
  if (!preview) return <p style={styles.text}>{t('noShow.checking')}</p>;
  if (preview.fee <= 0) return <p style={styles.text}>{t('noShow.noFee')}</p>;

  // Reserved with a membership or package: the no-show is charged to it, never to a card.
  if (preview.benefit) {
    const { name, kind } = preview.benefit;
    return (
      <>
        <p style={styles.text}>{t('noShow.benefitReserved', { kind: t(`noShow.kind.${kind}`), name })}</p>
        <RadioGroup
          label={t('noShow.chargeGroup')}
          name="no-show-fee"
          value={charge ? 'charge' : 'waive'}
          onChange={(v) => onChange(v === 'charge')}
          options={[
            { value: 'charge', label: kind === 'package' ? t('noShow.chargeToPackage', { name }) : t('noShow.chargeToMembership', { name }) },
            { value: 'waive', label: t('noShow.benefitGivenBack', { name }) },
          ]}
        />
      </>
    );
  }

  const fee = formatCurrency(preview.fee);
  const chargeLabel = preview.card
    ? t('noShow.chargeToCard', { fee, card: preview.card.label })
    : t('noShow.chargeNoCard', { fee });
  return (
    <>
      <p style={styles.text}>{t('noShow.feeIs', { fee })}</p>
      <RadioGroup
        label={t('noShow.feeGroup')}
        name="no-show-fee"
        value={charge ? 'charge' : 'waive'}
        onChange={(v) => onChange(v === 'charge')}
        options={[{ value: 'charge', label: chargeLabel }, { value: 'waive', label: t('noShow.noCharge') }]}
      />
    </>
  );
}

/** What happened to the fee, in a sentence for staff. */
export function noShowOutcomeText(fee: NoShowFeeOutcome | undefined): string {
  const t = (key: string, values?: Record<string, unknown>) => i18n.t(`calendar:${key}`, values) as string;
  if (!fee || fee.status === 'none') return t('noShow.outcome.marked');
  if (fee.status === 'benefit') return t('noShow.outcome.benefit', { name: fee.benefit?.name || t('noShow.outcome.benefitFallback') });
  if (fee.status === 'waived' && fee.benefit) return t('noShow.outcome.benefitGivenBack', { name: fee.benefit.name });
  const amount = formatCurrency(fee.amount);
  if (fee.status === 'waived') return t('noShow.outcome.waived', { amount });
  if (fee.status === 'charged') return fee.card_label ? t('noShow.outcome.chargedToCard', { amount, card: fee.card_label }) : t('noShow.outcome.charged', { amount });
  const why = fee.reason === 'declined'
    ? (fee.card_label ? t('noShow.outcome.declinedCard', { card: fee.card_label }) : t('noShow.outcome.declined'))
    : fee.reason === 'no_customer' ? t('noShow.outcome.noCustomer') : t('noShow.outcome.noCard');
  return fee.order_number ? t('noShow.outcome.unpaidOrder', { why, amount, order: fee.order_number }) : t('noShow.outcome.unpaid', { why, amount });
}

/** The Bookings list's No-show dialog. */
export function NoShowModal({ booking, businessId, onClose, onDone }: {
  booking: { id: string } | null;
  businessId: string;
  onClose: () => void;
  onDone: (result: { ok: boolean; text: string; orderId?: string }) => void;
}) {
  const { t } = useTranslation('calendar');
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
      onDone({ ok: false, text: e?.response?.data?.error || t('noShow.markFailed') });
    } finally { setSaving(false); onClose(); }
  };

  return (
    <Modal open={!!booking} onClose={onClose} title={t('noShow.modalTitle')} size="sm"
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t('common:cancel')}</Button>
        <Button variant="destructive" onClick={confirm} disabled={saving || (!preview && !failed)}>
          {saving ? t('noShow.working') : hasFee && charge ? t('noShow.chargeAndMark') : t('noShow.mark')}
        </Button>
      </>}>
      <NoShowFeeChoice preview={preview} failed={failed} charge={charge} onChange={setCharge} />
    </Modal>
  );
}

const styles: Record<string, React.CSSProperties> = {
  text: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-md)' },
};
