import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  createBooking, findOrCreateCustomer, getBusinessInfo, getProductDetail, holdSlot, payForBooking,
  WidgetApiError, WidgetAuthResult, WidgetBusinessInfo,
} from '../api/widget';
import { applyBaseTheme, applyResolvedTokens } from '../context/ThemeManager';
import { ProgressIndicator } from './booking-widget/ProgressIndicator';
import { ProductDetailStep } from './booking-widget/ProductDetailStep';
import { AvailabilityCalendarStep } from './booking-widget/AvailabilityCalendarStep';
import { TimeSlotPickerStep } from './booking-widget/TimeSlotPickerStep';
import { LoginRegisterStep } from './booking-widget/LoginRegisterStep';
import { CustomerDetailsStep } from './booking-widget/CustomerDetailsStep';
import { PaymentStep } from './booking-widget/PaymentStep';
import { ConfirmationStep } from './booking-widget/ConfirmationStep';
import { AppointmentSummary } from './booking-widget/AppointmentSummary';
import { FlowState, initialFlowState, SERVICE_STEP_LABELS, SERVICE_STEP_ORDER, ServiceFlowStep } from './booking-widget/types';
import { sendToParent } from './booking-widget/postMessage';
import './BookingWidget.css';

export function BookingWidget() {
  const [params] = useSearchParams();
  const businessId = params.get('business_id') || '';
  const productId = params.get('product_id') || '';

  const [initLoading, setInitLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [businessInfo, setBusinessInfo] = useState<WidgetBusinessInfo | null>(null);

  const [step, setStep] = useState<ServiceFlowStep>('product');
  const [flow, setFlow] = useState<FlowState>(() => initialFlowState(businessId, productId));
  const [expiredNotice, setExpiredNotice] = useState(false);

  const [holdLoading, setHoldLoading] = useState(false);
  const [holdError, setHoldError] = useState<string | null>(null);
  const [customerSubmitLoading, setCustomerSubmitLoading] = useState(false);
  const [customerSubmitError, setCustomerSubmitError] = useState<string | null>(null);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId || !productId) {
      setInitError('This booking link is missing required information.');
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
        if (!cancelled) setInitError(err instanceof WidgetApiError ? err.message : 'Failed to load this booking page.');
      } finally {
        if (!cancelled) setInitLoading(false);
      }
    })();

    return () => { cancelled = true; };
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
    sendToParent('daystream:step_changed', { step: SERVICE_STEP_ORDER.indexOf(step) + 1, stepName: SERVICE_STEP_LABELS[step] });
  }, [step, initLoading]);

  useEffect(() => {
    if (step !== 'confirmation' || !flow.booking) return;
    sendToParent('daystream:booking_confirmed', {
      bookingReference: flow.booking.booking_reference,
      serviceName: flow.booking.service_name,
      startTime: flow.booking.start_time,
      status: flow.booking.status,
    });
  }, [step, flow.booking]);

  const amountCents = useMemo(() => {
    const variant = flow.product?.variants.find((v) => v.id === flow.selectedVariantId);
    return variant?.price ?? 0;
  }, [flow.product, flow.selectedVariantId]);

  function handleProductContinue(variantId: string) {
    setFlow((f) => ({ ...f, selectedVariantId: variantId }));
    setStep('calendar');
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
    if (!flow.product || !flow.selectedVariantId || !flow.selectedSlot) return;
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
        setHoldError(err instanceof WidgetApiError ? err.message : 'Something went wrong holding your slot.');
      }
    } finally {
      setHoldLoading(false);
    }
  }

  async function handleCustomerContinue(phone: string) {
    if (!flow.product || !flow.selectedVariantId || !flow.selectedSlot) return;
    setCustomerSubmitLoading(true);
    setCustomerSubmitError(null);
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
      });
      setFlow((f) => ({ ...f, customer, phone, booking }));
      setStep(booking.status === 'confirmed' ? 'confirmation' : 'payment');
    } catch (err) {
      if (err instanceof WidgetApiError && err.status === 409) {
        setFlow((f) => ({ ...f, holdId: null, selectedSlot: null }));
        setExpiredNotice(true);
        setStep('slots');
      } else {
        setCustomerSubmitError(err instanceof WidgetApiError ? err.message : 'Something went wrong.');
      }
    } finally {
      setCustomerSubmitLoading(false);
    }
  }

  async function handlePay() {
    if (!flow.booking) return;
    setPayLoading(true);
    setPayError(null);
    try {
      await payForBooking(flow.booking.id, businessId);
      setFlow((f) => (f.booking ? { ...f, booking: { ...f.booking, status: 'confirmed' } } : f));
      setStep('confirmation');
    } catch (err) {
      setPayError(err instanceof WidgetApiError ? err.message : 'Payment failed. Please try again.');
    } finally {
      setPayLoading(false);
    }
  }

  if (initLoading) {
    return <div className="dsw-shell"><div className="dsw-loading">Loading…</div></div>;
  }

  if (initError || !flow.product) {
    return <div className="dsw-shell"><div className="dsw-error-page">{initError || 'This booking page is unavailable.'}</div></div>;
  }

  if (flow.product.product_type !== 'service') {
    return (
      <div className="dsw-shell">
        <div className="dsw-error-page">
          Booking packages and memberships through this page isn't available yet — please check back soon.
        </div>
      </div>
    );
  }

  return (
    <div className="dsw-shell">
      <header className="dsw-header">
        {businessInfo?.logo_url && <img src={businessInfo.logo_url} alt={businessInfo.name} className="dsw-logo" />}
        <span className="dsw-business-name">{businessInfo?.name}</span>
      </header>

      <ProgressIndicator currentStep={step} />

      <main className="dsw-main">
        {step === 'product' && (
          <ProductDetailStep
            product={flow.product}
            selectedVariantId={flow.selectedVariantId}
            onContinue={handleProductContinue}
          />
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
            onBack={() => setStep('calendar')}
          />
        )}

        {step === 'auth' && businessInfo && (
          <div>
            <LoginRegisterStep
              tenantId={businessInfo.tenant_id}
              businessId={businessId}
              onAuthenticated={handleAuthenticated}
              onBack={() => setStep('slots')}
            />
            {holdLoading && <p className="dsw-step-text">Securing your time slot…</p>}
            {holdError && <p className="dsw-step-error">{holdError}</p>}
          </div>
        )}

        {step === 'customer' && flow.customer && (
          <>
            {flow.selectedSlot && (
              <AppointmentSummary
                productName={flow.product.name}
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

        {step === 'payment' && flow.booking && (
          <>
            {flow.selectedSlot && (
              <AppointmentSummary
                productName={flow.product.name}
                startTime={flow.selectedSlot.start_time}
                locationName={flow.selectedSlot.location_name}
                staffName={flow.selectedSlot.staff_id ? `${flow.selectedSlot.staff_first_name} ${flow.selectedSlot.staff_last_name}` : null}
              />
            )}
            <PaymentStep
              booking={flow.booking}
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
      </main>
    </div>
  );
}
