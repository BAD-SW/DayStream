import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Alert } from '../design-system/components/feedback/Alert';
import * as bookingsApi from '../api/bookings';
import * as servicesApi from '../api/services';
import * as customersApi from '../api/customers';
import * as resourcesApi from '../api/resources';
import type { ServiceVariant } from '../api/services';
import { apiClient } from '../api/client';
import { formatCurrency } from '../utils/currency';
import { ParticipantCountField } from '../components/booking/ParticipantCountField';
import { AvailabilityCalendar } from '../components/booking/AvailabilityCalendar';

interface SlotCombo {
  start_time: string;
  end_time: string;
  duration: number;
  location_id: string | null;
  location_name: string | null;
  // Absent for staff-less (booking_type: 'resource') services.
  staff_id?: string;
  staff_first_name?: string;
  staff_last_name?: string;
  capacity_remaining?: number;
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
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  // Participant count / resource capacity (feature 32)
  const [participantCount, setParticipantCount] = useState(1);
  const [resourceCapacity, setResourceCapacity] = useState(1);
  const [overrideCapacity, setOverrideCapacity] = useState(false);

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

  // Load the service's linked resource capacity (drives whether ParticipantCountField shows)
  useEffect(() => {
    if (!selectedService) { setResourceCapacity(1); return; }
    servicesApi.getAvailability(selectedService).then((rules: any[]) => {
      const resourceIds = rules.flatMap((r: any) => r.resource_ids || []);
      if (resourceIds.length === 0) { setResourceCapacity(1); return; }
      return resourcesApi.getResource(resourceIds[0], businessId);
    }).then((resource: any) => {
      if (resource?.capacity) setResourceCapacity(resource.capacity);
      else setResourceCapacity(1);
    }).catch(() => setResourceCapacity(1));
  }, [selectedService, businessId]);

  // Reset participant count whenever the variant (or service, which clears the variant) changes
  useEffect(() => {
    setParticipantCount(1);
    setOverrideCapacity(false);
  }, [selectedVariant]);

