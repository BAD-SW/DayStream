import { askConfirm, showMessage } from '../design-system/components/feedback/dialogs';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import i18n from '../i18n';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as checkoutApi from '../api/checkout';
import * as payApi from '../api/payments';
import * as bookingsApi from '../api/bookings';
import type { PaymentMethod, MethodType } from '../api/payments';
import { AddPaymentMethodInline, AddMethodButton } from '../components/AddPaymentMethodInline';
import { StripeOneTimeCardCharge } from '../components/StripeOneTimeCardCharge';
import * as customersApi from '../api/customers';
import { MissingDetailsPrompt } from '../components/MissingDetailsPrompt';
import { CurrencyInput } from '../components/CurrencyInput';
import type { Order, OrderItem } from '../api/checkout';
import { formatCurrency } from '../utils/currency';
import { formatDateOnly } from '../utils/date';
import { formatDateTime } from '../utils/format';
import { TipPanel } from '../components/TipPanel';
import { RemovePaidAddonModal } from '../components/booking/RemovePaidAddonModal';
import { LineBenefitPicker } from '../components/LineBenefitPicker';
import { getLocations } from '../api/locations';
import type { Location } from '../api/locations';
import { getLocationStock } from '../api/inventory';

/** On hand of a tracked product (or variant) at the order's location; null when stock is not tracked. */
type StockInfo = { onHand: number; low: boolean };
type StockOf = (productId: string | null | undefined, variantId: string | null | undefined) => StockInfo | null;
type MaxFor = (productId: string | null | undefined, variantId: string | null, exceptItemId?: string) => number | null;

/** A typed quantity, kept between 1 and the most that may be added (when stock is tracked). */
const clampQty = (raw: string, max: number | null) => {
  const n = parseInt(raw, 10) || 1;
  return Math.max(1, max != null && max > 0 ? Math.min(n, max) : n);
};

/** Translated where shown, never at module load. */
const tr = (key: string, values?: Record<string, unknown>) => i18n.t(`checkout:${key}`, values) as string;
const stockText = (s: StockInfo) => (s.onHand === 0 ? tr('co.outOfStock') : tr('co.inStock', { count: s.onHand }));
const stockColor = (s: StockInfo) => (s.onHand === 0 ? 'var(--color-error)' : s.low ? 'var(--color-warning)' : 'var(--color-text-secondary)');
const limitedText = (l: NonNullable<Order['stock_limited']>, name: string, changed: boolean) =>
  changed
    ? tr('co.limitedChanged', { name, onHand: l.onHand, added: l.added, requested: l.requested })
    : tr('co.limitedAdded', { name, onHand: l.onHand, count: l.added, added: l.added, requested: l.requested });
const errText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

/** A line's type as shown before its name ("Service:", "Add-on:", "No-show fee:"). */
const typeLabel = (type: string) => {
  const s = type === 'add_on' ? 'add-on' : type.replace(/_/g, ' ');
  return tr(`co.itemType.${type}`, { defaultValue: s.charAt(0).toUpperCase() + s.slice(1) });
};

/** Visually hidden, still read by screen readers. */
const srOnly: React.CSSProperties = { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };

/** A stored payment method's name, through checkout:takePayment.method.<value>. */
const payMethodLabel = (m: string) => tr(`takePayment.method.${m}`, { defaultValue: m });

const paySelectStyle: React.CSSProperties = {
  padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-base)',
};

// An order being created right now, by what it is for. React runs the page's loading effect twice in
// development (Strict Mode), which used to create two orders; the second run reuses the first's.
const ordersBeingCreated = new Map<string, Promise<Order>>();
function createOnce(key: string, create: () => Promise<Order>): Promise<Order> {
  const pending = ordersBeingCreated.get(key);
  if (pending) return pending;
  const p = create().finally(() => { setTimeout(() => ordersBeingCreated.delete(key), 2000); });
  ordersBeingCreated.set(key, p);
  return p;
}

