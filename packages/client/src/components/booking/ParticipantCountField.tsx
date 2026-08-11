import './ParticipantCountField.css';

interface ParticipantCountFieldProps {
  value: number;
  onChange: (count: number) => void;
  maxCapacity: number;
  remainingCapacity?: number;
  disabled?: boolean;
  /** When true, the field no longer clamps to remaining/resource capacity — the admin-override
   *  path (Requirement 6) is explicitly meant to allow booking past the normal limit. */
  overrideCapacity?: boolean;
}

const OVERRIDE_MAX = 999;

export function ParticipantCountField({ value, onChange, maxCapacity, remainingCapacity, disabled, overrideCapacity }: ParticipantCountFieldProps) {
  // A resource with capacity <= 1 has no concept of "participants" — nothing to gate, hide the field.
  if (maxCapacity <= 1) return null;

  const max = overrideCapacity ? OVERRIDE_MAX : (remainingCapacity ?? maxCapacity);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = parseInt(e.target.value, 10);
    if (Number.isNaN(raw)) return;
    onChange(Math.min(Math.max(raw, 1), max));
  }

  return (
    <div className="participant-count-field">
      <label className="participant-count-field__label" htmlFor="participant-count-input">Number of participants</label>
      <input
        id="participant-count-input"
        className="participant-count-field__input"
        type="number"
        min={1}
        max={max}
        value={value}
        onChange={handleChange}
        disabled={disabled}
      />
    </div>
  );
}
