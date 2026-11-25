import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  createBooking, enrollMembership, findOrCreateCustomer, getBusinessInfo, getProductDetail, holdSlot,
  payForBooking, payForMembershipEnrollment, payForPackagePurchase, purchasePackage,
  WidgetApiError, WidgetAuthResult, WidgetBusinessInfo,
} from '../api/widget';
import { PublicLanguageBar } from '../components/PublicLanguageBar';
import { applyBaseTheme, applyResolvedTokens } from '../context/ThemeManager';
import { ProgressIndicator } from './booking-widget/ProgressIndicator';
import { ProductDetailStep } from './booking-widget/ProductDetailStep';
import { PackageProductDetailStep } from './booking-widget/PackageProductDetailStep';
import { AvailabilityCalendarStep } from './booking-widget/AvailabilityCalendarStep';
import { TimeSlotPickerStep } from './booking-widget/TimeSlotPickerStep';
import { LoginRegisterStep } from './booking-widget/LoginRegisterStep';
import { CustomerDetailsStep } from './booking-widget/CustomerDetailsStep';
import { PaymentStep } from './booking-widget/PaymentStep';
import { ConfirmationStep } from './booking-widget/ConfirmationStep';
import { PurchaseConfirmationStep } from './booking-widget/PurchaseConfirmationStep';
import { AppointmentSummary } from './booking-widget/AppointmentSummary';
import { FlowState, FlowStep, initialFlowState, PACKAGE_STEP_ORDER, PurchaseResult, SERVICE_STEP_ORDER, STEP_LABEL_KEYS } from './booking-widget/types';
import { sendToParent } from './booking-widget/postMessage';
import './BookingWidget.css';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function BookingWidget() {
  const { t } = useTranslation('widget');
  const [params] = useSearchParams();
  const businessId = params.get('business_id') || '';
  const productId = params.get('product_id') || '';

  const [initLoading, setInitLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [businessInfo, setBusinessInfo] = useState<WidgetBusinessInfo | null>(null);

  const [step, setStep] = useState<FlowStep>('product');
  const [flow, setFlow] = useState<FlowState>(() => initialFlowState(businessId, productId));
  const [expiredNotice, setExpiredNotice] = useState(false);

  const [holdLoading, setHoldLoading] = useState(false);
  const [holdError, setHoldError] = useState<string | null>(null);
  const [customerSubmitLoading, setCustomerSubmitLoading] = useState(false);
  const [customerSubmitError, setCustomerSubmitError] = useState<string | null>(null);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const productType = flow.product?.product_type;
  const stepOrder = productType === 'service' ? SERVICE_STEP_ORDER : PACKAGE_STEP_ORDER;

  useEffect(() => {
    if (!businessId || !productId) {
      setInitError(t('init.missingInfo'));
      setInitLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const info = await getBusinessInfo(businessId);
        if (cancelled) return;
        applyBaseTheme(info.theme?.base_theme);
        applyResolvedTokens(info.theme?.tokens);
        setBusinessInfo(info);

        const product = await getProductDetail(businessId, productId);
        if (cancelled) return;
        setFlow((f) => ({ ...f, product, requirePaymentBeforeConfirmation: info.require_payment_before_confirmation }));
        sendToParent('daystream:ready');
      } catch (err) {
        if (!cancelled) setInitError(err instanceof WidgetApiError ? err.message : t('init.loadFailed'));
      } finally {
        if (!cancelled) setInitLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, productId]);

  useEffect(() => {
    // A cross-origin parent can never observe keydown events that occur inside this iframe
    // (browsers don't bubble them across the boundary), so daystream-widget.js's own Escape
    // handler only ever fires while focus is still on its close button. Escape pressed while
    // interacting with the booking form itself has to be caught and relayed from in here.
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') sendToParent('daystream:close');
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  useEffect(() => {
    if (initLoading) return; // wait for the initial 'ready' send so step 1 doesn't race it
    const index = stepOrder.indexOf(step);
    sendToParent('daystream:step_changed', { step: index + 1, stepName: t(STEP_LABEL_KEYS[step], { lng: 'en' }) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, initLoading]);

  useEffect(() => {
    if (step !== 'confirmation') return;
    if (flow.booking) {
      sendToParent('daystream:booking_confirmed', {
        bookingReference: flow.booking.booking_reference,
        serviceName: flow.booking.service_name,
        startTime: flow.booking.start_time,
        status: flow.booking.status,
      });
    } else if (flow.purchase) {
      sendToParent('daystream:booking_confirmed', {
        bookingReference: flow.purchase.id,
        serviceName: flow.purchase.name,
        status: flow.purchase.status,
      });
    }
  }, [step, flow.booking, flow.purchase]);

  const amountCents = useMemo(() => {
    if (productType === 'service') {
      const variant = flow.product?.variants?.find((v) => v.id === flow.selectedVariantId);
      // with the add-ons chosen (spec 51, gap 15)
      const extras = (flow.product?.addons || []).filter((a) => flow.selectedAddonIds.includes(a.id)).reduce((s, a) => s + a.price, 0);
      return (variant?.price ?? 0) + extras;
    }
    return flow.purchase?.price ?? flow.product?.price ?? 0;
  }, [flow.product, flow.selectedVariantId, flow.selectedAddonIds, flow.purchase, productType]);

  // The service as the summary shows it: with its add-ons (spec 51, gap 15).
  const serviceLabel = useMemo(() => {
    const names = (flow.product?.addons || []).filter((a) => flow.selectedAddonIds.includes(a.id)).map((a) => a.name);
    return names.length > 0 ? `${flow.product?.name || ''} + ${names.join(', ')}` : flow.product?.name || '';
  }, [flow.product, flow.selectedAddonIds]);

  function handleServiceProductContinue(variantId: string, addonIds: string[]) {
    setFlow((f) => ({ ...f, selectedVariantId: variantId, selectedAddonIds: addonIds }));
    setStep('calendar');
  }

  function handleNonServiceProductContinue() {
    setStep('auth');
  }

  function handleDateSelect(date: string) {
    setExpiredNotice(false);
    setFlow((f) => ({ ...f, selectedDate: date }));
    setStep('slots');
  }

  function handleSlotSelect(slot: FlowState['selectedSlot']) {
    setFlow((f) => ({ ...f, selectedSlot: slot }));
    setStep('auth');
  }

  async function handleAuthenticated(_auth: WidgetAuthResult) {
    if (!flow.product) return;

    if (productType !== 'service') {
      setHoldLoading(true);
      setHoldError(null);
      try {
        const { customer } = await findOrCreateCustomer(businessId);
        setFlow((f) => ({ ...f, customer }));
        setStep('customer');
      } catch (err) {
        setHoldError(err instanceof WidgetApiError ? err.message : t('errors.generic'));
      } finally {
        setHoldLoading(false);
      }
      return;
    }

    if (!flow.selectedVariantId || !flow.selectedSlot) return;
    setHoldLoading(true);
    setHoldError(null);
    try {
      const hold = await holdSlot(businessId, flow.product.id, flow.selectedVariantId, flow.selectedSlot.start_time);
      const { customer } = await findOrCreateCustomer(businessId);
      setFlow((f) => ({ ...f, holdId: hold.hold_id, holdExpiresAt: hold.expires_at, customer }));
      setStep('customer');
    } catch (err) {
      if (err instanceof WidgetApiError && err.status === 409) {
        setFlow((f) => ({ ...f, holdId: null, selectedSlot: null }));
        setExpiredNotice(true);
        setStep('slots');
      } else {
        setHoldError(err instanceof WidgetApiError ? err.message : t('errors.holdSlot'));
      }
    } finally {
      setHoldLoading(false);
    }
  }

  async function handleCustomerContinue(phone: string) {
    if (!flow.product) return;
    setCustomerSubmitLoading(true);
    setCustomerSubmitError(null);

    if (productType !== 'service') {
      try {
        const { customer } = await findOrCreateCustomer(businessId, phone);
        let purchase: PurchaseResult;
        if (productType === 'package') {
          const result = await purchasePackage(businessId, customer.id, flow.product.id);
          purchase = { kind: 'package', id: result.id, name: result.package_name, price: result.price, status: result.status };
        } else {
          const result = await enrollMembership(businessId, customer.id, flow.product.id, todayIso());
          purchase = { kind: 'membership', id: result.id, name: result.plan_name, price: result.price, status: result.status, billingFrequency: result.billing_frequency };
        }
        setFlow((f) => ({ ...f, customer, phone, purchase }));
        setStep(purchase.status === 'active' ? 'confirmation' : 'payment');
      } catch (err) {
        setCustomerSubmitError(err instanceof WidgetApiError ? err.message : t('errors.generic'));
      } finally {
        setCustomerSubmitLoading(false);
      }
      return;
    }

    if (!flow.selectedVariantId || !flow.selectedSlot) { setCustomerSubmitLoading(false); return; }
    try {
      const { customer } = await findOrCreateCustomer(businessId, phone);
      const booking = await createBooking({
        businessId,
        customerId: customer.id,
        serviceId: flow.product.id,
        variantId: flow.selectedVariantId,
        startTime: flow.selectedSlot.start_time,
        staffId: flow.selectedSlot.staff_id,
        holdId: flow.holdId || undefined,
        addonIds: flow.selectedAddonIds,
      });
      setFlow((f) => ({ ...f, customer, phone, booking }));
      setStep(booking.status === 'confirmed' ? 'confirmation' : 'payment');
    } catch (err) {
      if (err instanceof WidgetApiError && err.status === 409) {
        setFlow((f) => ({ ...f, holdId: null, selectedSlot: null }));
        setExpiredNotice(true);
        setStep('slots');
      } else {
        setCustomerSubmitError(err instanceof WidgetApiError ? err.message : t('errors.generic'));
      }
    } finally {
      setCustomerSubmitLoading(false);
    }
  }

  async function handlePay() {
    setPayLoading(true);
    setPayError(null);
    try {
      if (productType === 'service' && flow.booking) {
        await payForBooking(flow.booking.id, businessId);
        setFlow((f) => (f.booking ? { ...f, booking: { ...f.booking, status: 'confirmed' } } : f));
      } else if (flow.purchase?.kind === 'package') {
        await payForPackagePurchase(flow.purchase.id, businessId);
        setFlow((f) => (f.purchase ? { ...f, purchase: { ...f.purchase, status: 'active' } } : f));
      } else if (flow.purchase?.kind === 'membership') {
        await payForMembershipEnrollment(flow.purchase.id, businessId);
        setFlow((f) => (f.purchase ? { ...f, purchase: { ...f.purchase, status: 'active' } } : f));
      } else {
        return;
      }
      setStep('confirmation');
    } catch (err) {
      setPayError(err instanceof WidgetApiError ? err.message : t('errors.paymentFailed'));
    } finally {
      setPayLoading(false);
    }
  }

  if (initLoading) {
    return <div className="dsw-shell" style={{ position: 'relative' }}><PublicLanguageBar languages={businessInfo?.languages} /><div className="dsw-loading">{t('init.loading')}</div></div>;
  }

  if (initError || !flow.product) {
    return <div className="dsw-shell" style={{ position: 'relative' }}><PublicLanguageBar languages={businessInfo?.languages} /><div className="dsw-error-page">{initError || t('init.unavailable')}</div></div>;
  }

  const itemName = flow.booking?.service_name || flow.purchase?.name || flow.product.name;

  return (
    <div className="dsw-shell" style={{ position: 'relative' }}>
      <PublicLanguageBar languages={businessInfo?.languages} />
      {/* paddingRight keeps a long business name clear of the language menu in the corner */}
      <header className="dsw-header" style={{ paddingRight: '9rem' }}>
        {businessInfo?.logo_url && <img src={businessInfo.logo_url} alt={businessInfo.name} className="dsw-logo" />}
        <span className="dsw-business-name">{businessInfo?.name}</span>
      </header>

      <ProgressIndicator steps={stepOrder} currentStep={step} />

      <main className="dsw-main">
        {step === 'product' && productType === 'service' && (
          <ProductDetailStep
            product={flow.product}
            selectedVariantId={flow.selectedVariantId}
            selectedAddonIds={flow.selectedAddonIds}
            onContinue={handleServiceProductContinue}
          />
        )}

        {step === 'product' && productType !== 'service' && (
          <PackageProductDetailStep product={flow.product} onContinue={handleNonServiceProductContinue} />
        )}

        {step === 'calendar' && flow.selectedVariantId && (
          <AvailabilityCalendarStep
            businessId={businessId}
            serviceId={flow.product.id}
            variantId={flow.selectedVariantId}
            selectedDate={flow.selectedDate}
            onSelectDate={handleDateSelect}
            onBack={() => setStep('product')}
          />
        )}

        {step === 'slots' && flow.selectedVariantId && flow.selectedDate && (
          <TimeSlotPickerStep
            businessId={businessId}
            serviceId={flow.product.id}
            variantId={flow.selectedVariantId}
            date={flow.selectedDate}
            expiredNotice={expiredNotice}
            onSelectSlot={handleSlotSelect}
            onBack={() => setStep(productType === 'service' ? 'calendar' : 'product')}
          />
        )}

        {step === 'auth' && businessInfo && (
          <div>
            <LoginRegisterStep
              tenantId={businessInfo.tenant_id}
              businessId={businessId}
              onAuthenticated={handleAuthenticated}
              onBack={() => setStep(productType === 'service' ? 'slots' : 'product')}
            />
            {holdLoading && <p className="dsw-step-text">{productType === 'service' ? t('auth.securingSlot') : t('auth.oneMoment')}</p>}
            {holdError && <p className="dsw-step-error">{holdError}</p>}
          </div>
        )}

        {step === 'customer' && flow.customer && (
          <>
            {productType === 'service' && flow.selectedSlot && (
              <AppointmentSummary
                productName={serviceLabel}
                startTime={flow.selectedSlot.start_time}
                locationName={flow.selectedSlot.location_name}
                staffName={flow.selectedSlot.staff_id ? `${flow.selectedSlot.staff_first_name} ${flow.selectedSlot.staff_last_name}` : null}
              />
            )}
            <CustomerDetailsStep
              customer={flow.customer}
              isReturning={!!flow.customer.phone}
              onContinue={handleCustomerContinue}
              loading={customerSubmitLoading}
              error={customerSubmitError}
              onBack={() => setStep('auth')}
            />
          </>
        )}

        {step === 'payment' && (flow.booking || flow.purchase) && (
          <>
            {productType === 'service' && flow.selectedSlot && (
              <AppointmentSummary
                productName={serviceLabel}
                startTime={flow.selectedSlot.start_time}
                locationName={flow.selectedSlot.location_name}
                staffName={flow.selectedSlot.staff_id ? `${flow.selectedSlot.staff_first_name} ${flow.selectedSlot.staff_last_name}` : null}
              />
            )}
            <PaymentStep
              itemName={itemName}
              amountCents={amountCents}
              onPay={handlePay}
              loading={payLoading}
              error={payError}
            />
          </>
        )}

        {step === 'confirmation' && flow.booking && (
          <ConfirmationStep booking={flow.booking} locationName={flow.selectedSlot?.location_name} />
        )}

        {step === 'confirmation' && !flow.booking && flow.purchase && (
          <PurchaseConfirmationStep purchase={flow.purchase} />
        )}
      </main>
    </div>
  );
}
