import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { Alert } from '../design-system/components/feedback/Alert';
import * as bookingsApi from '../api/bookings';
import * as servicesApi from '../api/services';
import type { ServiceVariant, AvailableSlot } from '../api/services';
import { formatCurrency } from '../utils/currency';

type Step = 'variant' | 'date' | 'slot' | 'staff' | 'confirm' | 'done';

export function BookingFlow() {
  const { serviceSlug } = useParams<{ serviceSlug: string }>();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('variant');
  const [service, setService] = useState<any>(null);
  const [variants, setVariants] = useState<ServiceVariant[]>([]);
  const [selectedVariant, setSelectedVariant] = useState<ServiceVariant | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bookingResult, setBookingResult] = useState<any>(null);

  const businessId = localStorage.getItem('business_id') || '';

  // Load service from catalog or services API
  useEffect(() => {
    if (!serviceSlug || !businessId) return;
    // Try to load by slug
    servicesApi.getServices(businessId, { search: serviceSlug }).then((res) => {
      if (res.data.length > 0) {
        const svc = res.data[0];
        setService(svc);
        servicesApi.getVariants(svc.id).then(setVariants);
      }
    });
  }, [serviceSlug, businessId]);

  // Load slots when date + variant selected
  useEffect(() => {
    if (!service || !selectedVariant || !selectedDate) return;
    setLoading(true);
    bookingsApi.getAvailability(businessId, service.id, selectedDate, selectedDate, undefined, selectedVariant.id)
      .then(setSlots)
      .finally(() => setLoading(false));
  }, [service, selectedVariant, selectedDate, businessId]);

  const handleConfirm = async () => {
    if (!service || !selectedVariant || !selectedSlot) return;
    setLoading(true);
    setError('');
    try {
      // TODO: Get actual customer_id from auth context
      const customerId = localStorage.getItem('customer_id') || '';
      const result = await bookingsApi.createBooking({
        business_id: businessId,
        customer_id: customerId,
        service_id: service.id,
        variant_id: selectedVariant.id,
        staff_id: selectedStaff || selectedSlot.available_staff[0]?.id,
        start_time: selectedSlot.start_time,
      });
      setBookingResult(result);
      setStep('done');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create booking');
    } finally {
      setLoading(false);
    }
  };

  if (!service) return <div style={styles.loading}>Loading service...</div>;

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Book: {service.name}</h1>

      {/* Step indicator */}
      <div style={styles.steps}>
        {['Variant', 'Date', 'Time', 'Staff', 'Confirm'].map((label, i) => {
          const stepNames: Step[] = ['variant', 'date', 'slot', 'staff', 'confirm'];
          const isActive = stepNames.indexOf(step) >= i;
          return (
            <div key={label} style={{ ...styles.step, ...(isActive ? styles.stepActive : {}) }}>
              <span style={styles.stepNum}>{i + 1}</span>
              <span style={styles.stepLabel}>{label}</span>
            </div>
          );
        })}
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {/* Step 1: Select variant */}
      {step === 'variant' && (
        <div style={styles.stepContent}>
          <h2 style={styles.subtitle}>Select Duration & Price</h2>
          <div style={styles.variantGrid}>
            {variants.filter((v) => v.status === 'active').map((v) => (
              <button key={v.id} style={{ ...styles.variantCard, ...(selectedVariant?.id === v.id ? styles.variantSelected : {}) }}
                onClick={() => setSelectedVariant(v)}>
                <strong>{v.name}</strong>
                <span>{v.duration} min</span>
                <span style={styles.price}>{formatCurrency(v.price)}</span>
                {v.pricing_model === 'subscription' && <Badge variant="info">{v.billing_interval}</Badge>}
              </button>
            ))}
          </div>
          {selectedVariant && <Button onClick={() => setStep('date')}>Next</Button>}
        </div>
      )}

      {/* Step 2: Select date */}
      {step === 'date' && (
        <div style={styles.stepContent}>
          <h2 style={styles.subtitle}>Select Date</h2>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
            min={new Date().toISOString().slice(0, 10)} style={styles.dateInput} />
          <div style={styles.navActions}>
            <Button onClick={() => setStep('variant')}>Back</Button>
            {selectedDate && <Button onClick={() => setStep('slot')}>Next</Button>}
          </div>
        </div>
      )}

      {/* Step 3: Select time slot */}
      {step === 'slot' && (
        <div style={styles.stepContent}>
          <h2 style={styles.subtitle}>Select Time</h2>
          {loading && <p style={styles.loading}>Loading available slots...</p>}
          <div style={styles.slotGrid}>
            {slots.map((slot) => (
              <button key={slot.start_time} style={{ ...styles.slotBtn, ...(selectedSlot?.start_time === slot.start_time ? styles.slotSelected : {}) }}
                onClick={() => setSelectedSlot(slot)}>
                {new Date(slot.start_time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                {slot.capacity_remaining !== undefined && <span style={styles.capacity}>{slot.capacity_remaining} left</span>}
              </button>
            ))}
          </div>
          {slots.length === 0 && !loading && <p style={styles.empty}>No available slots for this date</p>}
          <div style={styles.navActions}>
            <Button onClick={() => setStep('date')}>Back</Button>
            {selectedSlot && <Button onClick={() => setStep('staff')}>Next</Button>}
          </div>
        </div>
      )}

      {/* Step 4: Select staff (optional) */}
      {step === 'staff' && (
        <div style={styles.stepContent}>
          <h2 style={styles.subtitle}>Select Provider (Optional)</h2>
          <div style={styles.staffGrid}>
            <button style={{ ...styles.staffBtn, ...(!selectedStaff ? styles.staffSelected : {}) }}
              onClick={() => setSelectedStaff('')}>No preference</button>
            {selectedSlot?.available_staff.map((s) => (
              <button key={s.id} style={{ ...styles.staffBtn, ...(selectedStaff === s.id ? styles.staffSelected : {}) }}
                onClick={() => setSelectedStaff(s.id)}>
                {s.first_name} {s.last_name}
              </button>
            ))}
          </div>
          <div style={styles.navActions}>
            <Button onClick={() => setStep('slot')}>Back</Button>
            <Button onClick={() => setStep('confirm')}>Next</Button>
          </div>
        </div>
      )}

      {/* Step 5: Confirm */}
      {step === 'confirm' && (
        <div style={styles.stepContent}>
          <h2 style={styles.subtitle}>Confirm Booking</h2>
          <div style={styles.summary}>
            <SummaryRow label="Service" value={service.name} />
            <SummaryRow label="Duration" value={`${selectedVariant?.duration} min`} />
            <SummaryRow label="Date" value={new Date(selectedSlot!.start_time).toLocaleDateString()} />
            <SummaryRow label="Time" value={new Date(selectedSlot!.start_time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} />
            <SummaryRow label="Price" value={formatCurrency(selectedVariant?.price || 0)} />
            {selectedStaff && selectedSlot?.available_staff.find((s) => s.id === selectedStaff) && (
              <SummaryRow label="Provider" value={`${selectedSlot!.available_staff.find((s) => s.id === selectedStaff)!.first_name} ${selectedSlot!.available_staff.find((s) => s.id === selectedStaff)!.last_name}`} />
            )}
          </div>
          <div style={styles.navActions}>
            <Button onClick={() => setStep('staff')}>Back</Button>
            <Button onClick={handleConfirm} disabled={loading}>{loading ? 'Booking...' : 'Confirm Booking'}</Button>
          </div>
        </div>
      )}

      {/* Done */}
      {step === 'done' && bookingResult && (
        <div style={styles.stepContent}>
          <Alert variant="success">Booking confirmed!</Alert>
          <div style={styles.summary}>
            <SummaryRow label="Reference" value={bookingResult.booking_reference} />
            <SummaryRow label="Status" value={bookingResult.status} />
            <SummaryRow label="Date" value={new Date(bookingResult.start_time).toLocaleString()} />
          </div>
          <Button onClick={() => navigate('/bookings')}>View My Bookings</Button>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.summaryRow}>
      <span style={styles.summaryLabel}>{label}</span>
      <span style={styles.summaryValue}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '700px', margin: '0 auto' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-lg)' },
  subtitle: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-md)' },
  loading: { padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--color-text-secondary)' },
  empty: { color: 'var(--color-text-secondary)', textAlign: 'center', padding: 'var(--space-lg)' },
  steps: { display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-xl)', flexWrap: 'wrap' as const },
  step: { display: 'flex', alignItems: 'center', gap: '4px', opacity: 0.4 },
  stepActive: { opacity: 1 },
  stepNum: { width: '22px', height: '22px', borderRadius: 'var(--radius-full)', background: 'var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-bold)' as any },
  stepLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text)' },
  stepContent: { padding: 'var(--space-lg)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' },
  variantGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' },
  variantCard: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '4px', padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: 'none', fontFamily: 'var(--font-family)', color: 'var(--color-text)', fontSize: 'var(--font-size-sm)' },
  variantSelected: { borderColor: 'var(--color-primary)', background: 'var(--color-surface-hover)' },
  price: { fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-primary)' },
  dateInput: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-md)', display: 'block' },
  slotGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' },
  slotBtn: { padding: 'var(--space-sm)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'none', cursor: 'pointer', fontFamily: 'var(--font-family)', color: 'var(--color-text)', fontSize: 'var(--font-size-sm)', textAlign: 'center' as const },
  slotSelected: { borderColor: 'var(--color-primary)', background: 'var(--color-surface-hover)' },
  capacity: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  staffGrid: { display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' as const, marginBottom: 'var(--space-md)' },
  staffBtn: { padding: 'var(--space-sm) var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'none', cursor: 'pointer', fontFamily: 'var(--font-family)', color: 'var(--color-text)', fontSize: 'var(--font-size-sm)' },
  staffSelected: { borderColor: 'var(--color-primary)', background: 'var(--color-surface-hover)' },
  summary: { marginBottom: 'var(--space-lg)' },
  summaryRow: { display: 'flex', justifyContent: 'space-between', padding: 'var(--space-sm) 0', borderBottom: '1px solid var(--color-border)' },
  summaryLabel: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
  summaryValue: { fontWeight: 'var(--font-weight-medium)' as any, fontSize: 'var(--font-size-sm)' },
  navActions: { display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-md)' },
};