export function Checkout() {
  const { t } = useTranslation('checkout');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const bookingId = searchParams.get('appointment');
  const orderId = searchParams.get('order');
  const isNewSale = searchParams.get('new') === 'true';
  const businessId = localStorage.getItem('business_id') || '';

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [staffList, setStaffList] = useState<any[]>([]);
  const [offerings, setOfferings] = useState<{ services: any[]; products: any[]; memberships: any[]; packages: any[] }>({ services: [], products: [], memberships: [], packages: [] });
  const [showAddItem, setShowAddItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  // The line whose membership or package picker is open (spec 51, gap 19).
  const [benefitLineId, setBenefitLineId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  // Branded receipt actions shown once the order is paid.
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptNote, setReceiptNote] = useState<string | null>(null);

  // Payment method selection (replaces the old hardcoded cash completion).
  const [acceptedMethods, setAcceptedMethods] = useState<string[]>([]);
  const [storedMethods, setStoredMethods] = useState<PaymentMethod[]>([]);
  const [payMethod, setPayMethod] = useState<string>('cash');
  const [payStoredMethodId, setPayStoredMethodId] = useState<string>('');
  const [payAddingMethod, setPayAddingMethod] = useState(false);
  const [payGiftCode, setPayGiftCode] = useState('');
  const [payCheckNumber, setPayCheckNumber] = useState('');
  // Walk-in one-time card charge (no customer): optional name + the live Stripe
  // card-entry session once the staff starts a one-time charge.
  const [walkInName, setWalkInName] = useState('');
  const [oneTimeSession, setOneTimeSession] = useState<checkoutApi.OneTimeChargeSession | null>(null);
  const [startingOneTime, setStartingOneTime] = useState(false);

  // Customer search/create
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({ first_name: '', last_name: '', email: '', phone: '' });
  // Tips (spec 51, gap 14): the business's settings decide whether the Tip panel shows.
  const [tipSettings, setTipSettings] = useState<checkoutApi.TipSettings | null>(null);
  useEffect(() => {
    if (!businessId) return;
    checkoutApi.getTipSettings(businessId).then(setTipSettings).catch(() => setTipSettings(null));
  }, [businessId]);

  // Retail stock (spec 51, gap 7): the order's location and what is on hand there.
  const [locations, setLocations] = useState<Location[]>([]);
  const [tracked, setTracked] = useState<Set<string>>(new Set());
  const [stock, setStock] = useState<Map<string, StockInfo>>(new Map());
  const [stockNote, setStockNote] = useState<string | null>(null);
  // An add-on paid at reservation being removed (spec 51, gap 15), and what happened.
  const [removingAddon, setRemovingAddon] = useState<{ bookingAddonId: string; name: string; amount: number } | null>(null);
  const [addonNotice, setAddonNotice] = useState<string | null>(null);
  const orderLocationId = order?.location_id || locations.find((l) => l.is_primary)?.id || locations[0]?.id || null;

  useEffect(() => {
    if (!businessId) return;
    getLocations(businessId, { status: 'active' }).then((l) => setLocations(l || [])).catch(() => setLocations([]));
  }, [businessId]);

  const loadStock = useCallback(async () => {
    if (!businessId || !orderLocationId) return;
    try {
      const s = await getLocationStock(orderLocationId, businessId);
      setTracked(new Set(s.tracked_ids));
      setStock(new Map(s.stock.map((r) => [`${r.merchandise_id}:${r.variant_id || ''}`, { onHand: r.on_hand, low: r.low }])));
    } catch { setTracked(new Set()); setStock(new Map()); }
  }, [businessId, orderLocationId]);
  useEffect(() => { loadStock(); }, [loadStock]);

  const stockOf: StockOf = (productId, variantId) => {
    if (!productId || !tracked.has(productId)) return null;
    if (variantId !== undefined) return stock.get(`${productId}:${variantId || ''}`) ?? { onHand: 0, low: false };
    // The whole product: every option together.
    let onHand = 0; let low = false;
    stock.forEach((v, k) => { if (k.startsWith(`${productId}:`)) { onHand += v.onHand; low = low || v.low; } });
    return { onHand, low };
  };

  /** Most of a tracked item that may still go on this order (on hand less the order's other lines); null: no limit. */
  const maxFor: MaxFor = (productId, variantId, exceptItemId) => {
    const s = stockOf(productId, variantId);
    if (!s || !order) return null;
    const held = order.items
      .filter((o) => o.item_type === 'product' && o.item_id === productId && (o.variant_id ?? null) === (variantId ?? null) && o.id !== exceptItemId)
      .reduce((n, o) => n + o.quantity, 0);
    return Math.max(0, s.onHand - held);
  };

  // An answer to adding or changing a line: say when the quantity was limited to what is on hand.
  const applyOrder = (updated: Order, lineName: string, changed: boolean) => {
    setOrder(updated);
    setStockNote(updated.stock_limited ? limitedText(updated.stock_limited, lineName, changed) : null);
  };

  const handleSetLocation = async (locationId: string) => {
    if (!order) return;
    try {
      setOrder(await checkoutApi.setOrderLocation(order.id, businessId, locationId));
    } catch (err) { void showMessage({ message: errText(err, t('co.locationFailed')), tone: 'error' }); }
  };

  // Load order
  const loadOrder = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (orderId) {
        const o = await checkoutApi.getOrder(orderId);
        setOrder(o);
      } else if (bookingId) {
        const o = await createOnce(`booking:${bookingId}`, () => checkoutApi.createOrderFromBooking(businessId, bookingId));
        setOrder(o);
        // Update URL to include order ID
        window.history.replaceState(null, '', `/checkout?order=${o.id}`);
      } else if (isNewSale) {
        // "New order" from a person's profile opens the sale with that person already chosen.
        const forCustomer = searchParams.get('customer');
        const o = await createOnce(`new:${businessId}:${forCustomer || ''}`, async () => {
          const created = await checkoutApi.createOrder({ business_id: businessId, ...(forCustomer ? { customer_id: forCustomer } : {}) });
          return checkoutApi.getOrder(created.id);
        });
        setOrder(o);
        window.history.replaceState(null, '', `/checkout?order=${o!.id}`);
      } else {
        setError(t('co.noOrder'));
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || t('co.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [orderId, bookingId, isNewSale, businessId]);

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
      try { const r = await (await import('../api/services')).getServices(businessId, { status: 'active', limit: 100 }); const l = (r as any).data || r; results.services = Array.isArray(l) ? l : []; } catch {}
      try { const r = await apiClient.get(`/v1/merchandise?business_id=${businessId}&limit=100`); results.products = r.data.data || []; } catch {}
      try { const r = await apiClient.get(`/v1/memberships/plans?business_id=${businessId}&limit=100`); results.memberships = r.data.data || []; } catch {}
      try { const r = await apiClient.get(`/v1/packages?business_id=${businessId}&limit=100`); results.packages = r.data.data || []; } catch {}
      setOfferings(results);
    };
    loadOfferings();
  }, [businessId]);

  // Customer search with debounce
  useEffect(() => {
    if (!customerSearch || customerSearch.length < 2) {
      setCustomerResults([]);
      setShowCustomerDropdown(false);
      return;
    }
    setCustomerSearching(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await customersApi.getCustomers(businessId, { search: customerSearch, limit: 10 });
        setCustomerResults(res.data);
        setShowCustomerDropdown(true);
      } catch { setCustomerResults([]); }
      finally { setCustomerSearching(false); }
    }, 300);
    return () => clearTimeout(timeout);
  }, [customerSearch, businessId]);

  // Actions
  const handleSetCustomer = async (customerId: string) => {
    if (!order) return;
    try {
      const updated = await checkoutApi.updateOrderCustomer(order.id, businessId, customerId);
      setOrder(updated);
      setCustomerSearch('');
      setShowCustomerDropdown(false);
      setShowCreateCustomer(false);
    } catch { /* silent */ }
  };

  const handleCreateAndSetCustomer = async () => {
    if (!order || !newCustomerForm.first_name || !newCustomerForm.last_name) return;
    try {
      const customer = await customersApi.createCustomer({ ...newCustomerForm, business_id: businessId });
      await handleSetCustomer(customer.id);
      setNewCustomerForm({ first_name: '', last_name: '', email: '', phone: '' });
    } catch (err: any) { void showMessage({ message: err?.response?.data?.message || t('co.customerCreateFailed'), tone: 'error' }); }
  };

  const handleRemoveCustomer = async () => {
    if (!order) return;
    try {
      const updated = await checkoutApi.updateOrderCustomer(order.id, businessId, null);
      setOrder(updated);
    } catch { /* silent */ }
  };

  const handleUpdateOrderCredit = async (userId: string | null) => {
    if (!order) return;
    try {
      const updated = await checkoutApi.updateOrderCreditedTo(order.id, businessId, userId);
      setOrder(updated);
    } catch { /* silent */ }
  };

  const handleRemoveItem = async (item: OrderItem) => {
    if (!order) return;
    try {
      const updated = await checkoutApi.removeItem(order.id, item.id);
      setOrder(updated);
    } catch (err) { void showMessage({ message: errText(err, t('co.itemRemoveFailed')), tone: 'error' }); }
  };
  // The service of the appointment being checked out stays on the order (owner, 23 Nov 2026).
  const isBookingService = (item: OrderItem) => item.item_type === 'service' && !!item.booking_id && item.booking_id === order?.booking_id;

  // Load the business's accepted methods (availability resolver) and, when the
  // order has a customer, that customer's stored methods for processed payments.
  useEffect(() => {
    if (!businessId) return;
    payApi.getAvailableMethods(businessId, false)
      .then((avail) => setAcceptedMethods(avail.map((a) => a.method)))
      .catch(() => setAcceptedMethods(['cash']));
  }, [businessId]);

  useEffect(() => {
    if (!businessId || !order?.customer_id) { setStoredMethods([]); return; }
    const bookingId = order.booking_id;
    Promise.all([
      payApi.listPaymentMethods({ owner_level: 'customer', business_id: businessId, customer_id: order.customer_id }),
      // The card held for the reservation (spec 51, gap 5) is offered first; staff can choose another.
      bookingId ? bookingsApi.getBooking(bookingId, businessId).then((b) => b.payment_method_id ?? null).catch(() => null) : Promise.resolve(null),
    ])
      .then(([m, heldId]) => {
        setStoredMethods(m);
        const held = heldId ? m.find((x) => x.id === heldId) : undefined;
        const def = held ?? m.find((x) => x.is_default) ?? m[0];
        if (def) setPayStoredMethodId(def.id);
        if (held) setPayMethod(held.method_type === 'bank_draw' ? 'bank_draw' : 'card');
      })
      .catch(() => setStoredMethods([]));
  }, [businessId, order?.customer_id, order?.booking_id]);

  const isProcessedMethod = (m: string) => m === 'card' || m === 'bank_draw' || m === 'google_pay' || m === 'apple_pay';

  // Walk-in card: begin a one-time PaymentIntent and show the card entry form.
  const handleStartOneTimeCharge = async () => {
    if (!order) return;
    setStartingOneTime(true);
    try {
      const session = await checkoutApi.beginOneTimeCharge(order.id, businessId);
      if (!session.clientSecret || !session.publishableKey) {
        void showMessage({ message: t('co.noCardProcessor'), tone: 'info' });
        return;
      }
      setOneTimeSession(session);
    } catch (err: any) {
      const code = err?.response?.data?.code;
      if (code === 'OUT_OF_STOCK' || code === 'NOT_ENOUGH_STOCK') loadStock();
      void showMessage({ message: err?.response?.data?.error || t('co.cardChargeFailed'), tone: 'error' });
    } finally {
      setStartingOneTime(false);
    }
  };

  // If the paid order came back with membership enrollment failures, the money is in
  // but the membership isn't — tell the cashier plainly so they can follow up (manual
  // enroll or refund). Non-blocking: we still proceed to the receipt afterwards.
  const warnIfEnrollmentFailed = (completed: checkoutApi.Order) => {
    // Show any gift-card codes that were issued, so the cashier can hand them over.
    const issued = completed.gift_cards_issued;
    if (issued && issued.length > 0) {
      const lines = issued.map((g) => `• ${g.code} — ${formatCurrency(g.amountCents)}`).join('\n');
      void showMessage({ message: t('co.giftIssued', { lines }), tone: 'success' });
    }

    const warnings = completed.enrollment_warnings;
    if (!warnings || warnings.length === 0) return;
    const lines = warnings.map((w) => `• ${w.planName || t('co.membershipFallback')}: ${w.reason}`).join('\n');
    void showMessage({ message: t('co.notFulfilled', { lines }), tone: 'info' });
  };

  // The browser confirmed the walk-in PaymentIntent; complete the order referencing it.
  const handleWalkInCardPaid = async (paymentIntentId: string) => {
    if (!order) return;
    setCompleting(true);
    try {
      const completed = await checkoutApi.completeOrder(order.id, businessId, {
        payment_method: 'card',
        one_time_charge_ref: paymentIntentId,
        walk_in_name: walkInName.trim() || null,
      });
      warnIfEnrollmentFailed(completed);
      navigate(`/receipt/${completed.id}`);
    } catch (err: any) {
      void showMessage({ message: err?.response?.data?.error || t('co.chargedButFailed'), tone: 'error' });
    } finally {
      setCompleting(false);
    }
  };

  // The service was paid at reservation and nothing else was sold: finish the appointment
  // (spec 51, gap 5). The server closes it and answers with the order that paid it.
  const handleFinishPrepaid = async () => {
    if (!order) return;
    setCompleting(true);
    try {
      const paidOrder = await checkoutApi.completeOrder(order.id, businessId, { payment_method: 'other' });
      navigate(`/receipt/${paidOrder.id}`);
    } catch (err: any) {
      void showMessage({ message: err?.response?.data?.error || t('co.finishFailed'), tone: 'error' });
    } finally { setCompleting(false); }
  };

  const handleComplete = async () => {
    if (!order) return;
    // Require customer when order contains a membership or package
    const requiresCustomer = order.items.some((item) => item.item_type === 'membership' || item.item_type === 'package');
    if (requiresCustomer && !order.customer_id) {
      void showMessage({ message: t('co.customerRequired'), tone: 'info' });
      return;
    }

    const processed = isProcessedMethod(payMethod);
    const isGift = payMethod === 'gift_card';

    // Walk-in card (no customer) goes through the one-time charge card form + its
    // own completion handler, not this button.
    if (processed && !order.customer_id) {
      if (payMethod === 'card') {
        void showMessage({ message: t('co.enterCardAbove'), tone: 'info' });
      } else {
        void showMessage({ message: t('co.customerForDebit'), tone: 'info' });
      }
      return;
    }
    // Gift-card payments need a customer (they draw a business gift-card balance).
    if (isGift && !order.customer_id) {
      void showMessage({ message: t('co.customerForGift'), tone: 'info' });
      return;
    }
    // Resolve the effective stored method for the selected class (bank_draw vs card).
    const matchingStored = storedMethods.filter((m) =>
      payMethod === 'bank_draw' ? m.method_type === 'bank_draw' : m.method_type !== 'bank_draw',
    );
    const effectiveStoredId = matchingStored.some((m) => m.id === payStoredMethodId)
      ? payStoredMethodId : (matchingStored[0]?.id ?? '');

    if (processed && !effectiveStoredId) {
      void showMessage({ message: t('co.selectOrAddMethod'), tone: 'info' });
      return;
    }
    if (isGift && !payGiftCode.trim()) {
      void showMessage({ message: t('takePayment.giftCodeRequired'), tone: 'info' });
      return;
    }

    setCompleting(true);
    try {
      // The server takes or records the payment and closes the order in one step: the order
      // is completed only if the money (or the gift card value) is in.
      const completed = await checkoutApi.completeOrder(order.id, businessId, {
        payment_method: payMethod,
        payment_method_id: processed ? effectiveStoredId : null,
        gift_card_code: isGift ? payGiftCode.trim() : null,
        // For a check, the check number is the payment reference.
        payment_reference: payMethod === 'check' && payCheckNumber.trim() ? payCheckNumber.trim() : undefined,
      });
      warnIfEnrollmentFailed(completed);
      navigate(`/receipt/${completed.id}`);
    } catch (err: any) {
      const code = err?.response?.data?.code;
      const msg = code === 'PAYMENT_DECLINED'
        ? (err?.response?.data?.error || t('takePayment.declined'))
        : code === 'NO_CONNECTION'
        ? t('takePayment.error.noConnection')
        : code === 'GIFT_CARD_INSUFFICIENT'
          ? t('co.giftInsufficient')
          : code === 'OUT_OF_STOCK' || code === 'NOT_ENOUGH_STOCK'
            ? t('co.nothingCharged', { error: err?.response?.data?.error })
            : err?.response?.data?.error || t('co.completeFailed');
      if (code === 'OUT_OF_STOCK' || code === 'NOT_ENOUGH_STOCK') loadStock();
      void showMessage({ message: msg, tone: 'error' });
    } finally {
      setCompleting(false);
    }
  };

  const handleVoid = async () => {
    if (!order || !(await askConfirm({ message: t('co.voidConfirm'), confirmLabel: t('common:action.void'), destructive: true }))) return;
    try {
      await checkoutApi.voidOrder(order.id, businessId);
      navigate('/bookings');
    } catch { void showMessage({ message: t('co.voidFailed'), tone: 'error' }); }
  };

  // Branded receipt for the paid order (Email / Print / Both). Resolves the order's
  // payment transaction server-side. Walk-in orders with no email report that for Email.
  const handleReceipt = async (mode: 'email' | 'print' | 'both') => {
    if (!order) return;
    setReceiptBusy(true); setReceiptNote(null);
    let emailed = false;
    let printed = false;
    try {
      if (mode !== 'print') {
        try { await payApi.emailOrderReceipt(order.id, businessId); emailed = true; }
        catch (err: any) {
          if (err?.response?.data?.code === 'NO_RECIPIENT') { setReceiptNote(t('co.noRecipient')); setReceiptBusy(false); return; }
          throw err;
        }
      }
      if (mode !== 'email') {
        const blob = await payApi.fetchOrderReceiptPdf(order.id, businessId);
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        printed = true;
      }
      setReceiptNote(emailed && printed ? t('takePayment.receiptBoth') : emailed ? t('takePayment.receiptEmailed') : printed ? t('takePayment.receiptPrinted') : null);
    } catch {
      setReceiptNote(t('takePayment.receiptFailed'));
    } finally {
      setReceiptBusy(false);
    }
  };

  if (loading) return <div style={styles.page}><p style={styles.loading}>{t('co.loading')}</p></div>;
  if (error) return <div style={styles.page}><p style={styles.error}>{error}</p><Button onClick={() => navigate('/bookings')}>{t('co.backToAppointmentsPlain')}</Button></div>;
  if (!order) return null;

  const isOpen = order.status === 'open';
  // What the customer pays: the sale and its tip (spec 51, gap 14).
  const payable = order.total_amount + (order.tip_amount || 0);
  // A line paid (or to be paid) with a membership or package (spec 51, gap 19).
  const canUseBenefit = (item: OrderItem) => isOpen && !!order.customer_id && (item.item_type === 'service' || item.item_type === 'product') && !!item.item_id;
  // Paid at reservation, nothing else sold and no tip: the appointment is just finished.
  const nothingToPay = !!order.prepaid_order_number && order.items.length === 0 && !((order.tip_amount || 0) > 0);
  const isCompleted = order.status === 'completed';

  return (
    <div style={styles.page}>
      <button style={styles.back} onClick={() => navigate('/bookings')}>{t('co.backToAppointments')}</button>

      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>{t('co.title')}</h1>
          <span style={styles.orderNum}>{order.order_number}</span>
          {order.customer_first_name && !isOpen && (
            <span style={styles.customer}> — {order.customer_first_name} {order.customer_last_name}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          {locations.length > 1 && (isOpen ? (
            <select style={styles.creditSelect} value={orderLocationId || ''} onChange={(e) => handleSetLocation(e.target.value)}
              aria-label={t('co.location')} title={t('co.locationTitle')}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          ) : (
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{locations.find((l) => l.id === orderLocationId)?.name}</span>
          ))}
          {isOpen ? (
            <select
              style={styles.creditSelect}
              value={order.credited_to || ''}
              onChange={(e) => handleUpdateOrderCredit(e.target.value || null)}
            >
              <option value="">{t('co.creditTo')}</option>
              {staffList.map((s: any) => (
                <option key={s.user_id} value={s.user_id}>{s.first_name} {s.last_name}</option>
              ))}
            </select>
          ) : (
            order.credited_to && staffList.length > 0 && (
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                {staffList.find((s: any) => s.user_id === order.credited_to)?.first_name || ''} {staffList.find((s: any) => s.user_id === order.credited_to)?.last_name || ''}
              </span>
            )
          )}
          <Badge variant={isCompleted ? 'success' : isOpen ? 'info' : 'error'}>{t(`orders.status.${order.status}`, { defaultValue: order.status })}</Badge>
        </div>
      </div>

      {/* Customer selector */}
      {isOpen && order.customer_id && (
        <MissingDetailsPrompt customerId={order.customer_id} businessId={businessId} />
      )}
      {isOpen && (
        <div style={{ marginBottom: 'var(--space-md)', padding: '12px 16px', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-background)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)', minWidth: '70px' }}>{t('co.customer')}</span>
            {order.customer_id ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>{order.customer_first_name} {order.customer_last_name}</span>
                <button type="button" onClick={handleRemoveCustomer} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)', lineHeight: 1 }}>×</button>
              </div>
            ) : (
              <div style={{ position: 'relative', width: '300px', flexShrink: 0 }}>
                <input
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: 'var(--font-size-sm)', boxSizing: 'border-box' }}
                  type="text"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder={t('co.searchCustomer')}
                  autoComplete="off"
                  onFocus={() => { if (customerResults.length > 0) setShowCustomerDropdown(true); }}
                  onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                />
                {showCustomerDropdown && customerResults.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border)', borderRadius: '4px', marginTop: '2px', zIndex: 100, maxHeight: '200px', overflow: 'auto' }}>
                    {customerResults.map((c: any) => (
                      <button key={c.id} type="button" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 'var(--font-size-sm)', borderBottom: '1px solid var(--color-border)' }}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleSetCustomer(c.id)}>
                        <strong>{c.first_name} {c.last_name}</strong>{c.email && <span style={{ marginLeft: '8px', color: 'var(--color-text-secondary)' }}>{c.email}</span>}
                      </button>
                    ))}
                  </div>
                )}
                {customerSearching && <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginLeft: '4px' }}>{t('co.searching')}</span>}
              </div>
            )}
            {!order.customer_id && !showCreateCustomer && (
              <span onClick={() => setShowCreateCustomer(true)} style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary)', cursor: 'pointer', textDecoration: 'underline', whiteSpace: 'nowrap' }}>{t('co.newCustomer')}</span>
            )}
          </div>
          {showCreateCustomer && !order.customer_id && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
              <input style={{ padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: 'var(--font-size-sm)', width: '130px' }} placeholder={t('co.firstNameRequired')} value={newCustomerForm.first_name} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, first_name: e.target.value })} />
              <input style={{ padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: 'var(--font-size-sm)', width: '130px' }} placeholder={t('co.lastNameRequired')} value={newCustomerForm.last_name} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, last_name: e.target.value })} />
              <input style={{ padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: 'var(--font-size-sm)', width: '180px' }} placeholder={t('co.email')} value={newCustomerForm.email} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, email: e.target.value })} />
              <input style={{ padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: 'var(--font-size-sm)', width: '130px' }} placeholder={t('co.phone')} value={newCustomerForm.phone} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, phone: e.target.value })} />
              <Button size="sm" onClick={handleCreateAndSetCustomer}>{t('co.create')}</Button>
              <button type="button" onClick={() => setShowCreateCustomer(false)} style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>{t('common:cancel')}</button>
            </div>
          )}
        </div>
      )}

      {/* Paid at reservation (spec 51, gap 14): the service paid when it was booked, shown read
          only so the visit can be tipped on it. Its lines and payment stay on that order: they
          cannot be changed or removed here and are never charged or posted again. */}
      {order.prepaid && (
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
            <h3 style={styles.cardTitle}>{t('co.paidAtReservation')}</h3>
            <span style={styles.empty}>
              <Trans t={t} i18nKey="co.orderLink" values={{ number: order.prepaid.order_number }} components={[<a key="a" href={`/receipt/${order.prepaid.id}`} style={{ color: 'var(--color-primary)' }}
                onClick={(e) => { e.preventDefault(); navigate(`/receipt/${order.prepaid!.id}`); }} />]} />
              {order.prepaid.completed_at ? ` · ${formatDateOnly(order.prepaid.completed_at)}` : ''}
              {order.prepaid.payment_method ? ` · ${payMethodLabel(order.prepaid.payment_method)}` : ''}
            </span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th style={styles.th}>{t('co.col.item')}</th>
                <th style={styles.th}>{t('co.col.variant')}</th>
                <th style={styles.thRight}>{t('co.col.qty')}</th>
                <th style={styles.thRight}>{t('co.col.price')}</th>
                <th style={styles.thRight}>{t('co.col.tax')}</th>
                <th style={styles.thRight}>{t('co.col.total')}</th>
                {isOpen && <th style={styles.th}><span style={srOnly}>{t('co.col.actions')}</span></th>}
              </tr>
            </thead>
            <tbody>
              {order.prepaid.items.map((item) => (
                <tr key={item.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={styles.td}>
                    <span style={styles.itemTypeLabel}>{typeLabel(item.item_type)}:</span>{' '}
                    {(item.refunded_quantity || 0) >= item.quantity ? <s><strong>{item.item_name}</strong></s> : <strong>{item.item_name}</strong>}
                    {(item.refunded_quantity || 0) > 0 && <div style={styles.overrideInline}>{(item.refunded_quantity || 0) < item.quantity ? t('co.refundedPartial', { refunded: item.refunded_quantity, quantity: item.quantity }) : t('co.refunded')}</div>}
                    {item.credited_name && <div style={styles.overrideInline}>{t('co.creditName', { name: item.credited_name })}</div>}
                    {item.paid_with && <div style={styles.overrideInline}>{t('co.paidWith', { name: item.paid_with })}</div>}
                  </td>
                  <td style={styles.td}>{item.variant_name || '—'}</td>
                  <td style={styles.tdRight}>{item.quantity}</td>
                  <td style={styles.tdRight}>{formatCurrency(item.unit_price)}</td>
                  <td style={styles.tdRight}>{item.tax_amount > 0 ? formatCurrency(item.tax_amount) : '—'}</td>
                  <td style={{ ...styles.tdRight, fontWeight: 600 }}>{formatCurrency(item.total_price)}</td>
                  {isOpen && (
                    <td style={styles.tdRight}>
                      {/* An add-on paid at reservation can be removed, with a refund (spec 51, gap 15) */}
                      {item.booking_addon_id && order.booking_id && (item.refunded_quantity || 0) < item.quantity && (
                        <Button size="sm" variant="ghost" aria-label={t('co.removeItem', { name: item.item_name })}
                          onClick={() => setRemovingAddon({ bookingAddonId: item.booking_addon_id!, name: item.item_name,
                            amount: Math.round((item.total_price * (item.quantity - (item.refunded_quantity || 0))) / item.quantity) })}>
                          {t('co.remove')}
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {removingAddon && order.booking_id && (
            <RemovePaidAddonModal bookingId={order.booking_id} businessId={businessId} bookingAddonId={removingAddon.bookingAddonId}
              name={removingAddon.name} amount={removingAddon.amount} hasCustomer={!!order.customer_id}
              onClose={() => setRemovingAddon(null)}
              onDone={(message) => { setRemovingAddon(null); setAddonNotice(message); loadOrder(); }} />
          )}
          {addonNotice && <p style={{ ...styles.empty, margin: 'var(--space-sm) 0 0', color: 'var(--color-success)' }} role="status">{addonNotice}</p>}
          {order.prepaid.status === 'partially_refunded' && (order.prepaid.refunded_amount || 0) > 0 && (
            <div style={{ ...styles.totalRow, marginTop: 'var(--space-sm)' }}>
              <span>{t('co.refundedSince')}</span>
              <span>−{formatCurrency(order.prepaid.refunded_amount || 0)}</span>
            </div>
          )}
          <div style={{ ...styles.totalRow, marginTop: 'var(--space-sm)' }}>
            <span>{order.prepaid.status === 'refunded' ? t('co.refunded') : t('co.paid')}</span>
            <span>{formatCurrency(order.prepaid.status === 'partially_refunded' ? order.prepaid.total_amount - (order.prepaid.refunded_amount || 0) : order.prepaid.total_amount)}</span>
          </div>
          <p style={{ ...styles.empty, margin: 'var(--space-xs) 0 0' }}>
            {order.prepaid.status === 'refunded'
              ? t('co.prepaidRefunded')
              : t('co.prepaidNote')}
          </p>
        </div>
      )}

      {/* Line Items */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h3 style={styles.cardTitle}>{t('co.items')}</h3>
          {isOpen && <Button variant="secondary" size="sm" onClick={() => { setShowAddItem(true); loadStock(); }}>{t('co.addItem')}</Button>}
        </div>

        {isOpen && stockNote && (
          <div role="status" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-sm)', padding: 'var(--space-sm) var(--space-md)', marginBottom: 'var(--space-sm)', border: '1px solid var(--color-warning)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
            <span>{stockNote}</span>
          </div>
        )}

        {order.items.length === 0 && <p style={styles.empty}>{order.prepaid ? t('co.nothingElseSold') : t('co.noItems')}</p>}

        {order.items.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th style={styles.th}>{t('co.col.item')}</th>
                <th style={styles.th}>{t('co.col.variant')}</th>
                <th style={styles.thRight}>{t('co.col.qty')}</th>
                <th style={styles.thRight}>{t('co.col.price')}</th>
                <th style={styles.thRight}>{t('co.col.adj')}</th>
                <th style={styles.thRight}>{t('co.col.tax')}</th>
                <th style={styles.thRight}>{t('co.col.total')}</th>
                {isOpen && <th style={{ width: '50px' }} />}
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                editingItemId === item.id && isOpen ? (
                  <tr key={item.id}>
                    <td colSpan={isOpen ? 8 : 7} style={{ padding: '8px 0' }}>
                      <InlineEditItem
                        item={item}
                        orderId={order.id}
                        staffList={staffList}
                        maxQty={item.item_type === 'product' ? maxFor(item.item_id, item.variant_id ?? null, item.id) : null}
                        onSaved={(updated) => { applyOrder(updated, item.item_name, true); setEditingItemId(null); }}
                        onCancel={() => setEditingItemId(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={item.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={styles.td}>
                      <span style={styles.itemTypeLabel}>{typeLabel(item.item_type)}:</span>{' '}
                      <strong>{item.item_name}</strong>
                      {isOpen && item.item_type === 'product' && (() => {
                        const s = stockOf(item.item_id, item.variant_id ?? null);
                        if (!s) return null;
                        // The order's lines for this item together, against what is on hand.
                        const onOrder = order.items
                          .filter((o) => o.item_type === 'product' && o.item_id === item.item_id && (o.variant_id ?? null) === (item.variant_id ?? null))
                          .reduce((n, o) => n + o.quantity, 0);
                        return onOrder > s.onHand
                          ? <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-error)' }}>{t('co.onlyInStock', { count: s.onHand })}</div>
                          : <div style={{ fontSize: 'var(--font-size-xs)', color: stockColor(s) }}>{t('co.inStock', { count: s.onHand })}</div>;
                      })()}
                      {item.credited_to && item.credited_to !== order.credited_to && (
                        <div style={styles.overrideInline}>{t('co.creditName', { name: `${item.credited_first_name} ${item.credited_last_name}` })}</div>
                      )}
                      {/* Paid with a membership or package (spec 51, gap 19): which one, and change it */}
                      {item.benefit && (
                        <div style={{ ...styles.overrideInline, color: 'var(--color-success, var(--color-text))' }}>
                          {t('co.paidWith', { name: item.benefit.name })}
                          {canUseBenefit(item) && benefitLineId !== item.id && <> · <button type="button" style={styles.linkBtn} onClick={() => setBenefitLineId(item.id)}>{t('co.change')}</button></>}
                        </div>
                      )}
                      {!item.benefit && canUseBenefit(item) && benefitLineId !== item.id && (
                        <div><button type="button" style={styles.linkBtn} onClick={() => setBenefitLineId(item.id)}>{t('co.payWithBenefit')}</button></div>
                      )}
                      {benefitLineId === item.id && (
                        <LineBenefitPicker order={order} itemId={item.id} businessId={businessId} onChanged={setOrder} onClose={() => setBenefitLineId(null)} />
                      )}
                    </td>
                    <td style={styles.td}>{item.variant_name || '—'}</td>
                    <td style={styles.tdRight}>{item.quantity}</td>
                    <td style={styles.tdRight}>{formatCurrency(item.unit_price)}</td>
                    <td style={styles.tdRight}>
                      {item.discount_amount > 0 && <span style={{ color: 'var(--color-success, #2E7D32)' }}>-{formatCurrency(item.discount_amount)}</span>}
                      {item.discount_amount < 0 && <span style={{ color: 'var(--color-error, #D32F2F)' }}>+{formatCurrency(Math.abs(item.discount_amount))}</span>}
                      {item.discount_amount === 0 && '—'}
                    </td>
                    <td style={styles.tdRight}>{item.tax_amount > 0 ? formatCurrency(item.tax_amount) : '—'}</td>
                    <td style={{ ...styles.tdRight, fontWeight: 600 }}>{formatCurrency(item.total_price)}</td>
                    {isOpen && (
                      <td style={{ ...styles.tdRight, whiteSpace: 'nowrap' as const, verticalAlign: 'middle' as const }}>
                        <button style={styles.editBtn} onClick={() => setEditingItemId(item.id)} title={t('co.edit')}>✏️</button>
                        {!isBookingService(item) && <button style={styles.removeBtn} onClick={() => handleRemoveItem(item)} title={t('co.remove')} aria-label={t('co.removeItem', { name: item.item_name })}>✕</button>}
                      </td>
                    )}
                  </tr>
                )
              ))}
            </tbody>
          </table>
        )}

        {/* Inline Add Item Row */}
        {showAddItem && isOpen && (
          <InlineAddItem
            orderId={order.id}
            offerings={offerings}
            staffList={staffList}
            customerId={order.customer_id}
            stockOf={stockOf}
            maxFor={maxFor}
            onAdded={(updated, name) => { applyOrder(updated, name, false); setShowAddItem(false); }}
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
        <div style={styles.totalRow}><span>{t('co.subtotal')}</span><span>{formatCurrency(order.subtotal)}</span></div>
        {order.discount_amount > 0 && <div style={styles.totalRow}><span>{order.promo_code ? t('co.discountCode', { code: order.promo_code }) : t('co.discount')}</span><span>-{formatCurrency(order.discount_amount)}</span></div>}
        {order.discount_amount < 0 && <div style={styles.totalRow}><span>{order.promo_code ? t('co.surchargeCode', { code: order.promo_code }) : t('co.surcharge')}</span><span>+{formatCurrency(Math.abs(order.discount_amount))}</span></div>}
        {order.tax_amount > 0 && <div style={styles.totalRow}><span>{t('co.col.tax')}</span><span>{formatCurrency(order.tax_amount)}</span></div>}
        <div style={{ ...styles.totalRow, fontWeight: 700, fontSize: 'var(--font-size-lg)', borderTop: '1px solid var(--color-border)', paddingTop: '8px', marginTop: '8px' }}>
          <span>{t('co.col.total')}</span><span>{formatCurrency(order.total_amount)}</span>
        </div>
        {(order.tip_amount || 0) > 0 && <>
          <div style={styles.totalRow}><span>{t('tip.title')}</span><span>{formatCurrency(order.tip_amount || 0)}</span></div>
          <div style={{ ...styles.totalRow, fontWeight: 700 }}><span>{isOpen ? t('co.totalToPay') : t('co.totalPaid')}</span><span>{formatCurrency(payable)}</span></div>
        </>}
      </div>

      {/* Tip (spec 51, gap 14): before the payment, when the business takes tips */}
      {isOpen && tipSettings?.enabled && (order.items.length > 0 || order.prepaid?.status === 'completed' || order.prepaid?.status === 'partially_refunded')
        && ((order.tip_base?.total ?? order.total_amount) > 0 || ((order.prepaid?.status === 'completed' || order.prepaid?.status === 'partially_refunded') && order.prepaid.total_amount > 0) || (order.tip_amount || 0) > 0) && (
        <TipPanel order={order} businessId={businessId} settings={tipSettings} locked={!!oneTimeSession} onChange={setOrder} />
      )}

      {/* Paid at reservation with nothing else sold and no tip: nothing to pay, just finish */}
      {isOpen && nothingToPay && (
        <div style={styles.card}>
          <p style={{ color: 'var(--color-text)', margin: 0 }}>
            {t('co.nothingDue')}
          </p>
          <div style={{ ...styles.actions, marginTop: 'var(--space-md)' }}>
            <Button onClick={handleFinishPrepaid} loading={completing}>{t('co.finishAppointment')}</Button>
          </div>
        </div>
      )}

      {/* Payment Actions: what is sold at the visit and the tip (a service paid at reservation is not charged again) */}
      {isOpen && !nothingToPay && (
        <div style={styles.card}>
          <h3 style={{ color: 'var(--color-text)', margin: '0 0 12px', fontSize: 'var(--font-size-md)' }}>{t('co.payment')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '420px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('takePayment.method')}</label>
              <select
                style={paySelectStyle}
                value={payMethod}
                onChange={(e) => { setPayMethod(e.target.value); setPayAddingMethod(false); setPayStoredMethodId(''); }}
              >
                {(acceptedMethods.length > 0 ? acceptedMethods : ['cash']).map((m) => (
                  <option key={m} value={m}>{payMethodLabel(m)}</option>
                ))}
              </select>
            </div>

            {isProcessedMethod(payMethod) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('takePayment.storedMethod')}</label>
                {!order.customer_id ? (
                  // Walk-in (no customer): card only, charged once and NOT saved. Direct
                  // debit / wallets require a customer (they vault), so restrict to card.
                  payMethod !== 'card' ? (
                    <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-warning)' }}>{t('co.addCustomerToPay', { method: payMethodLabel(payMethod) })}</span>
                  ) : oneTimeSession ? (
                    <StripeOneTimeCardCharge
                      clientSecret={oneTimeSession.clientSecret!}
                      publishableKey={oneTimeSession.publishableKey!}
                      busyLabel={t('co.charge', { amount: formatCurrency(payable) })}
                      onPaid={(piId) => handleWalkInCardPaid(piId)}
                      onCancel={() => setOneTimeSession(null)}
                    />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <input
                        style={paySelectStyle}
                        value={walkInName}
                        placeholder={t('co.walkInName')}
                        onChange={(e) => setWalkInName(e.target.value)}
                      />
                      <AddMethodButton
                        label={t('co.enterCard', { amount: formatCurrency(payable) })}
                        onClick={handleStartOneTimeCharge}
                      />
                      {startingOneTime && <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>{t('co.preparingCard')}</span>}
                    </div>
                  )
                ) : (
                  <>
                    {(() => {
                      const matching = storedMethods.filter((m) =>
                        payMethod === 'bank_draw' ? m.method_type === 'bank_draw' : m.method_type !== 'bank_draw',
                      );
                      const effectiveId = matching.some((m) => m.id === payStoredMethodId) ? payStoredMethodId : (matching[0]?.id ?? '');
                      return matching.length > 0 && !payAddingMethod ? (
                        <select style={paySelectStyle} value={effectiveId} onChange={(e) => setPayStoredMethodId(e.target.value)}>
                          {matching.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.display_brand || payMethodLabel(m.method_type)}{m.display_last4 ? ` ···· ${m.display_last4}` : ''}{m.is_default ? ` ${t('takePayment.defaultTag')}` : ''}
                            </option>
                          ))}
                        </select>
                      ) : null;
                    })()}
                    {payAddingMethod ? (
                      <AddPaymentMethodInline
                        owner={{ owner_level: 'customer', business_id: businessId, customer_id: order.customer_id }}
                        allowedTypes={[payMethod as MethodType]}
                        onAdded={(m) => {
                          setStoredMethods((prev) => [m, ...prev.filter((x) => x.id !== m.id)]);
                          setPayStoredMethodId(m.id);
                          setPayAddingMethod(false);
                        }}
                        onCancel={() => setPayAddingMethod(false)}
                      />
                    ) : (
                      <AddMethodButton
                        label={storedMethods.length > 0 ? t('takePayment.addNew') : t('takePayment.addToCharge')}
                        onClick={() => setPayAddingMethod(true)}
                      />
                    )}
                  </>
                )}
              </div>
            )}

            {payMethod === 'gift_card' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('takePayment.giftCode')}</label>
                <input style={paySelectStyle} value={payGiftCode} placeholder={t('takePayment.giftCodePlaceholder')} onChange={(e) => setPayGiftCode(e.target.value)} />
              </div>
            )}

            {payMethod === 'check' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('takePayment.checkNumber')}</label>
                <input style={paySelectStyle} value={payCheckNumber} onChange={(e) => setPayCheckNumber(e.target.value)} />
              </div>
            )}
          </div>

          <div style={{ ...styles.actions, marginTop: '16px' }}>
            <Button onClick={handleComplete} loading={completing}>
              {t('co.completePayment', { method: payMethodLabel(payMethod) })}
            </Button>
            <Button variant="secondary" onClick={handleVoid}>{t('co.voidOrder')}</Button>
          </div>
        </div>
      )}

      {isCompleted && (
        <div style={styles.card}>
          <p style={{ color: 'var(--color-text)', margin: '0 0 12px' }}>
            <Trans t={t} i18nKey="co.completedVia" values={{ method: payMethodLabel(order.payment_method ?? ''), date: formatDateTime(order.completed_at) }} components={[<strong key="s" />]} />
          </p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('co.receiptLabel')}</span>
            <Button size="sm" variant="secondary" loading={receiptBusy} onClick={() => handleReceipt('email')}>{t('takePayment.receiptEmail')}</Button>
            <Button size="sm" variant="secondary" loading={receiptBusy} onClick={() => handleReceipt('print')}>{t('takePayment.receiptPrint')}</Button>
            <Button size="sm" variant="secondary" loading={receiptBusy} onClick={() => handleReceipt('both')}>{t('takePayment.receiptBothButton')}</Button>
          </div>
          {/* The sale is finished: back to the Bookings screen, ready for the next customer. */}
          <div style={{ marginTop: '16px' }}>
            <Button onClick={() => navigate('/bookings')}>{t('takePayment.done')}</Button>
          </div>
          {receiptNote && <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '8px 0 0' }}>{receiptNote}</p>}
        </div>
      )}

    </div>
  );
}

