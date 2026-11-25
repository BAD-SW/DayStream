import { useTranslation } from 'react-i18next';
import { formatTime } from '../../utils/format';
import './SlotPicker.css';

export interface SlotPickerSlot {
  start_time: string;
  capacity_remaining?: number;
}

interface SlotPickerProps {
  slots: SlotPickerSlot[];
  participantCount: number;
  selectedTime: string | null;
  onSlotSelect: (startTime: string) => void;
  onBack: () => void;
  loading?: boolean;
  businessTimezone: string;
  /** When true, over-capacity slots stay visually flagged (red) but become selectable — the
   *  admin-override path (Requirement 6) needs to be able to pick the slot it's overriding. */
  overrideCapacity?: boolean;
}

/** A slot is clickable iff it has enough remaining capacity for the requested participant count.
 *  `capacity_remaining === undefined` means the slot carries no resource-capacity constraint at all
 *  (unlimited), not zero — so it must default to Infinity, never to a finite number. */
export function isSlotClickable(capacityRemaining: number | undefined, participantCount: number): boolean {
  return (capacityRemaining ?? Infinity) >= participantCount;
}

export function SlotPicker({ slots, participantCount, selectedTime, onSlotSelect, onBack, loading, businessTimezone, overrideCapacity }: SlotPickerProps) {
  const { t } = useTranslation('booking');
  return (
    <div className="slot-picker">
      <button type="button" className="slot-picker__back" onClick={onBack}>{t('slot.backToCalendar')}</button>

      {loading && (
        <div className="slot-picker__loading" role="status" aria-label={t('slot.loadingSlots')}>
          <span className="slot-picker__spinner" />
        </div>
      )}

      {!loading && slots.length === 0 && (
        <p className="slot-picker__empty">{t('slot.noAvailability')}</p>
      )}

      {!loading && slots.length > 0 && (
        <div className="slot-picker__grid">
          {slots.map((slot) => {
            const clickable = isSlotClickable(slot.capacity_remaining, participantCount);
            const disabled = !clickable && !overrideCapacity;
            // Over capacity but still clickable because an admin is overriding: needs its own
            // look (amber, full opacity, normal cursor) — reusing the blocked "over-capacity"
            // style here would visually tell the admin the slot can't be clicked when it can.
            const overriding = !clickable && overrideCapacity;
            const isSelected = selectedTime === slot.start_time;
            const label = formatTime(slot.start_time, businessTimezone, { hour: '2-digit' });
            let stateClass = 'slot-picker__slot--available';
            if (overriding) stateClass = 'slot-picker__slot--overriding';
            else if (!clickable) stateClass = 'slot-picker__slot--over-capacity';
            return (
              <button
                key={slot.start_time}
                type="button"
                className={[
                  'slot-picker__slot',
                  stateClass,
                  isSelected ? 'slot-picker__slot--selected' : '',
                ].filter(Boolean).join(' ')}
                title={overriding ? t('slot.overrideTitle') : undefined}
                disabled={disabled}
                aria-disabled={disabled}
                onClick={() => { if (!disabled) onSlotSelect(slot.start_time); }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