  // If the currently selected time slot no longer has enough capacity for the new participant
  // count, clear the selection so the user must pick a slot that actually fits — unless they're
  // deliberately overriding the capacity limit, in which case keep the over-capacity selection.
  useEffect(() => {
    if (!selectedTime || overrideCapacity) return;
    const combo = allCombos.find((c) => c.start_time === selectedTime);
    if (combo && (combo.capacity_remaining ?? Infinity) < participantCount) {
      setSelectedTime(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantCount, overrideCapacity]);

  // Check if business is closed on selected date (per location)
  const [businessClosed, setBusinessClosed] = useState<string | null>(null);
  const [locationStatuses, setLocationStatuses] = useState<Map<string, { status: 'open' | 'closed' | 'modified'; label?: string; hours?: string }>>(new Map());

  useEffect(() => {
    if (!selectedDate || !businessId) { setBusinessClosed(null); setLocationStatuses(new Map()); return; }
    apiClient.get(`/v1/locations?business_id=${businessId}`).then(async (locRes) => {
      const locs = locRes.data.data || [];
      if (locs.length === 0) { setBusinessClosed(null); setLocationStatuses(new Map()); return; }

      const dayOfWeek = new Date(selectedDate + 'T12:00:00').getDay();
      const year = new Date(selectedDate).getFullYear();
      const statuses = new Map<string, { status: 'open' | 'closed' | 'modified'; label?: string; hours?: string }>();

      for (const loc of locs) {
        try {
          // Check overrides
          const overridesRes = await apiClient.get(`/v1/locations/${loc.id}/hours/overrides?year=${year}`);
          const overrides = overridesRes.data.data || [];
          const dayOverride = overrides.find((o: any) => o.override_date.split('T')[0] === selectedDate);

          if (dayOverride) {
            if (dayOverride.is_closed) {
              statuses.set(loc.id, { status: 'closed', label: dayOverride.label || 'Holiday' });
              continue;
            } else if (dayOverride.open_time && dayOverride.close_time) {
              const openStr = new Date(`2000-01-01T${dayOverride.open_time}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
              const closeStr = new Date(`2000-01-01T${dayOverride.close_time}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
              statuses.set(loc.id, { status: 'modified', label: dayOverride.label, hours: `${openStr}–${closeStr}` });
              continue;
            }
          }

          // Check regular hours
          const hoursRes = await apiClient.get(`/v1/locations/${loc.id}/hours`);
          const hours = hoursRes.data.data || [];
          const dayHours = hours.find((h: any) => h.day_of_week === dayOfWeek);

          if (dayHours && dayHours.is_closed) {
            statuses.set(loc.id, { status: 'closed', label: 'Closed this day' });
          } else {
            statuses.set(loc.id, { status: 'open' });
          }
        } catch {
          statuses.set(loc.id, { status: 'open' });
        }
      }

      setLocationStatuses(statuses);

      // Only show full "business closed" message if ALL locations are closed
      const allClosed = locs.every((loc: any) => statuses.get(loc.id)?.status === 'closed');
      if (allClosed) {
        const firstLabel = statuses.values().next().value?.label;
        setBusinessClosed(firstLabel ? `Closed — ${firstLabel}` : 'All locations closed');
      } else {
        setBusinessClosed(null);
      }
    }).catch(() => { setBusinessClosed(null); setLocationStatuses(new Map()); });
  }, [selectedDate, businessId]);

  // Fetch availability combinations when service + variant + date are set (and business is open)
  useEffect(() => {
    if (!selectedService || !selectedVariant || !selectedDate || businessClosed) { setAllCombos([]); return; }
    setCombosLoading(true);
    apiClient.get('/v1/bookings/availability/combinations', {
      params: { service_id: selectedService, business_id: businessId, date_from: selectedDate, date_to: selectedDate, variant_id: selectedVariant, participant_count: participantCount },
    }).then((res) => {
      const data = res.data.data;
      setAllCombos(data.slots || []);
      if (data.timezone) setBusinessTimezone(data.timezone);
    }).catch(() => setAllCombos([]))
      .finally(() => setCombosLoading(false));
    resetFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedService, selectedVariant, selectedDate, businessId, businessClosed]);

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
      if (c.staff_id && !map.has(c.staff_id)) map.set(c.staff_id, { id: c.staff_id, name: `${c.staff_first_name} ${c.staff_last_name}` });
    }
    return Array.from(map.values());
  }, [allCombos, selectedLocation, selectedTime]);

  // Deduped, per-time slot list (location/staff filtered) for the AvailabilityCalendar's SlotPicker
  const daySlots = useMemo(() => {
    const combos = allCombos.filter((c) => {
      if (selectedLocation && c.location_id !== selectedLocation) return false;
      if (selectedStaff && c.staff_id !== selectedStaff) return false;
      return true;
    });
    const map = new Map<string, number | undefined>();
    for (const c of combos) {
      if (!map.has(c.start_time)) map.set(c.start_time, c.capacity_remaining);
    }
    return Array.from(map.entries())
      .map(([start_time, capacity_remaining]) => ({ start_time, capacity_remaining }))
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
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
        staff_id: combo.staff_id || undefined,
        start_time: combo.start_time,
        notes: notes || undefined,
        participant_count: participantCount,
        override_rules: overrideCapacity,
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
          <label style={styles.label} htmlFor="booking-service-select">Service *</label>
          <select id="booking-service-select" style={styles.select} value={selectedService} onChange={(e) => setSelectedService(e.target.value)} required>
            <option value="">Select a service...</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* Variant */}
        {variants.length > 0 && (
          <div style={styles.field}>
            <label style={styles.label} htmlFor="booking-variant-select">Duration / Option *</label>
            <select id="booking-variant-select" style={styles.select} value={selectedVariant} onChange={(e) => setSelectedVariant(e.target.value)} required>
              <option value="">Select an option...</option>
              {variants.filter((v) => v.status === 'active').map((v) => (
                <option key={v.id} value={v.id}>{v.name} — {v.duration} min — {formatCurrency(v.price)}</option>
              ))}
            </select>
          </div>
        )}

        {/* Participant count (only for multi-capacity resources) */}
        {selectedVariant && resourceCapacity > 1 && (
          <div style={styles.field}>
            <ParticipantCountField
              value={participantCount}
              onChange={setParticipantCount}
              maxCapacity={resourceCapacity}
              remainingCapacity={selectedTime ? allCombos.find((c) => c.start_time === selectedTime)?.capacity_remaining : undefined}
              overrideCapacity={overrideCapacity}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--color-text-secondary)', cursor: 'pointer', marginTop: '4px' }}>
              <input type="checkbox" checked={overrideCapacity} onChange={(e) => setOverrideCapacity(e.target.checked)} style={{ width: '14px', height: '14px' }} />
              Override capacity limit
            </label>
          </div>
        )}

