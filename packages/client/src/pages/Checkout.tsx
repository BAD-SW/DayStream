import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as checkoutApi from '../api/checkout';
import type { Order, OrderItem } from '../api/checkout';
import { formatCurrency } from '../utils/currency';

export function Checkout() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const bookingId = searchParams.get('appointment');
  const orderId = searchParams.get('order');
  const businessId = localStorage.getItem('business_id') || '';

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [staffList, setStaffList] = useState<any[]>([]);
  const [offerings, setOfferings] = useState<{ services: any[]; products: any[]; memberships: any[]; packages: any[] }>({ services: [], products: [], memberships: [], packages: [] });
  const [showAddItem, setShowAddItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  // Load order
  const loadOrder = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (orderId) {
        const o = await checkoutApi.getOrder(orderId);
        setOrder(o);
      } else if (bookingId) {
        const o = await checkoutApi.createOrderFromBooking(businessId, bookingId);
        setOrder(o);
        // Update URL to include order ID
        window.history.replaceState(null, '', `/checkout?order=${o.id}`);
      } else {
        setError('No appointment or order specified');
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load checkout');
    } finally {
      setLoading(false);
    }
  }, [orderId, bookingId, businessId]);

  useEffect(() => { loadOrder(); }, [loadOrder]);

  // Load staff and offerings for dropdowns
  useEffect(() => {
    if (!businessId) return;
    import('../api/staff').then((staffApi) => {
      staffApi.getStaffList({ business_id: businessId, status: 'active' }).then((res) => setStaffList(res.data)).catch(() => {});
    });
    const loadOfferings = async () => {
      const { apiClient } = await import('../api/client');
      const results = { services: [] as any[], products: [] as any[], memberships: [] as any[], packages: [] as any[] };
      try { const r = await (await import('../api/services')).getServices(businessId); const l = (r as any).data || r; results.services = Array.isArray(l) ? l : []; } catch {}
      try { const r = await apiClient.get(`/v1/merchandise?business_id=${businessId}&limit=100`); results.products = r.data.data || []; } catch {}
      try { const r = await apiClient.get(`/v1/memberships/plans?business_id=${businessId}&limit=100`); results.memberships = r.data.data || []; } catch {}
      try { const r = await apiClient.get(`/v1/packages?business_id=${businessId}&limit=100`); results.packages = r.data.data || []; } catch {}
      setOfferings(results);
    };
    loadOfferings();
  }, [businessId]);

  // Actions
  const handleUpdateOrderCredit = async (userId: string | null) => {
    if (!order) return;
    try {
      const updated = await checkoutApi.updateOrderCreditedTo(order.id, businessId, userId);
      setOrder(updated);
    } catch { /* silent */ }
  };

  const handleUpdateCredit = async (item: OrderItem, userId: string | null) => {
    if (!order) return;
    try {
      const updated = await checkoutApi.updateItem(order.id, item.id, { credited_to: userId });
      setOrder(updated);
    } catch { /* silent */ }
  };

  const handleRemoveItem = async (item: OrderItem) => {
    if (!order) return;
    try {
      const updated = await checkoutApi.removeItem(order.id, item.id);
      setOrder(updated);
    } catch { /* silent */ }
  };

  const handleComplete = async () => {
    if (!order) return;
    setCompleting(true);
    try {
      const completed = await checkoutApi.completeOrder(order.id, businessId, { payment_method: 'cash' });
      setOrder(completed);
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to complete payment');
    } finally {
      setCompleting(false);
    }
  };

  const handleVoid = async () => {
    if (!order || !confirm('Void this order? This cannot be undone.')) return;
    try {
      await checkoutApi.voidOrder(order.id, businessId);
      navigate('/bookings');
    } catch { alert('Failed to void order'); }
  };

  if (loading) return <div style={styles.page}><p style={styles.loading}>Loading checkout...</p></div>;
  if (error) return <div style={styles.page}><p style={styles.error}>{error}</p><Button onClick={() => navigate('/bookings')}>Back to Appointments</Button></div>;
  if (!order) return null;

  const isOpen = order.status === 'open';
  const isCompleted = order.status === 'completed';

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/bookings')}>← Back to Appointments</button>

      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Checkout</h1>
          <span style={styles.orderNum}>{order.order_number}</span>
          {order.customer_first_name && (
            <span style={styles.customer}> — {order.customer_first_name} {order.customer_last_name}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          {isOpen ? (
            <select
              style={styles.creditSelect}
              value={order.credited_to || ''}
              onChange={(e) => handleUpdateOrderCredit(e.target.value || null)}
            >
              <option value="">— Credit To —</option>
              {staffList.map((s: any) => (
                <option key={s.user_id} value={s.user_id}>{s.first_name} {s.last_name}</option>
              ))}
            </select>
          ) : (
            order.credited_to && staffList.length > 0 && (
              <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                {staffList.find((s: any) => s.user_id === order.credited_to)?.first_name || ''} {staffList.find((s: any) => s.user_id === order.credited_to)?.last_name || ''}
              </span>
            )
          )}
          <Badge variant={isCompleted ? 'success' : isOpen ? 'info' : 'error'}>{order.status}</Badge>
        </div>
      </div>

      {/* Line Items */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h3 style={styles.cardTitle}>Items</h3>
          {isOpen && <Button variant="secondary" size="sm" onClick={() => setShowAddItem(true)}>Add Item</Button>}
        </div>

        {order.items.length === 0 && <p style={styles.empty}>No items in cart</p>}

        {order.items.map((item) => (
          editingItemId === item.id && isOpen ? (
            <InlineEditItem
              key={item.id}
              item={item}
              orderId={order.id}
              staffList={staffList}
              onSaved={(updated) => { setOrder(updated); setEditingItemId(null); }}
              onCancel={() => setEditingItemId(null)}
            />
          ) : (
            <div key={item.id} style={styles.lineItem}>
              <div style={styles.lineItemMain}>
                <div style={styles.lineItemInfo}>
                  <span style={styles.itemTypeLabel}>{item.item_type.charAt(0).toUpperCase() + item.item_type.slice(1)}:</span>
                  <strong style={{ color: 'var(--color-text)' }}>{item.item_name}</strong>
                  {item.variant_name && <span style={styles.variant}> ({item.variant_name})</span>}
                  {item.quantity > 1 && <span style={styles.qty}>×{item.quantity}</span>}
                  {item.credited_to && item.credited_to !== order.credited_to && (
                    <span style={styles.overrideInline}>Credit: {item.credited_first_name} {item.credited_last_name}</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={styles.price}>{formatCurrency(item.total_price)}</span>
                  {isOpen && (
                    <>
                      <button style={styles.editBtn} onClick={() => setEditingItemId(item.id)} title="Edit">✏️</button>
                      <button style={styles.removeBtn} onClick={() => handleRemoveItem(item)} title="Remove">✕</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        ))}

        {/* Inline Add Item Row */}
        {showAddItem && isOpen && (
          <InlineAddItem
            orderId={order.id}
            offerings={offerings}
            staffList={staffList}
            onAdded={(updated) => { setOrder(updated); setShowAddItem(false); }}
            onCancel={() => setShowAddItem(false)}
          />
        )}
      </div>

      {/* Promo Code */}
      {isOpen && (
        <PromoCodeInput
          order={order}
          businessId={businessId}
          onUpdated={setOrder}
        />
      )}

      {/* Totals */}
      <div style={styles.card}>
        <div style={styles.totalRow}><span>Subtotal</span><span>{formatCurrency(order.subtotal)}</span></div>
        {order.discount_amount > 0 && <div style={styles.totalRow}><span>Discount</span><span>-{formatCurrency(order.discount_amount)}</span></div>}
        {order.tax_amount > 0 && <div style={styles.totalRow}><span>Tax</span><span>{formatCurrency(order.tax_amount)}</span></div>}
        <div style={{ ...styles.totalRow, fontWeight: 700, fontSize: '18px', borderTop: '1px solid var(--color-border)', paddingTop: '8px', marginTop: '8px' }}>
          <span>Total</span><span>{formatCurrency(order.total_amount)}</span>
        </div>
      </div>

      {/* Payment Actions */}
      {isOpen && (
        <div style={styles.actions}>
          <Button onClick={handleComplete} loading={completing}>Complete Payment (Cash)</Button>
          <Button variant="secondary" onClick={handleVoid}>Void Order</Button>
        </div>
      )}

      {isCompleted && (
        <div style={styles.card}>
          <p style={{ color: 'var(--color-text)', margin: 0 }}>
            Payment completed via <strong>{order.payment_method}</strong> on {new Date(order.completed_at!).toLocaleString()}
          </p>
        </div>
      )}

    </div>
  );
}

// ============================================================
// Inline Add Item Row
// ============================================================

function InlineAddItem({ orderId, offerings, staffList, onAdded, onCancel }: {
  orderId: string;
  offerings: { services: any[]; products: any[]; memberships: any[]; packages: any[] };
  staffList: any[];
  onAdded: (order: Order) => void;
  onCancel: () => void;
}) {
  const [itemType, setItemType] = useState<'product' | 'membership' | 'package'>('product');
  const [selectedId, setSelectedId] = useState('');
  const [variants, setVariants] = useState<any[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [creditedTo, setCreditedTo] = useState('');
  const [saving, setSaving] = useState(false);

  const itemList = itemType === 'product' ? offerings.products
    : itemType === 'membership' ? offerings.memberships
    : offerings.packages;

  const selectedItem = itemList.find((i: any) => i.id === selectedId);
  const selectedVariant = variants.find((v: any) => v.id === selectedVariantId);

  // Load variants when a product is selected
  useEffect(() => {
    if (itemType === 'product' && selectedId) {
      import('../api/client').then(({ apiClient }) => {
        apiClient.get(`/v1/merchandise/${selectedId}/variants`).then((res) => {
          const v = res.data.data || [];
          setVariants(v);
          setSelectedVariantId('');
        }).catch(() => setVariants([]));
      });
    } else {
      setVariants([]);
      setSelectedVariantId('');
    }
  }, [itemType, selectedId]);

  const handleAdd = async () => {
    if (!selectedItem) return;
    const price = selectedVariant?.price ?? selectedItem.price;
    const variantName = selectedVariant?.name || undefined;

    setSaving(true);
    try {
      const updated = await checkoutApi.addItem(orderId, {
        item_type: itemType,
        item_id: selectedItem.id,
        item_name: selectedItem.name,
        variant_id: selectedVariant?.id || undefined,
        variant_name: variantName,
        quantity,
        unit_price: price,
        credited_to: creditedTo || undefined,
      });
      onAdded(updated);
    } catch { alert('Failed to add item'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ ...styles.lineItem, background: 'var(--color-background)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr auto 45px 120px auto', gap: '6px', alignItems: 'center' }}>
        <select style={styles.inlineSelect} value={itemType} onChange={(e) => { setItemType(e.target.value as any); setSelectedId(''); }}>
          <option value="product">Product</option>
          <option value="membership">Membership</option>
          <option value="package">Package</option>
        </select>
        <select style={styles.inlineSelect} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          <option value="">— Select item —</option>
          {itemList.map((item: any) => (
            <option key={item.id} value={item.id}>{item.name} — {formatCurrency(item.price)}</option>
          ))}
        </select>
        {variants.length > 0 ? (
          <select style={{ ...styles.inlineSelect, minWidth: '110px' }} value={selectedVariantId} onChange={(e) => setSelectedVariantId(e.target.value)}>
            <option value="">Base ({formatCurrency(selectedItem?.price || 0)})</option>
            {variants.map((v: any) => (
              <option key={v.id} value={v.id}>{v.name} — {formatCurrency(v.price)}</option>
            ))}
          </select>
        ) : (
          <span />
        )}
        <input type="number" min="1" style={{ ...styles.inlineSelect, width: '40px', textAlign: 'center' as const }} value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value) || 1)} />
        <select style={styles.inlineSelect} value={creditedTo} onChange={(e) => setCreditedTo(e.target.value)}>
          <option value="">— Override —</option>
          {staffList.map((s: any) => (
            <option key={s.user_id} value={s.user_id}>{s.first_name} {s.last_name}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: '4px' }}>
          <Button size="sm" onClick={handleAdd} loading={saving} disabled={!selectedId}>Add</Button>
          <Button variant="secondary" size="sm" onClick={onCancel}>✕</Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Promo Code Input
// ============================================================

function PromoCodeInput({ order, businessId, onUpdated }: { order: Order; businessId: string; onUpdated: (o: Order) => void }) {
  const [code, setCode] = useState('');
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  const handleApply = async () => {
    if (!code.trim()) return;
    setApplying(true);
    setError('');
    try {
      const updated = await checkoutApi.applyPromoCode(order.id, businessId, code.trim());
      onUpdated(updated);
      setCode('');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Invalid code');
    } finally {
      setApplying(false);
    }
  };

  const handleRemove = async () => {
    try {
      const updated = await checkoutApi.removePromoCode(order.id, businessId);
      onUpdated(updated);
    } catch { /* silent */ }
  };

  if (order.promo_code) {
    return (
      <div style={{ ...styles.card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px var(--space-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>Promo:</span>
          <strong style={{ color: 'var(--color-text)' }}>{order.promo_code}</strong>
          <span style={{ fontSize: '12px', color: 'var(--color-success, #2E7D32)' }}>−{formatCurrency(order.discount_amount)}</span>
        </div>
        <button style={styles.removeBtn} onClick={handleRemove} title="Remove code">✕</button>
      </div>
    );
  }

  return (
    <div style={{ ...styles.card, display: 'flex', alignItems: 'center', gap: '8px', padding: '12px var(--space-lg)' }}>
      <input
        style={{ ...styles.inlineSelect, flex: 1, maxWidth: '200px' }}
        value={code}
        onChange={(e) => { setCode(e.target.value); setError(''); }}
        placeholder="Promo code"
        onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }}
      />
      <Button size="sm" variant="secondary" onClick={handleApply} loading={applying} disabled={!code.trim()}>Apply</Button>
      {error && <span style={{ fontSize: '12px', color: 'var(--color-error)' }}>{error}</span>}
    </div>
  );
}

// ============================================================
// Inline Edit Item Row
// ============================================================

function InlineEditItem({ item, orderId, staffList, onSaved, onCancel }: {
  item: OrderItem;
  orderId: string;
  staffList: any[];
  onSaved: (order: Order) => void;
  onCancel: () => void;
}) {
  const [quantity, setQuantity] = useState(item.quantity);
  const [unitPrice, setUnitPrice] = useState(String((item.unit_price / 100).toFixed(2)));
  const [creditedTo, setCreditedTo] = useState(item.credited_to || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await checkoutApi.updateItem(orderId, item.id, {
        quantity,
        unit_price: Math.round(parseFloat(unitPrice) * 100),
        credited_to: creditedTo || null,
      });
      onSaved(updated);
    } catch { alert('Failed to update item'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ ...styles.lineItem, background: 'var(--color-background)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 80px 45px 120px auto', gap: '6px', alignItems: 'center' }}>
        <span style={styles.itemTypeLabel}>{item.item_type.charAt(0).toUpperCase() + item.item_type.slice(1)}:</span>
        <strong style={{ color: 'var(--color-text)', fontSize: '13px' }}>{item.item_name}{item.variant_name ? ` (${item.variant_name})` : ''}</strong>
        <input type="number" step="0.01" min="0" style={{ ...styles.inlineSelect, width: '75px' }} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} title="Unit price" />
        <input type="number" min="1" style={{ ...styles.inlineSelect, width: '40px', textAlign: 'center' as const }} value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value) || 1)} title="Quantity" />
        <select style={styles.inlineSelect} value={creditedTo} onChange={(e) => setCreditedTo(e.target.value)}>
          <option value="">— Override —</option>
          {staffList.map((s: any) => (
            <option key={s.user_id} value={s.user_id}>{s.first_name} {s.last_name}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: '4px' }}>
          <Button size="sm" onClick={handleSave} loading={saving}>Save</Button>
          <Button variant="secondary" size="sm" onClick={onCancel}>✕</Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Styles
// ============================================================

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '800px', margin: '0 auto' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, fontFamily: 'var(--font-family)', marginBottom: 'var(--space-md)', display: 'block' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  orderNum: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  customer: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  loading: { textAlign: 'center', color: 'var(--color-text-secondary)', padding: 'var(--space-xl)' },
  error: { color: 'var(--color-error)', marginBottom: 'var(--space-md)' },
  empty: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
  card: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)', marginBottom: 'var(--space-md)' },
  cardTitle: { margin: 0, fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--color-text)' },
  lineItem: { borderBottom: '1px solid var(--color-border)', padding: '12px 0', display: 'flex', flexDirection: 'column' as const, gap: '6px' },
  lineItemMain: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  lineItemInfo: { display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const, gap: '4px' },
  itemTypeLabel: { fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', minWidth: '80px' },
  overrideInline: { fontSize: '12px', color: 'var(--color-text-secondary)', marginLeft: '12px', fontStyle: 'italic' as const },
  lineItemMeta: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  variant: { fontSize: '12px', color: 'var(--color-text-secondary)' },
  qty: { fontSize: '12px', color: 'var(--color-text-secondary)', marginLeft: '4px' },
  price: { fontWeight: 600, color: 'var(--color-text)', fontSize: '15px' },
  creditSelect: { fontSize: '13px', padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)', color: 'var(--color-text)', fontFamily: 'var(--font-family)' },
  inlineSelect: { fontSize: '12px', padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-background)', color: 'var(--color-text)', fontFamily: 'var(--font-family)' },
  removeBtn: { background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontSize: '16px', padding: '4px' },
  editBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '4px' },
  totalRow: { display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '14px', color: 'var(--color-text)' },
  actions: { display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-md)' },
};
