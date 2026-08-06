import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import * as checkoutApi from '../api/checkout';
import type { Order } from '../api/checkout';
import { formatCurrency } from '../utils/currency';

// i18n-ready labels — extract to a translation file later
const labels = {
  receipt: 'Receipt',
  order: 'Order',
  date: 'Date',
  time: 'Time',
  customer: 'Customer',
  item: 'Item',
  qty: 'Qty',
  price: 'Price',
  total: 'Total',
  subtotal: 'Subtotal',
  discount: 'Discount',
  tax: 'Tax',
  paymentMethod: 'Payment Method',
  reference: 'Reference',
  thankYou: 'Thank you for your visit!',
  back: '← Back',
  print: 'Print',
  email: 'Email Receipt',
  emailSent: 'Receipt emailed successfully',
  emailFailed: 'Failed to send receipt email',
  noCustomerEmail: 'No customer email available for this order',
  loading: 'Loading receipt...',
  notFound: 'Order not found',
};

interface BusinessInfo {
  name: string;
  logo_url?: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state_province: string;
  postal_code: string;
  phone: string;
  email: string;
}

export function Receipt() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailing, setEmailing] = useState(false);

  const businessId = localStorage.getItem('business_id') || '';

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    checkoutApi.getOrder(id).then(setOrder).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!businessId) return;
    import('../api/client').then(({ apiClient }) => {
      // Load business info from locations (primary location = business address)
      apiClient.get(`/v1/locations?business_id=${businessId}`).then((res) => {
        const locs = res.data.data || [];
        const primary = locs.find((l: any) => l.is_primary) || locs[0];
        if (primary) {
          setBusiness({
            name: primary.name,
            address_line1: primary.address_line1 || '',
            address_line2: primary.address_line2 || '',
            city: primary.city || '',
            state_province: primary.state_province || '',
            postal_code: primary.postal_code || '',
            phone: primary.phone || '',
            email: primary.email || '',
          });
        }
      }).catch(() => {});
      // TODO: Load logo_url from business/tenant configuration when available
    });
  }, [businessId]);

  const handlePrint = () => {
    const receiptEl = document.getElementById('receipt-content');
    if (!receiptEl) return;
    const printWindow = window.open('', '_blank', 'width=600,height=800');
    if (!printWindow) return;
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Receipt - ${order?.order_number || ''}</title>
        <style>
          body { font-family: 'Inter', -apple-system, sans-serif; margin: 0; padding: 20px; color: #333; font-size: 13px; line-height: 1.6; }
          h1 { font-size: 20px; font-weight: 700; margin: 0 0 4px; color: #1a1a1a; }
          table { width: 100%; border-collapse: collapse; margin: 8px 0; }
          th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; color: #666; padding: 6px 0; border-bottom: 1px solid #ddd; }
          th.right, td.right { text-align: right; }
          td { padding: 8px 0; font-size: 13px; border-bottom: 1px solid #f0f0f0; }
          .center { text-align: center; }
          .divider { border: none; border-top: 1px dashed #ccc; margin: 12px 0; }
          .info-row { display: flex; justify-content: space-between; margin: 4px 0; }
          .total-row { display: flex; justify-content: space-between; margin: 4px 0; }
          .grand-total { display: flex; justify-content: space-between; font-weight: 700; font-size: 16px; border-top: 2px solid #333; padding-top: 8px; margin-top: 4px; }
          .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #888; font-style: italic; }
          .variant { font-size: 11px; color: #888; }
          .biz-info { margin: 2px 0; font-size: 12px; color: #666; }
          .receipt-title { text-align: center; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #444; margin: 12px 0; }
        </style>
      </head>
      <body>${receiptEl.innerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
  };

  const handleEmail = async () => {
    let emailAddress: string | null = null;

    if (!order) return;

    if (order.customer_id) {
      // Customer exists — send to their email on file
      emailAddress = null; // backend will look it up
    } else {
      // No customer linked — prompt for email
      emailAddress = prompt('Enter email address to send receipt to:');
      if (!emailAddress || !emailAddress.includes('@')) return;
    }

    setEmailing(true);
    try {
      const { apiClient } = await import('../api/client');
      await apiClient.post(`/v1/checkout/orders/${order.id}/email-receipt?business_id=${businessId}`, {
        email: emailAddress,
      });
      alert(labels.emailSent);
    } catch {
      alert(labels.emailFailed);
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
          <Button size="sm" onClick={handlePrint}>{labels.print}</Button>
          <Button variant="secondary" size="sm" onClick={handleEmail} loading={emailing}>{labels.email}</Button>
        </div>
      </div>

      {/* Receipt content */}
      <div id="receipt-content" style={styles.receipt}>
        {/* Logo + Header */}
        <div style={styles.header}>
          {business?.logo_url && (
            <img src={business.logo_url} alt={business.name} style={styles.logo} />
          )}
          {business && (
            <>
              <h1 style={styles.businessName}>{business.name}</h1>
              <p style={styles.businessInfo}>
                {[business.address_line1, business.address_line2].filter(Boolean).join(', ')}
                {business.city && <><br />{[business.city, business.state_province, business.postal_code].filter(Boolean).join(', ')}</>}
              </p>
              {business.phone && <p style={styles.businessInfo}>{business.phone}</p>}
              {business.email && <p style={styles.businessInfo}>{business.email}</p>}
            </>
          )}
        </div>

        <div style={styles.receiptTitle}>{labels.receipt}</div>

        <hr style={styles.divider} />

        {/* Order info */}
        <div style={styles.orderInfo}>
          <div style={styles.orderInfoRow}>
            <span>{labels.order}:</span>
            <strong>{order.order_number}</strong>
          </div>
          <div style={styles.orderInfoRow}>
            <span>{labels.date}:</span>
            <span>{new Date(order.completed_at || order.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
          </div>
          <div style={styles.orderInfoRow}>
            <span>{labels.time}:</span>
            <span>{new Date(order.completed_at || order.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          {order.customer_first_name && (
            <div style={styles.orderInfoRow}>
              <span>{labels.customer}:</span>
              <span>{order.customer_first_name} {order.customer_last_name}</span>
            </div>
          )}
        </div>

        <hr style={styles.divider} />

        {/* Line items */}
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.thLeft}>{labels.item}</th>
              <th style={styles.thRight}>{labels.qty}</th>
              <th style={styles.thRight}>{labels.price}</th>
              <th style={styles.thRight}>{labels.total}</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id}>
                <td style={styles.tdLeft}>
                  {item.item_name}
                  {item.variant_name && <span style={styles.variantText}> ({item.variant_name})</span>}
                </td>
                <td style={styles.tdRight}>{item.quantity}</td>
                <td style={styles.tdRight}>{formatCurrency(item.unit_price)}</td>
                <td style={styles.tdRight}>{formatCurrency(item.total_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <hr style={styles.divider} />

        {/* Totals */}
        <div style={styles.totals}>
          <div style={styles.totalRow}>
            <span>{labels.subtotal}</span>
            <span>{formatCurrency(order.subtotal)}</span>
          </div>
          {order.discount_amount > 0 && (
            <div style={styles.totalRow}>
              <span>{labels.discount}{order.promo_code ? ` (${order.promo_code})` : ''}</span>
              <span>-{formatCurrency(order.discount_amount)}</span>
            </div>
          )}
          {order.tax_amount > 0 && (
            <div style={styles.totalRow}>
              <span>{labels.tax}</span>
              <span>{formatCurrency(order.tax_amount)}</span>
            </div>
          )}
          <div style={styles.grandTotal}>
            <span>{labels.total}</span>
            <span>{formatCurrency(order.total_amount)}</span>
          </div>
        </div>

        <hr style={styles.divider} />

        {/* Payment info */}
        <div style={styles.paymentInfo}>
          <div style={styles.totalRow}>
            <span>{labels.paymentMethod}</span>
            <span style={{ textTransform: 'capitalize' as const }}>{order.payment_method}</span>
          </div>
          {order.payment_reference && (
            <div style={styles.totalRow}>
              <span>{labels.reference}</span>
              <span>{order.payment_reference}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <p>{labels.thankYou}</p>
        </div>
      </div>

      {/* Print handled via popup window — no @media print needed */}
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
  receipt: { background: '#fff', color: '#333', border: '1px solid #ddd', borderRadius: '8px', padding: '32px', fontFamily: "'Inter', sans-serif", fontSize: '13px', lineHeight: 1.6 },
  header: { textAlign: 'center' as const, marginBottom: '8px' },
  logo: { maxWidth: '160px', maxHeight: '60px', marginBottom: '8px', objectFit: 'contain' as const },
  businessName: { fontSize: '20px', fontWeight: 700, margin: '0 0 4px', color: '#1a1a1a' },
  businessInfo: { margin: '2px 0', fontSize: '12px', color: '#666' },
  receiptTitle: { textAlign: 'center' as const, fontSize: '14px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '1px', color: '#444', margin: '12px 0' },
  divider: { border: 'none', borderTop: '1px dashed #ccc', margin: '12px 0' },
  orderInfo: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  orderInfoRow: { display: 'flex', justifyContent: 'space-between', fontSize: '13px' },
  table: { width: '100%', borderCollapse: 'collapse' as const, margin: '8px 0' },
  thLeft: { textAlign: 'left' as const, fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' as const, color: '#666', padding: '6px 0', borderBottom: '1px solid #ddd' },
  thRight: { textAlign: 'right' as const, fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' as const, color: '#666', padding: '6px 0', borderBottom: '1px solid #ddd' },
  tdLeft: { textAlign: 'left' as const, padding: '8px 0', fontSize: '13px', borderBottom: '1px solid #f0f0f0' },
  tdRight: { textAlign: 'right' as const, padding: '8px 0', fontSize: '13px', borderBottom: '1px solid #f0f0f0' },
  variantText: { fontSize: '11px', color: '#888' },
  totals: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  totalRow: { display: 'flex', justifyContent: 'space-between', fontSize: '13px' },
  grandTotal: { display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '16px', borderTop: '2px solid #333', paddingTop: '8px', marginTop: '4px' },
  paymentInfo: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  footer: { textAlign: 'center' as const, marginTop: '20px', fontSize: '12px', color: '#888', fontStyle: 'italic' as const },
};
