import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Alert } from '../design-system/components/feedback/Alert';
import * as bookingsApi from '../api/bookings';
import * as servicesApi from '../api/services';
import * as customersApi from '../api/customers';
import type { ServiceVariant, AvailableSlot } from '../api/services';

export function BookingCreate() {
  const navigate = useNavigate();
  const businessId = localStorage.getItem('business_id') || '';

  const [services, setServices] = useState<any[]>([]);
  const [variants, setVariants] = useState<ServiceVariant[]>([]);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);

  // Customer search
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [customerSearching, setCustomerSearching] = useState(false);

  const [selectedService, setSelectedService] = useState('');
  const [selectedVariant, setSelectedVariant] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [error, setError] = useState('');

  // Load services on mount
  useEffect(() => {
    if (!businessId) return;
    servicesApi.getServices(businessId, {}).then((res) => setServices(res.data));
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
      } catch {
        setCustomerResults([]);
      } finally {
        setCustomerSearching(false);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [customerSearch, businessId]);

  // Load variants when service changes
  useEffect(() => {
    if (!selectedService) { setVariants([]); return; }
    servicesApi.getVariants(selectedService).then(setVariants);
    setSelectedVariant('');
    setSlots([]);
    setSelectedSlot(null);
  }, [selectedService]);

  // Load availability when variant + date selected
  useEffect(() => {
    if (!selectedService || !selectedVariant || !selectedDate) { setSlots([]); return; }
    setSlotsLoading(true);
    bookingsApi.getAvailability(businessId, selectedService, selectedDate, selectedDate, undefined, selectedVariant)
      .then(setSlots)
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [businessId, selectedService, selectedVariant, selectedDate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer || !selectedService || !selectedVariant || !selectedSlot) {
      setError('Please complete all required fields');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await bookingsApi.createBooking({
        business_id: businessId,
        customer_id: selectedCustomer.id,
        service_id: selectedService,
        variant_id: selectedVariant,
        staff_id: selectedStaff || selectedSlot.available_staff[0]?.id,
        start_time: selectedSlot.start_time,
        notes: notes || undefined,
      });
      navigate('/bookings');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create booking');
    } finally {
      setLoading(false);
    }
  };

  if (!businessId) return <Alert variant="error">No business context</Alert>;

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>New Booking</h1>

      {error && <Alert variant="error">{error}</Alert>}

      <form onSubmit={handleSubmit} style={styles.form}>
        {/* Customer */}
        <div style={styles.field}>
          <label style={styles.label}>Customer *</label>
          <div style={styles.searchWrapper}>
            {selectedCustomer ? (
              <div style={styles.selectedCustomer}>
                <span>{selectedCustomer.first_name} {selectedCustomer.last_name} ({selectedCustomer.email})</span>
                <button type="button" style={styles.clearBtn} onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); }}>×</button>
              </div>
            ) : (
              <input
                style={styles.input}
                type="text"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Search by name, email, or phone..."
                autoComplete="off"
                onFocus={() => { if (customerResults.length > 0) setShowCustomerDropdown(true); }}
                onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
              />
            )}
            {showCustomerDropdown && customerResults.length > 0 && (
              <div style={styles.dropdown}>
                {customerResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    style={styles.dropdownItem}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setSelectedCustomer(c); setShowCustomerDropdown(false); setCustomerSearch(''); }}
                  >
                    <strong>{c.first_name} {c.last_name}</strong>
                    <span style={styles.dropdownEmail}>{c.email}</span>
                  </button>
                ))}
              </div>
            )}
            {customerSearching && <span style={styles.hint}>Searching...</span>}
            {!customerSearching && customerSearch.length >= 2 && customerResults.length === 0 && !selectedCustomer && (
              <span style={styles.hint}>No customers found</span>
            )}
          </div>
        </div>

        {/* Service */}
        <div style={styles.field}>
          <label style={styles.label}>Service *</label>
          <select style={styles.select} value={selectedService} onChange={(e) => setSelectedService(e.target.value)} required>
            <option value="">Select a service...</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Variant */}
        {variants.length > 0 && (
          <div style={styles.field}>
            <label style={styles.label}>Duration / Option *</label>
            <select style={styles.select} value={selectedVariant} onChange={(e) => setSelectedVariant(e.target.value)} required>
              <option value="">Select an option...</option>
              {variants.filter((v) => v.status === 'active').map((v) => (
                <option key={v.id} value={v.id}>{v.name} — {v.duration} min — €{(v.price / 100).toFixed(2)}</option>
              ))}
            </select>
          </div>
        )}

        {/* Date */}
        {selectedVariant && (
          <div style={styles.field}>
            <label style={styles.label}>Date *</label>
            <input
              type="date"
              style={styles.input}
              value={selectedDate}
              onChange={(e) => { setSelectedDate(e.target.value); setSelectedSlot(null); }}
              min={new Date().toISOString().slice(0, 10)}
              required
            />
          </div>
        )}

        {/* Time Slots */}
        {selectedDate && (
          <div style={styles.field}>
            <label style={styles.label}>Time *</label>
            {slotsLoading && <p style={styles.hint}>Loading available times...</p>}
            {!slotsLoading && slots.length === 0 && <p style={styles.hint}>No available slots for this date</p>}
            <div style={styles.slotGrid}>
              {slots.map((slot) => (
                <button
                  key={slot.start_time}
                  type="button"
                  style={{ ...styles.slotBtn, ...(selectedSlot?.start_time === slot.start_time ? styles.slotSelected : {}) }}
                  onClick={() => setSelectedSlot(slot)}
                >
                  {new Date(slot.start_time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  {slot.capacity_remaining !== undefined && <span style={styles.capacity}>{slot.capacity_remaining} left</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Staff */}
        {selectedSlot && selectedSlot.available_staff.length > 0 && (
          <div style={styles.field}>
            <label style={styles.label}>Staff (optional)</label>
            <select style={styles.select} value={selectedStaff} onChange={(e) => setSelectedStaff(e.target.value)}>
              <option value="">Auto-assign</option>
              {selectedSlot.available_staff.map((s) => (
                <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Notes */}
        <div style={styles.field}>
          <label style={styles.label}>Notes (optional)</label>
          <textarea style={styles.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Internal notes for this booking..." />
        </div>

        {/* Actions */}
        <div style={styles.actions}>
          <Button variant="secondary" type="button" onClick={() => navigate('/bookings')}>Cancel</Button>
          <Button type="submit" loading={loading} disabled={!selectedSlot}>Create Booking</Button>
        </div>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '600px', margin: '0 auto' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', marginBottom: 'var(--space-lg)' },
  form: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-md)' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text)' },
  select: { background: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--color-text)', fontSize: '16px', width: '100%', boxSizing: 'border-box' as const },
  input: { background: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--color-text)', fontSize: '16px', width: '100%', boxSizing: 'border-box' as const },
  textarea: { background: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--color-text)', fontSize: '14px', width: '100%', boxSizing: 'border-box' as const, fontFamily: 'var(--font-family)', resize: 'vertical' as const },
  hint: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 },
  searchWrapper: { position: 'relative' as const },
  selectedCustomer: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', fontSize: '14px', color: 'var(--color-text)' },
  clearBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '18px', padding: '0 4px' },
  dropdown: { position: 'absolute' as const, top: '100%', left: 0, right: 0, background: 'var(--color-surface, #242424)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginTop: '4px', maxHeight: '200px', overflow: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' },
  dropdownItem: { display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-start', width: '100%', padding: '10px 12px', border: 'none', background: 'var(--color-background, #1A1A1A)', cursor: 'pointer', textAlign: 'left' as const, color: 'var(--color-text)', fontSize: '14px', borderBottom: '1px solid var(--color-border)' },
  dropdownEmail: { fontSize: '12px', color: 'var(--color-text-secondary)' },
  slotGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 'var(--space-sm)' },
  slotBtn: { padding: '8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'none', cursor: 'pointer', fontFamily: 'var(--font-family)', color: 'var(--color-text)', fontSize: 'var(--font-size-sm)', textAlign: 'center' as const, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '2px' },
  slotSelected: { borderColor: 'var(--color-primary)', background: 'var(--color-surface-hover)' },
  capacity: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-md)', marginTop: 'var(--space-md)' },
};
