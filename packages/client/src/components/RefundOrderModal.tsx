import { useState, useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { Modal } from '../design-system/components/feedback/Modal';
import { Button } from '../design-system/components/actions/Button';
import * as checkoutApi from '../api/checkout';
import type { Order, OrderItem } from '../api/checkout';
import { formatCurrency } from '../utils/currency';
import { CurrencyInput } from './CurrencyInput';

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
  const { t } = useTranslation('checkout');
  const [order, setOrder] = useState<Order | null>(orderProp ?? null);
  const [loading, setLoading] = useState(!orderProp);
  const [qty, setQty] = useState<Record<string, number>>({});
  // A product taken from stock goes back into stock unless staff write it off (spec 51, gap 7).
  const [writeOff, setWriteOff] = useState<Record<string, boolean>>({});
  // The tip, refunded as its own line (spec 51, gap 14): how much of what is left.
  const [tipRefund, setTipRefund] = useState(0);
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
      .catch(() => setError(t('refund.loadFailed')))
      .finally(() => setLoading(false));
  }, [orderProp, orderId]);

  const refundable: OrderItem[] = (order?.items ?? []).filter(
    (it) => checkoutApi.REFUNDABLE_ITEM_TYPES.has(it.item_type) && it.quantity - (it.refunded_quantity || 0) > 0,
  );

  const remainingOf = (it: OrderItem) => it.quantity - (it.refunded_quantity || 0);
  const perUnit = (it: OrderItem) => Math.round(it.total_price / it.quantity);
  const tipLeft = Math.max(0, (order?.tip_amount || 0) - (order?.tip_refunded_cents || 0));
  const estTotal = refundable.reduce((sum, it) => sum + perUnit(it) * (qty[it.id] || 0), 0) + Math.min(tipRefund, tipLeft);
  const anySelected = refundable.some((it) => (qty[it.id] || 0) > 0) || tipRefund > 0;

  const setLineQty = (id: string, v: number, max: number) =>
    setQty((prev) => ({ ...prev, [id]: Math.max(0, Math.min(max, v)) }));

  const submit = async () => {
    if (!order) return;
    if (!reason.trim()) { setError(t('refund.reasonRequired')); return; }
    const lines = refundable
      .filter((it) => (qty[it.id] || 0) > 0)
      .map((it) => ({ order_item_id: it.id, quantity: qty[it.id], ...(it.from_stock ? { restock: !writeOff[it.id] } : {}) }));
    if (lines.length === 0 && tipRefund <= 0) { setError(t('refund.selectOne')); return; }
    setBusy(true); setError(null);
    try {
      const res = await checkoutApi.refundOrder(order.id, businessId, reason.trim(), lines, Math.min(tipRefund, tipLeft));
      if (res.status === 'failed') { setError(res.failureReason || t('refund.declined')); return; }
      onRefunded();
    } catch (err: any) {
      setError(err?.response?.data?.error || t('refund.failed'));
    } finally { setBusy(false); }
  };

  const title = order ? t('refund.titleOrder', { number: order.order_number }) : t('refund.title');

  return (
    <Modal open onClose={onClose} title={title}
      footer={<>
        <Button variant="outline" onClick={onClose}>{t('common:cancel')}</Button>
        <Button variant="destructive" loading={busy} disabled={loading || !order || (refundable.length === 0 && tipLeft === 0)} onClick={submit}>
          {estTotal > 0 ? t('refund.buttonAmount', { amount: formatCurrency(estTotal) }) : t('refund.title')}
        </Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {loading ? (
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>{t('refund.loadingOrder')}</p>
        ) : !order ? (
          <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: 0 }}>{error || t('refund.notFound')}</p>
        ) : refundable.length === 0 && tipLeft === 0 ? (
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
            {t('refund.nothingLeft')}
          </p>
        ) : (
          <>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
              {t(order.payment_method === 'card' ? 'refund.chooseCard' : 'refund.chooseManual')}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {refundable.map((it) => {
                const rem = remainingOf(it);
                const askStock = !!it.from_stock && (qty[it.id] || 0) > 0;
                return (
                  <div key={it.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{it.item_name}{it.variant_name ? ` (${it.variant_name})` : ''}</span>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                        {t('refund.lineDetail', { price: formatCurrency(perUnit(it)), remaining: rem, quantity: it.quantity })}
                      </span>
                      {askStock && (
                        <span role="radiogroup" aria-label={t('refund.returnedLabel', { name: it.item_name })} style={{ display: 'flex', gap: 'var(--space-md)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text)' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                            <input type="radio" name={`stock-${it.id}`} checked={!writeOff[it.id]} onChange={() => setWriteOff((p) => ({ ...p, [it.id]: false }))} />
                            {t('refund.backIntoStock')}
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                            <input type="radio" name={`stock-${it.id}`} checked={!!writeOff[it.id]} onChange={() => setWriteOff((p) => ({ ...p, [it.id]: true }))} />
                            {t('refund.writeOff')}
                          </label>
                        </span>
                      )}
                    </div>
                    <input
                      type="number" min={0} max={rem}
                      value={qty[it.id] || 0}
                      onChange={(e) => setLineQty(it.id, parseInt(e.target.value, 10) || 0, rem)}
                      style={{ width: '64px', padding: '8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' }}
                      aria-label={t('refund.quantityLabel', { name: it.item_name })}
                    />
                  </div>
                );
              })}
              {tipLeft > 0 && (
                // The tip is its own line: refunding items never refunds it (spec 51, gap 14).
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{t('tip.title')}</span>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                      {t('refund.tipRefundable', { amount: formatCurrency(tipLeft) })}
                    </span>
                  </div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                    <CurrencyInput value={tipRefund} onChange={(v) => setTipRefund(Math.max(0, Math.min(v, tipLeft)))} style={{ width: '90px' }} />
                    <button type="button" onClick={() => setTipRefund(tipLeft)}
                      style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 'var(--font-size-xs)', padding: 0, fontFamily: 'var(--font-family)' }}>{t('refund.all')}</button>
                  </span>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>{t('refund.reason')} <span style={{ color: 'var(--color-error)' }}>*</span></label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('refund.reasonPlaceholder')}
                style={{ padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' }}
              />
            </div>

            {anySelected && (
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
                <Trans t={t} i18nKey="refund.estimated" values={{ amount: formatCurrency(estTotal) }} components={[<strong key="s" />]} />
              </p>
            )}
            {error && <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: 0 }}>{error}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