        {/* Availability calendar (day picker → slot picker) */}
        {selectedVariant && (
          <AvailabilityCalendar
            serviceId={selectedService}
            variantId={selectedVariant}
            businessId={businessId}
            participantCount={participantCount}
            selectedDate={selectedDate}
            onDateSelect={(date) => { setSelectedDate(date); resetFilters(); }}
            onDateClear={() => { setSelectedDate(null); resetFilters(); }}
            slots={daySlots}
            slotsLoading={combosLoading}
            selectedTime={selectedTime}
            onSlotSelect={(t) => setSelectedTime(t)}
            overrideCapacity={overrideCapacity}
            businessTimezone={businessTimezone}
          />
        )}

        {/* Location / Staff filters (shown once a day's slots have loaded) */}
        {selectedDate && !combosLoading && !businessClosed && allCombos.length > 0 && (availableLocations.length > 0 || availableStaff.length > 0) && (
          <div style={styles.filterPanel}>
            {/* Locations column */}
            {availableLocations.length > 0 && (
              <div style={styles.filterColumn}>
                <label style={styles.filterLabel}>Location</label>
                <button type="button"
                  style={{ ...styles.filterOption, ...(selectedLocation === null ? styles.filterOptionActive : {}) }}
                  onClick={() => setSelectedLocation(null)}>Any</button>
                {availableLocations.map((l) => {
                  const locStatus = locationStatuses.get(l.id);
                  const isClosed = locStatus?.status === 'closed';
                  return (
                    <button key={l.id} type="button"
                      disabled={isClosed}
                      style={{ ...styles.filterOption, ...(selectedLocation === l.id ? styles.filterOptionActive : {}), ...(isClosed ? { opacity: 0.5, cursor: 'not-allowed', textDecoration: 'line-through' } : {}) }}
                      onClick={() => !isClosed && setSelectedLocation(selectedLocation === l.id ? null : l.id)}>
                      {l.name}
                      {isClosed && <span style={{ fontSize: '10px', display: 'block', color: 'var(--color-error)' }}>{locStatus?.label || 'Closed'}</span>}
                      {locStatus?.status === 'modified' && <span style={{ fontSize: '10px', display: 'block', color: 'var(--color-text-muted)' }}>{locStatus.hours}</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Staff column — omitted entirely for staff-less (booking_type: 'resource') services */}
            {availableStaff.length > 0 && (
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
            )}
          </div>
        )}

        {selectedDate && businessClosed && (
          <div style={{ padding: 'var(--space-md)', border: '1px solid var(--color-error)', borderRadius: 'var(--radius-md)', background: 'var(--color-error-bg, rgba(211,47,47,0.05))', marginBottom: 'var(--space-md)' }}>
            <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-error)', fontWeight: 600 }}>{businessClosed}</p>
            <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>No appointments can be booked on this date.</p>
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
