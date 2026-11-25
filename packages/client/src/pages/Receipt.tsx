import { showMessage } from '../design-system/components/feedback/dialogs';
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../design-system/components/actions/Button';
import * as checkoutApi from '../api/checkout';
import type { Order } from '../api/checkout';
import * as payApi from '../api/payments';
import type { ReceiptDocumentFields } from '../api/payments';
import { BrandedDocumentView } from '../components/BrandedDocumentView';
import { RefundOrderModal } from '../components/RefundOrderModal';

export function Receipt() {
  const { t } = useTranslation('portal');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  // The resolved, placeholder-filled branded receipt (the business's template).
  const [receiptFields, setReceiptFields] = useState<ReceiptDocumentFields | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailing, setEmailing] = useState(false);

  const [showRefund, setShowRefund] = useState(false);

  const businessId = localStorage.getItem('business_id') || '';

  const reloadOrder = () => {
    if (!id) return;
    checkoutApi.getOrder(id).then(setOrder).catch(() => {});
  };

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    checkoutApi.getOrder(id).then(setOrder).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  // Load the branded receipt (the business's template, placeholder-filled). This
  // is the SAME document produced for print/email — so the on-screen view matches.
  useEffect(() => {
    if (!id || !businessId) return;
    payApi.fetchOrderReceiptFields(id, businessId).then(setReceiptFields).catch(() => setReceiptFields(null));
  }, [id, businessId]);

  // Print = the BRANDED receipt (same template-driven document as everywhere else),
  // not this page's on-screen order summary. One receipt, matching the business's template.
  const handlePrint = async () => {
    if (!order) return;
    try {
      const { fetchOrderReceiptPdf } = await import('../api/payments');
      const blob = await fetchOrderReceiptPdf(order.id, businessId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      void showMessage({ message: t('receipt.printFailed'), tone: 'error' });
    }
  };

  // Email = the branded receipt, sent to the customer on file.
  const handleEmail = async () => {
    if (!order) return;
    setEmailing(true);
    try {
      const { emailOrderReceipt } = await import('../api/payments');
      await emailOrderReceipt(order.id, businessId);
      void showMessage({ message: t('receipt.emailSent'), tone: 'success' });
    } catch (err: any) {
      void showMessage({ message: err?.response?.data?.code === 'NO_RECIPIENT'
        ? t('receipt.noCustomerEmail')
        : t('receipt.emailFailed'), tone: 'error' });
    } finally {
      setEmailing(false);
    }
  };

  if (loading) return <div style={styles.page}><p style={styles.loading}>{t('receipt.loading')}</p></div>;
  if (!order) return <div style={styles.page}><p>{t('receipt.notFound')}</p></div>;

  return (
    <div style={styles.page}>
      {/* Action buttons (hidden on print) */}
      <div style={styles.actions} className="no-print">
        <Button variant="secondary" size="sm" onClick={() => navigate(-1 as any)}>{t('receipt.back')}</Button>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(order.status === 'completed' || order.status === 'partially_refunded')
            && (order.items.some((it) => checkoutApi.REFUNDABLE_ITEM_TYPES.has(it.item_type) && it.quantity - (it.refunded_quantity || 0) > 0)
              // a tip left to refund (spec 51, gap 14)
              || (order.tip_amount || 0) - (order.tip_refunded_cents || 0) > 0) && (
            <Button variant="destructive" size="sm" onClick={() => setShowRefund(true)}>{t('receipt.refund')}</Button>
          )}
          <Button variant="secondary" size="sm" onClick={handlePrint}>{t('receipt.print')}</Button>
          <Button variant="secondary" size="sm" onClick={handleEmail} loading={emailing}>{t('receipt.email')}</Button>
          {/* The sale is finished: back to the Bookings screen, ready for the next customer. */}
          <Button size="sm" onClick={() => navigate('/bookings')}>{t('receipt.done')}</Button>
        </div>
      </div>

      {showRefund && (
        <RefundOrderModal
          order={order}
          businessId={businessId}
          onClose={() => setShowRefund(false)}
          onRefunded={() => { setShowRefund(false); reloadOrder(); }}
        />
      )}

      {/* The receipt on screen IS the business's branded template (same document
          produced for print/email), placeholder-filled with this order's values. */}
      {receiptFields ? (
        <BrandedDocumentView fields={receiptFields} />
      ) : (
        <p style={styles.loading}>{t('receipt.unavailable')}</p>
      )}
    </div>
  );
}

// ============================================================
// Styles
// ============================================================

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '600px', margin: '0 auto', overflow: 'visible' },
  loading: { textAlign: 'center', color: 'var(--color-text-secondary)' },
  actions: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
};
