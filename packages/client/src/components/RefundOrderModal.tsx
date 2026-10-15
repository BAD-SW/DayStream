import { useState, useEffect } from 'react';
import { Modal } from '../design-system/components/feedback/Modal';
import { Button } from '../design-system/components/actions/Button';
import * as checkoutApi from '../api/checkout';
import type { Order, OrderItem } from '../api/checkout';
import { formatCurrency } from '../utils/currency';

/**
 * RefundOrderModal — line-item (order) refund, shared by the Receipt page and the
 * customer Billing tab so the behavior is identical everywhere.
 *
 * Accepts an order (if the caller already has it) OR an orderId it loads itself.
 * Lists each REFUNDABLE line (product / no-show fee) with its remaining quantity;
 * staff pick how many of each to return. The server computes the per-line amount,
 * reverses the card, posts the per-line GL reversal, and sets the order status.
 */
interface Props {
  businessId: string;
  order?: Order;
  orderId?: string;
  onClose: () => void;
  onRefunded: () => void;
}

export function RefundOrderModal({ businessId, order: orderProp, orderId, onClose, onRefunded }: Props) {
  const [order, setOrder] = useState<Order | null>(orderProp ?? null);
  const [loading, setLoading] = useState(!orderProp);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the order if only an id was given (Billing-tab path).
  useEffect(() => {
    if (orderProp) { setOrder(orderProp); return; }
    const id = orderId;
    if (!id) return;
    setLoading(true);
    checkoutApi.getOrder(id)
      .then((o) => setOrder(o))
      .catch(() => setError('Could not load the order.'))
      .finally(() => setLoading(false));
  }, [orderProp, orderId]);

  const refundable: OrderItem[] = (order?.items ?? []).filter(
    (it) => checkoutApi.REFUNDABLE_ITEM_TYPES.has(it.item_type) && it.quantity - (it.refunded_quantity || 0) > 0,
  );

  const remainingOf = (it: OrderItem) => it.quantity - (it.refunded_quantity || 0);
  const perUnit = (it: OrderItem) => Math.round(it.total_price / it.quantity);
  const estTotal = refundable.reduce((sum, it) => sum + perUnit(it) * (qty[it.id] || 0), 0);
  const anySelected = refundable.some((it) => (qty[it.id] || 0) > 0);

  const setLineQty = (id: string, v: number, max: number) =>
    setQty((prev) => ({ ...prev, [id]: Math.max(0, Math.min(max, v)) }));

  const submit = async () => {
    if (!order) return;
    if (!reason.trim()) { setError('A reason is required.'); return; }
    const lines = refundable
      .filter((it) => (qty[it.id] || 0) > 0)
      .map((it) => ({ order_item_id: it.id, quantity: qty[it.id] }));
    if (lines.length === 0) { setError('Select at least one item to refund.'); return; }
    setBusy(true); setError(null);
    try {
      const res = await checkoutApi.refundOrder(order.id, businessId, reason.trim(), lines);
      if (res.status === 'failed') { setError(res.failureReason || 'The refund was declined.'); return; }
      onRefunded();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to process the refund.');
    } finally { setBusy(false); }
  };

  const title = order ? `Refund — Order ${order.order_number}` : 'Refund';

  return (
    <Modal open onClose={onClose} title={title}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="destructive" loading={busy} disabled={loading || !order || refundable.length === 0} onClick={submit}>
          Refund {estTotal > 0 ? formatCurrency(estTotal) : ''}
        </Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {loading ? (
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>Loading order…</p>
        ) : !order ? (
          <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: 0 }}>{error || 'Order not found.'}</p>
        ) : refundable.length === 0 ? (
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
            Nothing left to refund on this order. (Services, memberships, packages and gift cards are not refundable.)
          </p>
        ) : (
          <>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
              Choose how many of each item to return.
              {order.payment_method === 'card' ? ' The card will be refunded.' : ' Recorded as refunded (manual payment).'}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {refundable.map((it) => {
                const rem = remainingOf(it);
                return (
                  <div key={it.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{it.item_name}</span>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                        {formatCurrency(perUnit(it))} each · {rem} of {it.quantity} refundable
                      </span>
                    </div>
                    <input
                      type="number" min={0} max={rem}
                      value={qty[it.id] || 0}
                      onChange={(e) => setLineQty(it.id, parseInt(e.target.value, 10) || 0, rem)}
                      style={{ width: '64px', padding: '8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' }}
                      aria-label={`Quantity to refund for ${it.item_name}`}
                    />
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Reason <span style={{ color: 'var(--color-error)' }}>*</span></label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. customer returned product"
                style={{ padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' }}
              />
            </div>

            {anySelected && (
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
                Estimated refund: <strong>{formatCurrency(estTotal)}</strong> (final amount uses each line's recorded price &amp; tax).
              </p>
            )}
            {error && <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: 0 }}>{error}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
