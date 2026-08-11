import { useEffect, useState } from 'react';
import * as bookingsApi from '../../api/bookings';
import type { DayStatus } from './DayPicker';
import { DayPicker, currentMonthStr } from './DayPicker';
import { SlotPicker, type SlotPickerSlot } from './SlotPicker';
import './AvailabilityCalendar.css';

interface AvailabilityCalendarProps {
  serviceId: string;
  variantId: string;
  businessId: string;
  participantCount: number;
  selectedDate: string | null;
  onDateSelect: (date: string) => void;
  onDateClear: () => void;
  slots: SlotPickerSlot[];
  slotsLoading?: boolean;
  selectedTime: string | null;
  onSlotSelect: (startTime: string) => void;
  businessTimezone: string;
  overrideCapacity?: boolean;
  /** Month (YYYY-MM) the day-picker should open on — e.g. an existing booking's own month when
   *  editing, so the user isn't dropped on the current month and left to hunt for it. Defaults to
   *  the current month, matching the "new booking" flow. */
  initialMonth?: string;
}

export function AvailabilityCalendar({
  serviceId, variantId, businessId, participantCount,
  selectedDate, onDateSelect, onDateClear,
  slots, slotsLoading, selectedTime, onSlotSelect, businessTimezone, overrideCapacity, initialMonth,
}: AvailabilityCalendarProps) {
  const [viewedMonth, setViewedMonth] = useState<string>(initialMonth || currentMonthStr());
  const [dayStatuses, setDayStatuses] = useState<Record<string, DayStatus>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'day-picker' | 'slot-picker'>('day-picker');

  useEffect(() => {
    if (selectedDate === null) setView('day-picker');
  }, [selectedDate]);

  function fetchDayStatuses() {
    if (!serviceId || !variantId) return;
    setLoading(true);
    setError(null);
    bookingsApi.getAvailabilityDays(businessId, serviceId, variantId, viewedMonth, participantCount)
      .then((res) => setDayStatuses(res.days))
      .catch(() => setError('Failed to load calendar availability'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchDayStatuses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, variantId, businessId, viewedMonth, participantCount]);

  function handleDaySelect(date: string) {
    onDateSelect(date);
    setView('slot-picker');
  }

  function handleBack() {
    setView('day-picker');
    onDateClear();
  }

  return (
    <div className="availability-calendar">
      {view === 'day-picker' ? (
        <DayPicker
          dayStatuses={dayStatuses}
          viewedMonth={viewedMonth}
          onMonthChange={setViewedMonth}
          onDaySelect={handleDaySelect}
          loading={loading}
          error={error}
          onRetry={fetchDayStatuses}
        />
      ) : (
        <SlotPicker
          slots={slots}
          participantCount={participantCount}
          selectedTime={selectedTime}
          onSlotSelect={onSlotSelect}
          onBack={handleBack}
          loading={slotsLoading}
          businessTimezone={businessTimezone}
          overrideCapacity={overrideCapacity}
        />
      )}
    </div>
  );
}
