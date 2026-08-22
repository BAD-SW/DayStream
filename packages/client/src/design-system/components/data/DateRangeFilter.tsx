import { useEffect, useRef, useState } from 'react';

export interface DateRange {
  from: string; // ISO date (yyyy-mm-dd)
  to: string;
}

interface DateRangeFilterProps {
  value: DateRange | null;
  onChange: (value: DateRange | null) => void;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function presetRange(preset: string): DateRange {
  const today = new Date();
  const to = toIsoDate(today);
  if (preset === 'today') return { from: to, to };
  if (preset === 'last7') {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { from: toIsoDate(from), to };
  }
  if (preset === 'last30') {
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    return { from: toIsoDate(from), to };
  }
  // 'thisMonth'
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: toIsoDate(from), to };
}

function formatLabel(value: DateRange | null): string {
  if (!value) return 'Any date';
  if (value.from === value.to) return value.from;
  return `${value.from} – ${value.to}`;
}

/** Date-range popover filter: quick presets plus a custom From/To range. */
export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(value?.from || '');
  const [customTo, setCustomTo] = useState(value?.to || '');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function applyPreset(preset: string) {
    const range = presetRange(preset);
    onChange(range);
    setCustomFrom(range.from);
    setCustomTo(range.to);
    setOpen(false);
  }

  function applyCustom() {
    if (customFrom && customTo) {
      onChange({ from: customFrom, to: customTo });
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} style={styles.root}>
      <button type="button" style={styles.trigger} onClick={() => setOpen((o) => !o)}>
        {formatLabel(value)} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div style={styles.panel}>
          <div style={styles.presetList}>
            <button type="button" style={styles.presetBtn} onClick={() => applyPreset('today')}>Today</button>
            <button type="button" style={styles.presetBtn} onClick={() => applyPreset('last7')}>Last 7 days</button>
            <button type="button" style={styles.presetBtn} onClick={() => applyPreset('last30')}>Last 30 days</button>
            <button type="button" style={styles.presetBtn} onClick={() => applyPreset('thisMonth')}>This month</button>
          </div>
          <div style={styles.customRow}>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={styles.dateInput} aria-label="From date" />
            <span style={styles.toLabel}>to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={styles.dateInput} aria-label="To date" />
          </div>
          <div style={styles.actionRow}>
            <button type="button" style={styles.clearBtn} onClick={() => { onChange(null); setCustomFrom(''); setCustomTo(''); setOpen(false); }}>Clear</button>
            <button type="button" style={styles.applyBtn} onClick={applyCustom}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { position: 'relative' },
  trigger: {
    width: '100%', fontSize: 'var(--font-size-xs)', padding: '6px 9px',
    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
    background: 'var(--color-surface)', color: 'var(--color-text)',
    textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-family)',
  },
  panel: {
    position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 20,
    background: 'var(--color-surface-modal)', border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.15))',
    padding: 'var(--space-sm)', width: '260px',
  },
  presetList: { display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: 'var(--space-sm)' },
  presetBtn: {
    textAlign: 'left', background: 'none', border: 'none', borderRadius: 'var(--radius-sm)',
    padding: '6px 8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', cursor: 'pointer',
  },
  customRow: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 'var(--space-sm)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-sm)' },
  dateInput: { flex: 1, fontSize: 'var(--font-size-xs)', padding: '5px 6px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface)', color: 'var(--color-text)' },
  toLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  actionRow: { display: 'flex', justifyContent: 'space-between', gap: '8px' },
  clearBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)', cursor: 'pointer' },
  applyBtn: { background: 'var(--color-primary)', color: 'var(--color-primary-contrast)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '6px 12px', fontSize: 'var(--font-size-xs)', cursor: 'pointer', fontWeight: 600 },
};
