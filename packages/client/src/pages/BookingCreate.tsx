import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Alert } from '../design-system/components/feedback/Alert';
import * as bookingsApi from '../api/bookings';
import * as servicesApi from '../api/services';
import * as customersApi from '../api/customers';
import type { ServiceVariant } from '../api/services';
import { apiClient } from '../api/client';
import { formatCurrency } from '../utils/currency';

interface SlotCombo {
  start_time: string;
  end_time: string;
  duration: number;
  location_id: string | null;
  location_name: string | null;
  staff_id: string;
  staff_first_name: string;
  staff_last_name: string;
}

export function BookingCreate() {
  const navigate = useNavigate();
  const businessId = localStorage.getItem('business_id') || '';

  const [services, setServices] = useState<any[]>([]);
  const [variants, setVariants] = useState<ServiceVariant[]>([]);
  const [businessTimezone, setBusinessTimezone] = useState('UTC');

  // All combinations from API
  const [allCombos, setAllCombos] = useState<SlotCombo[]>([]);
  const [combosLoading, setCombosLoading] = useState(false);

  // Customer search
  const [isWalkIn, setIsWalkIn] = useState(false);
  const [walkInName, setWalkInName] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [customerSearching, setCustomerSearching] = useState(false);

  // Selections
  const [selectedService, setSelectedService] = useState('');
  const [selectedVariant, setSelectedVariant] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load services and business timezone
  useEffect(() => {
    if (!businessId) return;
    servicesApi.getServices(businessId, { status: 'active' }).then((res) => setServices(res.data));
    apiClient.get('/v1/admin/businesses').then((res) => {
      const biz = res.data.data?.find((b: any) => b.id === businessId);
      if (biz?.timezone) setBusinessTimezone(biz.timezone);
    }).catch(() => {});
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

  // Load variants when service changes
  useEffect(() => {
    if (!selectedService) { setVariants([]); return; }
    servicesApi.getVariants(selectedService).then(setVariants);
    setSelectedVariant('');
    setAllCombos([]);
    resetFilters();
  }, [selectedService]);

  // Fetch availability combinations when service + variant + date are set
  useEffect(() => {
    if (!selectedService || !selectedVariant || !selectedDate) { setAllCombos([]); return; }
    setCombosLoading(true);
    apiClient.get('/v1/bookings/availability/combinations', {
      params: { service_id: selectedService, business_id: businessId, date_from: selectedDate, date_to: selectedDate, variant_id: selectedVariant },
    }).then((res) => {
      const data = res.data.data;
      setAllCombos(data.slots || []);
      if (data.timezone) setBusinessTimezone(data.timezone);
    }).catch(() => setAllCombos([]))
      .finally(() => setCombosLoading(false));
    resetFilters();
  }, [selectedService, selectedVariant, selectedDate, businessId]);

  function resetFilters() {
    setSelectedLocation(null);
    setSelectedStaff(null);
    setSelectedTime(null);
  }

  // Derived: filter combos based on current selections
  const filteredCombos = useMemo(() => {
    return allCombos.filter((c) => {
      if (selectedLocation && c.location_id !== selectedLocation) return false;
      if (selectedStaff && c.staff_id !== selectedStaff) return false;
      if (selectedTime && c.start_time !== selectedTime) return false;
      return true;
    });
  }, [allCombos, selectedLocation, selectedStaff, selectedTime]);

  // Derive available options for each dimension from filtered combos
  const availableLocations = useMemo(() => {
    const combos = allCombos.filter((c) => {
      if (selectedStaff && c.staff_id !== selectedStaff) return false;
      if (selectedTime && c.start_time !== selectedTime) return false;
      return true;
    });
    const map = new Map<string, string>();
    for (const c of combos) {
      if (c.location_id && c.location_name) map.set(c.location_id, c.location_name);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [allCombos, selectedStaff, selectedTime]);

  const availableStaff = useMemo(() => {
    const combos = allCombos.filter((c) => {
      if (selectedLocation && c.location_id !== selectedLocation) return false;
      if (selectedTime && c.start_time !== selectedTime) return false;
      return true;
    });
    const map = new Map<string, { id: string; name: string }>();
    for (const c of combos) {
      if (!map.has(c.staff_id)) map.set(c.staff_id, { id: c.staff_id, name: `${c.staff_first_name} ${c.staff_last_name}` });
    }
    return Array.from(map.values());
  }, [allCombos, selectedLocation, selectedTime]);

  const availableTimes = useMemo(() => {
    const combos = allCombos.filter((c) => {
      if (selectedLocation && c.location_id !== selectedLocation) return false;
      if (selectedStaff && c.staff_id !== selectedStaff) return false;
      return true;
    });
    const set = new Set<string>();
    for (const c of combos) set.add(c.start_time);
    return Array.from(set).sort();
  }, [allCombos, selectedLocation, selectedStaff]);

  // Can we book?
  const canBook = (selectedCustomer || isWalkIn) && selectedService && selectedVariant && selectedTime && filteredCombos.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canBook) { setError('Please complete all required selections'); return; }

    // Pick the first matching combo for the booking
    const combo = filteredCombos[0];
    setLoading(true);
    setError('');
    try {
      await bookingsApi.createBooking({
        business_id: businessId,
        customer_id: isWalkIn ? undefined : selectedCustomer.id,
        walk_in_name: isWalkIn ? (walkInName || 'Walk-in') : undefined,
        service_id: selectedService,
        variant_id: selectedVariant,
        staff_id: combo.staff_id,
        start_time: combo.start_time,
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <label style={styles.label}>Customer {!isWalkIn && '*'}</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={isWalkIn} onChange={(e) => { setIsWalkIn(e.target.checked); if (e.target.checked) setSelectedCustomer(null); }} style={{ width: '14px', height: '14px' }} />
              Walk-in
            </label>
          </div>
          {isWalkIn ? (
            <input style={styles.input} value={walkInName} onChange={(e) => setWalkInName(e.target.value)} placeholder="Name (optional)" />
          ) : (
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
                  <button key={c.id} type="button" style={styles.dropdownItem}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setSelectedCustomer(c); setShowCustomerDropdown(false); setCustomerSearch(''); }}>
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
          )}
        </div>

        {/* Service */}
        <div style={styles.field}>
          <label style={styles.label}>Service *</label>
          <select style={styles.select} value={selectedService} onChange={(e) => setSelectedService(e.target.value)} required>
            <option value="">Select a service...</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* Variant */}
        {variants.length > 0 && (
          <div style={styles.field}>
            <label style={styles.label}>Duration / Option *</label>
            <select style={styles.select} value={selectedVariant} onChange={(e) => setSelectedVariant(e.target.value)} required>
              <option value="">Select an option...</option>
              {variants.filter((v) => v.status === 'active').map((v) => (
                <option key={v.id} value={v.id}>{v.name} — {v.duration} min — {formatCurrency(v.price)}</option>
              ))}
            </select>
          </div>
        )}

        {/* Date */}
        {selectedVariant && (
          <div style={styles.field}>
            <label style={styles.label}>Date *</label>
            <input type="date" style={styles.input} value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)} required />
          </div>
        )}

        {/* Multi-filter panel */}
        {selectedDate && !combosLoading && allCombos.length > 0 && (
          <div style={styles.filterPanel}>
            {/* Locations column */}
            {availableLocations.length > 0 && (
              <div style={styles.filterColumn}>
                <label style={styles.filterLabel}>Location</label>
                <button type="button"
                  style={{ ...styles.filterOption, ...(selectedLocation === null ? styles.filterOptionActive : {}) }}
                  onClick={() => setSelectedLocation(null)}>Any</button>
                {availableLocations.map((l) => (
                  <button key={l.id} type="button"
                    style={{ ...styles.filterOption, ...(selectedLocation === l.id ? styles.filterOptionActive : {}) }}
                    onClick={() => setSelectedLocation(selectedLocation === l.id ? null : l.id)}>{l.name}</button>
                ))}
              </div>
            )}

            {/* Staff column */}
            <div style={styles.filterColumn}>
              <label style={styles.filterLabel}>Staff</label>
              <button type="button"
                style={{ ...styles.filterOption, ...(selectedStaff === null ? styles.filterOptionActive : {}) }}
                onClick={() => setSelectedStaff(null)}>Any</button>
              {availableStaff.map((s) => (
                <button key={s.id} type="button"
                  style={{ ...styles.filterOption, ...(selectedStaff === s.id ? styles.filterOptionActive : {}) }}
                  onClick={() => setSelectedStaff(selectedStaff === s.id ? null : s.id)}>{s.name}</button>
              ))}
            </div>

            {/* Time slots column */}
            <div style={styles.filterColumn}>
              <label style={styles.filterLabel}>Time *</label>
              <div style={styles.timeGrid}>
                {availableTimes.map((t) => (
                  <button key={t} type="button"
                    style={{ ...styles.timeBtn, ...(selectedTime === t ? styles.timeBtnActive : {}) }}
                    onClick={() => setSelectedTime(selectedTime === t ? null : t)}>
                    {new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: businessTimezone })}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {selectedDate && combosLoading && <p style={styles.hint}>Loading availability...</p>}
        {selectedDate && !combosLoading && allCombos.length === 0 && <p style={styles.hint}>No availability for this date</p>}

        {/* Notes */}
        <div style={styles.field}>
          <label style={styles.label}>Notes (optional)</label>
          <textarea style={styles.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Internal notes for this booking..." />
        </div>

        {/* Actions */}
        <div style={styles.actions}>
          <Button variant="secondary" type="button" onClick={() => navigate('/bookings')}>Cancel</Button>
          <Button type="submit" loading={loading} disabled={!canBook}>Create Booking</Button>
        </div>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '800px', margin: '0 auto' },
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
  dropdown: { position: 'absolute' as const, top: '100%', left: 0, right: 0, background: 'var(--color-surface-modal, #FFFFFF)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginTop: '4px', maxHeight: '200px', overflow: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' },
  dropdownItem: { display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-start', width: '100%', padding: '10px 12px', border: 'none', background: 'var(--color-background, #1A1A1A)', cursor: 'pointer', textAlign: 'left' as const, color: 'var(--color-text)', fontSize: '14px', borderBottom: '1px solid var(--color-border)' },
  dropdownEmail: { fontSize: '12px', color: 'var(--color-text-secondary)' },
  // Multi-filter panel
  filterPanel: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-md)', padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' },
  filterColumn: { display: 'flex', flexDirection: 'column' as const, gap: '6px' },
  filterLabel: { fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '4px' },
  filterOption: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'none', cursor: 'pointer', fontSize: '13px', color: 'var(--color-text)', textAlign: 'left' as const, fontFamily: 'var(--font-family)', transition: 'all 0.15s ease' },
  filterOptionActive: { borderColor: 'var(--color-accent, #C9A96E)', background: 'var(--color-accent, #C9A96E)', color: '#1A1A1A', fontWeight: 600 },
  timeGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '4px', maxHeight: '300px', overflow: 'auto' },
  timeBtn: { padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--color-text)', textAlign: 'center' as const, fontFamily: 'var(--font-family)', transition: 'all 0.15s ease' },
  timeBtnActive: { borderColor: 'var(--color-accent, #C9A96E)', background: 'var(--color-accent, #C9A96E)', color: '#1A1A1A', fontWeight: 600 },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-md)', marginTop: 'var(--space-md)' },
};