// ============================================================
// Inline Add Item Row
// ============================================================

function InlineAddItem({ orderId, offerings, staffList, customerId, stockOf, maxFor, onAdded, onCancel }: {
  orderId: string;
  offerings: { services: any[]; products: any[]; memberships: any[]; packages: any[] };
  staffList: any[];
  customerId: string | null;
  stockOf: StockOf;
  maxFor: MaxFor;
  onAdded: (order: Order, lineName: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('checkout');
  const [itemType, setItemType] = useState<'service' | 'product' | 'membership' | 'package' | 'gift_card'>('product');
  const [selectedId, setSelectedId] = useState('');
  const [variants, setVariants] = useState<any[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [creditedTo, setCreditedTo] = useState('');
  const [saving, setSaving] = useState(false);
  // Gift-card line fields (free-form; no catalog item).
  const [giftAmount, setGiftAmount] = useState(0);          // cents
  const [giftRecipientName, setGiftRecipientName] = useState('');
  const [giftRecipientEmail, setGiftRecipientEmail] = useState('');
  // Expiry date for the card (YYYY-MM-DD). Pre-filled from the business's expiry
  // setting (purchase date + expiry_days); staff can override or clear it. Empty
  // string = no expiry.
  const [giftExpiry, setGiftExpiry] = useState('');

  // When the gift-card line opens, compute the default expiry from the business
  // setting: today + expiry_days. 0 days (or failure) → no default (blank).
  useEffect(() => {
    if (itemType !== 'gift_card') return;
    const bizId = localStorage.getItem('business_id') || '';
    if (!bizId) return;
    let cancelled = false;
    import('../api/payments').then((payApi) => {
      payApi.getGiftCardExpiryDays(bizId).then((days) => {
        if (cancelled) return;
        if (days > 0) {
          const d = new Date();
          d.setDate(d.getDate() + days);
          setGiftExpiry(d.toISOString().slice(0, 10));
        } else {
          setGiftExpiry('');
        }
      }).catch(() => { if (!cancelled) setGiftExpiry(''); });
    });
    return () => { cancelled = true; };
  }, [itemType]);

  // Services sold at the visit as well (owner, 23 Nov 2026): the active ones, priced by their options.
  const itemList = itemType === 'service' ? offerings.services.filter((s: any) => !s.status || s.status === 'active')
    : itemType === 'product' ? offerings.products
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
    } else if (itemType === 'service' && selectedId) {
      // A service's options carry its price (and length); the only option is chosen for you.
      import('../api/services').then((svcApi) => {
        svcApi.getVariants(selectedId).then((v) => {
          const list = (v || []).filter((x: any) => !x.status || x.status === 'active');
          setVariants(list);
          setSelectedVariantId(list.length === 1 ? list[0].id : '');
        }).catch(() => setVariants([]));
      });
    } else {
      setVariants([]);
      setSelectedVariantId('');
    }
  }, [itemType, selectedId]);

  const handleAdd = async () => {
    // Gift card: a free-form stored-value sale (no catalog item). The amount IS the
    // face value / price; recipient is optional.
    if (itemType === 'gift_card') {
      if (giftAmount <= 0) { void showMessage({ message: t('co.add.giftAmountRequired'), tone: 'info' }); return; }
      setSaving(true);
      try {
        const updated = await checkoutApi.addItem(orderId, {
          item_type: 'gift_card',
          item_name: giftRecipientName ? `Gift Card for ${giftRecipientName}` : 'Gift Card',
          quantity: 1,
          unit_price: giftAmount,
          gift_recipient_name: giftRecipientName || null,
          gift_recipient_email: giftRecipientEmail || null,
          // Explicit: the shown date, or null when staff cleared it (no expiry).
          gift_expiry: giftExpiry || null,
        });
        onAdded(updated, 'Gift card');
      } catch { void showMessage({ message: t('co.add.giftFailed'), tone: 'error' }); }
      finally { setSaving(false); }
      return;
    }

    if (!selectedItem) return;

    // Warn if adding a membership and customer already has one
    if (itemType === 'membership' && customerId) {
      try {
        const { apiClient } = await import('../api/client');
        const res = await apiClient.get(`/v1/memberships/enrollments?business_id=${localStorage.getItem('business_id')}&customer_id=${customerId}&status=active`);
        const enrollments = res.data.data || [];
        const activeOrPaused = enrollments.filter((e: any) => e.status === 'active' || e.status === 'paused');
        if (activeOrPaused.length > 0) {
          if (!(await askConfirm({ message: t('co.add.membershipConfirm'), confirmLabel: t('common:action.continue') }))) return;
        }
      } catch { /* proceed if check fails */ }
    }

    if (itemType === 'service' && variants.length > 0 && !selectedVariant) { void showMessage({ message: t('co.add.chooseOption'), tone: 'info' }); return; }
    const price = selectedVariant?.price ?? selectedItem.price ?? 0;
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
      onAdded(updated, variantName ? `${selectedItem.name} (${variantName})` : selectedItem.name);
    } catch (err) {
      // A tracked product with none left to add is refused with the reason (spec 51, gap 7).
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      void showMessage({ message: code === 'OUT_OF_STOCK' ? t('co.add.nameError', { name: selectedItem.name, error: errText(err, t('co.add.outOfStock')) }) : errText(err, t('co.add.failed')), tone: 'error' });
    }
    finally { setSaving(false); }
  };

  // Stock of what is chosen: the option, or the product when it has no options.
  const isProduct = itemType === 'product';
  // A tracked product with options is stocked per option: one must be chosen before stock is shown.
  const needsOption = isProduct && !!selectedId && variants.length > 0 && !selectedVariantId && stockOf(selectedId, undefined) !== null;
  const chosenStock = isProduct && selectedId && !needsOption ? stockOf(selectedId, selectedVariantId || null) : null;
  // The quantity never goes above what may still be added: typed numbers are brought down to it.
  const maxQty = chosenStock ? maxFor(selectedId, selectedVariantId || null) : null;
  useEffect(() => {
    if (maxQty != null && maxQty > 0 && quantity > maxQty) setQuantity(maxQty);
  }, [maxQty, quantity]);

  if (itemType === 'gift_card') {
    return (
      <div style={{ ...styles.lineItem, background: 'var(--color-background)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select style={styles.inlineSelect} value={itemType} onChange={(e) => { setItemType(e.target.value as any); setSelectedId(''); }}>
            <option value="service">{t('co.add.type.service')}</option>
            <option value="product">{t('co.add.type.product')}</option>
            <option value="membership">{t('co.add.type.membership')}</option>
            <option value="package">{t('co.add.type.package')}</option>
            <option value="gift_card">{t('co.add.type.gift_card')}</option>
          </select>
          <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('takePayment.amount')}
            <span style={{ marginLeft: '4px', display: 'inline-block' }}>
              <CurrencyInput value={giftAmount} onChange={setGiftAmount} />
            </span>
          </label>
          <input style={{ ...styles.inlineSelect, minWidth: '150px' }} placeholder={t('co.add.recipientName')} value={giftRecipientName} onChange={(e) => setGiftRecipientName(e.target.value)} />
          <input style={{ ...styles.inlineSelect, minWidth: '180px' }} placeholder={t('co.add.recipientEmail')} value={giftRecipientEmail} onChange={(e) => setGiftRecipientEmail(e.target.value)} />
          <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            {t('co.add.expires')}
            <input type="date" style={{ ...styles.inlineSelect, minWidth: '150px' }} value={giftExpiry} onChange={(e) => setGiftExpiry(e.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: '4px' }}>
            <Button size="sm" onClick={handleAdd} loading={saving} disabled={giftAmount <= 0}>{t('co.add.add')}</Button>
            <Button variant="secondary" size="sm" onClick={onCancel}>✕</Button>
          </div>
        </div>
        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', margin: '6px 0 0' }}>
          {t('co.add.giftNote')}
        </p>
      </div>
    );
  }

  return (
    <div style={{ ...styles.lineItem, background: 'var(--color-background)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr auto 45px 120px auto', gap: '6px', alignItems: 'center' }}>
        <select style={styles.inlineSelect} value={itemType} onChange={(e) => { setItemType(e.target.value as any); setSelectedId(''); }}>
          <option value="service">{t('co.add.type.service')}</option>
          <option value="product">{t('co.add.type.product')}</option>
          <option value="membership">{t('co.add.type.membership')}</option>
          <option value="package">{t('co.add.type.package')}</option>
          <option value="gift_card">{t('co.add.type.gift_card')}</option>
        </select>
        <select style={styles.inlineSelect} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          <option value="">{t('co.add.selectItem')}</option>
          {itemList.map((item: any) => {
            const s = isProduct ? stockOf(item.id, undefined) : null;
            return (
              <option key={item.id} value={item.id} disabled={s?.onHand === 0}>
                {item.name}{itemType === 'service' ? (item.min_price != null ? ` — ${t('co.add.from', { price: formatCurrency(item.min_price) })}` : '') : ` — ${formatCurrency(item.price)}`}{s ? ` · ${stockText(s)}` : ''}
              </option>
            );
          })}
        </select>
        {variants.length > 0 ? (
          <select style={{ ...styles.inlineSelect, minWidth: '110px' }} value={selectedVariantId} onChange={(e) => setSelectedVariantId(e.target.value)}>
            {itemType === 'service' || stockOf(selectedId, undefined) !== null
              ? <option value="">{t('co.add.chooseOptionItem')}</option>
              : <option value="">{t('co.add.base', { price: formatCurrency(selectedItem?.price || 0) })}</option>}
            {variants.map((v: any) => {
              const s = stockOf(selectedId, v.id);
              return <option key={v.id} value={v.id} disabled={s?.onHand === 0}>{v.name} — {formatCurrency(v.price)}{s ? ` · ${stockText(s)}` : ''}</option>;
            })}
          </select>
        ) : (
          <span />
        )}
        <input type="number" min="1" max={maxQty != null && maxQty > 0 ? maxQty : undefined}
          style={{ ...styles.inlineSelect, width: '40px', textAlign: 'center' as const }} value={quantity} onChange={(e) => setQuantity(clampQty(e.target.value, maxQty))} aria-label={t('co.add.quantity')} />
        <select style={styles.inlineSelect} value={creditedTo} onChange={(e) => setCreditedTo(e.target.value)}>
          <option value="">{t('co.add.override')}</option>
          {staffList.map((s: any) => (
            <option key={s.user_id} value={s.user_id}>{s.first_name} {s.last_name}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: '4px' }}>
          <Button size="sm" onClick={handleAdd} loading={saving} disabled={!selectedId || needsOption || maxQty === 0 || (itemType === 'service' && variants.length > 0 && !selectedVariantId)}>{t('co.add.add')}</Button>
          <Button variant="secondary" size="sm" onClick={onCancel}>✕</Button>
        </div>
      </div>
      {/* The lists show what is in stock; a note only when nothing more can be added (Add is greyed out). */}
      {chosenStock && maxQty === 0 && chosenStock.onHand > 0 && (
        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', margin: '6px 0 0' }}>
          {t('co.add.allOnOrder', { count: chosenStock.onHand })}
        </p>
      )}
    </div>
  );
}

// ============================================================
// Promo Code Input
// ============================================================

function PromoCodeInput({ order, businessId, onUpdated }: { order: Order; businessId: string; onUpdated: (o: Order) => void }) {
  const { t } = useTranslation('checkout');
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
      setError(err?.response?.data?.error || t('co.promo.invalid'));
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
    const isDiscount = order.discount_amount > 0;
    const isSurcharge = order.discount_amount < 0;
    return (
      <div style={{ ...styles.card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px var(--space-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('co.promo.label')}</span>
          <strong style={{ color: 'var(--color-text)' }}>{order.promo_code}</strong>
          {isDiscount && <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-success, #2E7D32)' }}>−{formatCurrency(order.discount_amount)}</span>}
          {isSurcharge && <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-error, #D32F2F)' }}>+{formatCurrency(Math.abs(order.discount_amount))}</span>}
        </div>
        <button style={styles.removeBtn} onClick={handleRemove} title={t('co.promo.remove')}>✕</button>
      </div>
    );
  }

  return (
    <div style={{ ...styles.card, display: 'flex', alignItems: 'center', gap: '8px', padding: '12px var(--space-lg)' }}>
      <input
        style={{ ...styles.inlineSelect, flex: 1, maxWidth: '200px' }}
        value={code}
        onChange={(e) => { setCode(e.target.value); setError(''); }}
        placeholder={t('co.promo.placeholder')}
        onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }}
      />
      <Button size="sm" variant="secondary" onClick={handleApply} loading={applying} disabled={!code.trim()}>{t('co.promo.apply')}</Button>
      {error && <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-error)' }}>{error}</span>}
    </div>
  );
}

// ============================================================
// Inline Edit Item Row
// ============================================================

function InlineEditItem({ item, orderId, staffList, maxQty, onSaved, onCancel }: {
  item: OrderItem;
  orderId: string;
  staffList: any[];
  maxQty: number | null;
  onSaved: (order: Order) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('checkout');
  const [quantity, setQuantity] = useState(item.quantity);
  // A tracked product: the quantity cannot be raised above what is in stock (less the order's other lines).
  const cap = maxQty != null ? Math.max(1, maxQty) : null;
  const [creditedTo, setCreditedTo] = useState(item.credited_to || '');
  const [variants, setVariants] = useState<any[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState(item.variant_id || '');
  const [saving, setSaving] = useState(false);

  // Load variants for products
  useEffect(() => {
    if (item.item_type === 'product' && item.item_id) {
      import('../api/client').then(({ apiClient }) => {
        apiClient.get(`/v1/merchandise/${item.item_id}/variants`).then((res) => {
          setVariants(res.data.data || []);
        }).catch(() => setVariants([]));
      });
    }
  }, [item.item_type, item.item_id]);

  const selectedVariant = variants.find((v: any) => v.id === selectedVariantId);
  const currentPrice = selectedVariant?.price ?? item.unit_price;

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await checkoutApi.updateItem(orderId, item.id, {
        quantity,
        unit_price: currentPrice,
        credited_to: creditedTo || null,
      });
      onSaved(updated);
    } catch (err) { void showMessage({ message: errText(err, t('co.edit.failed')), tone: 'error' }); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ ...styles.lineItem, background: 'var(--color-background)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr auto 45px 120px auto', gap: '6px', alignItems: 'center' }}>
        <span style={styles.itemTypeLabel}>{typeLabel(item.item_type)}:</span>
        <strong style={{ color: 'var(--color-text)', fontSize: 'var(--font-size-sm)' }}>{item.item_name}</strong>
        {variants.length > 0 ? (
          <select style={{ ...styles.inlineSelect, minWidth: '110px' }} value={selectedVariantId} onChange={(e) => setSelectedVariantId(e.target.value)}>
            <option value="">{t('co.add.base', { price: formatCurrency(item.unit_price) })}</option>
            {variants.map((v: any) => (
              <option key={v.id} value={v.id}>{v.name} — {formatCurrency(v.price)}</option>
            ))}
          </select>
        ) : (
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{item.variant_name ? `(${item.variant_name})` : ''} {formatCurrency(currentPrice)}</span>
        )}
        <input type="number" min="1" max={cap ?? undefined} style={{ ...styles.inlineSelect, width: '40px', textAlign: 'center' as const }} value={quantity} onChange={(e) => setQuantity(clampQty(e.target.value, cap))} title={t('co.add.quantity')} />
        <select style={styles.inlineSelect} value={creditedTo} onChange={(e) => setCreditedTo(e.target.value)}>
          <option value="">{t('co.add.override')}</option>
          {staffList.map((s: any) => (
            <option key={s.user_id} value={s.user_id}>{s.first_name} {s.last_name}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: '4px' }}>
          <Button size="sm" onClick={handleSave} loading={saving}>{t('common:save')}</Button>
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
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', margin: 0 },
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
  linkBtn: { background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', cursor: 'pointer', fontSize: 'var(--font-size-xs)', fontFamily: 'var(--font-family)', textDecoration: 'underline' },
  itemTypeLabel: { fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text-secondary)', minWidth: '80px' },
  overrideInline: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginLeft: '12px', fontStyle: 'italic' as const },
  lineItemMeta: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  variant: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  qty: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginLeft: '4px' },
  price: { fontWeight: 600, color: 'var(--color-text)', fontSize: 'var(--font-size-base)' },
  th: { textAlign: 'left' as const, fontSize: 'var(--font-size-xs)', fontWeight: 600, textTransform: 'uppercase' as const, color: 'var(--color-text-secondary)', padding: '8px 4px' },
  thRight: { textAlign: 'right' as const, fontSize: 'var(--font-size-xs)', fontWeight: 600, textTransform: 'uppercase' as const, color: 'var(--color-text-secondary)', padding: '8px 4px' },
  td: { padding: '10px 4px', verticalAlign: 'top' as const, color: 'var(--color-text)' },
  tdRight: { padding: '10px 4px', textAlign: 'right' as const, verticalAlign: 'top' as const, color: 'var(--color-text)' },
  creditSelect: { fontSize: 'var(--font-size-sm)', padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)', color: 'var(--color-text)', fontFamily: 'var(--font-family)' },
  inlineSelect: { fontSize: 'var(--font-size-sm)', padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-background)', color: 'var(--color-text)', fontFamily: 'var(--font-family)' },
  removeBtn: { background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontSize: 'var(--font-size-base)', padding: '0', lineHeight: 1, verticalAlign: 'middle' as const, borderRadius: 'var(--button-radius)', minHeight: 'var(--button-height-sm)' },
  editBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-base)', padding: '0', lineHeight: 1, verticalAlign: 'middle' as const, borderRadius: 'var(--button-radius)', minHeight: 'var(--button-height-sm)' },
  totalRow: { display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 'var(--font-size-base)', color: 'var(--color-text)' },
  actions: { display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-md)' },
};
