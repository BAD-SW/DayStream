import { useEffect, useId, useRef, useState } from 'react';

/**
 * A time field that suggests quarter hours (David, 2026-10-28): opening it lists 00:00, 00:15 …
 * 23:45, scrolled to the current time; any other minute can still be typed ("20:20", "2020" or
 * "20.20"). Value is "HH:mm" (24 h) or "" while empty.
 */

interface Props {
  value: string;
  onChange: (value: string) => void;
  'aria-label': string;
  style?: React.CSSProperties;
  required?: boolean;
}

const OPTIONS = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);

/** "9" → "09:00", "930" → "09:30", "9:5" → "09:05", "20.20" → "20:20"; null when not a time. */
export function normaliseTime(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  let h: number; let m: number;
  const sep = /^(\d{1,2})[:.h ](\d{1,2})$/.exec(t);
  const digits = /^\d{1,4}$/.test(t) ? t : null;
  if (sep) { h = +sep[1]; m = +sep[2]; }
  else if (digits) {
    if (digits.length <= 2) { h = +digits; m = 0; } else { h = +digits.slice(0, -2); m = +digits.slice(-2); }
  } else return null;
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function QuarterTimeInput({ value, onChange, 'aria-label': ariaLabel, style, required }: Props) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setText(value); setInvalid(false); }, [value]);

  // Open on the option at or just before the current value.
  const nearest = () => {
    const i = OPTIONS.findIndex((o) => o > (value || '09:00'));
    return Math.max(0, (i === -1 ? OPTIONS.length : i) - 1);
  };

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[active] as HTMLElement | undefined;
    if (el) listRef.current.scrollTop = el.offsetTop - listRef.current.clientHeight / 2 + el.clientHeight / 2;
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const commit = (raw: string) => {
    const t = normaliseTime(raw);
    if (t) { setInvalid(false); setText(t); if (t !== value) onChange(t); }
    else if (!raw.trim()) { setInvalid(false); if (value) onChange(''); }
    else setInvalid(true);
  };

  const choose = (t: string) => { setText(t); setInvalid(false); setOpen(false); if (t !== value) onChange(t); };

  return (
    <div ref={wrapRef} style={styles.wrap}>
      <input
        type="text"
        inputMode="numeric"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-invalid={invalid}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        placeholder="HH:MM"
        required={required}
        value={text}
        onFocus={() => { setActive(nearest()); setOpen(true); }}
        onClick={() => { if (!open) { setActive(nearest()); setOpen(true); } }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { commit(text); setOpen(false); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(OPTIONS.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter') {
            e.preventDefault();
            // A typed time wins over the highlighted suggestion.
            if (open && text === value) choose(OPTIONS[active]); else { commit(text); setOpen(false); }
          }
          else if (e.key === 'Escape') setOpen(false);
        }}
        style={{ ...style, ...(invalid ? { borderColor: 'var(--color-error)' } : {}) }}
      />
      {open && (
        <ul ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} style={styles.list}>
          {OPTIONS.map((o, i) => (
            <li
              key={o}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o === value}
              onMouseDown={(e) => { e.preventDefault(); choose(o); }}
              onMouseEnter={() => setActive(i)}
              style={{ ...styles.option, ...(i === active ? styles.optionActive : {}), ...(o === value ? styles.optionChosen : {}) }}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
      {invalid && <span role="alert" style={styles.error}>Type a time like 09:30</span>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { position: 'relative', display: 'inline-flex', flexDirection: 'column' },
  list: {
    position: 'absolute', top: '100%', left: 0, zIndex: 30, margin: '4px 0 0', padding: '4px 0', listStyle: 'none',
    width: '100%', minWidth: '96px', maxHeight: '220px', overflowY: 'auto',
    background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.12))',
  },
  option: { padding: '6px 12px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', cursor: 'pointer', fontVariantNumeric: 'tabular-nums' },
  optionActive: { background: 'var(--color-surface-hover)' },
  optionChosen: { fontWeight: 600, color: 'var(--color-primary)' },
  error: { fontSize: 'var(--font-size-xs)', color: 'var(--color-error)', marginTop: '2px' },
};
