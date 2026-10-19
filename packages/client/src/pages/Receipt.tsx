import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import * as checkoutApi from '../api/checkout';
import type { Order } from '../api/checkout';
import * as payApi from '../api/payments';
import type { ReceiptDocumentFields } from '../api/payments';
import { BrandedDocumentView } from '../components/BrandedDocumentView';
import { RefundOrderModal } from '../components/RefundOrderModal';

// i18n-ready labels — extract to a translation file later
const labels = {
  back: '← Back',
  print: 'Print',
  email: 'Email Receipt',
  emailSent: 'Receipt emailed successfully',
  emailFailed: 'Failed to send receipt email',
  noCustomerEmail: 'No customer email available for this order',
  loading: 'Loading receipt...',
  notFound: 'Order not found',
};

export function Receipt() {
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
      alert('No payment found for this order, or the receipt could not be produced.');
    }
  };

  // Email = the branded receipt, sent to the customer on file.
  const handleEmail = async () => {
    if (!order) return;
    setEmailing(true);
    try {
      const { emailOrderReceipt } = await import('../api/payments');
      await emailOrderReceipt(order.id, businessId);
      alert(labels.emailSent);
    } catch (err: any) {
      alert(err?.response?.data?.code === 'NO_RECIPIENT'
        ? labels.noCustomerEmail
        : labels.emailFailed);
    } finally {
      setEmailing(false);
    }
  };

  if (loading) return <div style={styles.page}><p style={styles.loading}>{labels.loading}</p></div>;
  if (!order) return <div style={styles.page}><p>{labels.notFound}</p></div>;

  return (
    <div style={styles.page}>
      {/* Action buttons (hidden on print) */}
      <div style={styles.actions} className="no-print">
        <Button variant="secondary" size="sm" onClick={() => navigate(-1 as any)}>{labels.back}</Button>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(order.status === 'completed' || order.status === 'partially_refunded')
            && order.items.some((it) => checkoutApi.REFUNDABLE_ITEM_TYPES.has(it.item_type) && it.quantity - (it.refunded_quantity || 0) > 0) && (
            <Button variant="destructive" size="sm" onClick={() => setShowRefund(true)}>Refund</Button>
          )}
          <Button size="sm" onClick={handlePrint}>{labels.print}</Button>
          <Button variant="secondary" size="sm" onClick={handleEmail} loading={emailing}>{labels.email}</Button>
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
        <p style={styles.loading}>No receipt is available for this order.</p>
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
