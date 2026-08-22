import { useEffect, useMemo, useRef, useState } from 'react';
import { COUNTRIES } from '@daystream/shared';

function flagEmoji(iso2: string): string {
  return iso2.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

interface CountrySelectProps {
  value: string; // ISO2
  onChange: (iso2: string) => void;
  /** 'name' shows the full country name (Country field); 'dial' shows flag + dial code (phone prefix). */
  mode?: 'name' | 'dial';
  id?: string;
}

/** Searchable/typeahead country picker — a plain <select> with ~195 entries isn't usable (§A5). */
export function CountrySelect({ value, onChange, mode = 'name', id }: CountrySelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = COUNTRIES.find((c) => c.iso2 === value);

  const filtered = useMemo(() => {
    if (!query.trim()) return COUNTRIES;
    const q = query.trim().toLowerCase();
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.dialCode.includes(q));
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) { setOpen(false); setQuery(''); }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const triggerLabel = mode === 'dial'
    ? (selected ? `${flagEmoji(selected.iso2)} ${selected.dialCode}` : 'Select…')
    : (selected ? selected.name : 'Search country…');

  return (
    <div ref={rootRef} style={{ ...styles.root, ...(mode === 'dial' ? styles.rootDial : {}) }}>
      <button
        type="button"
        id={id}
        style={styles.trigger}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{triggerLabel}</span>
        <span aria-hidden="true" style={styles.caret}>▾</span>
      </button>
      {open && (
        <div style={styles.panel}>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            style={styles.searchInput}
          />
          <div style={styles.list} role="listbox">
            {filtered.length === 0 && <div style={styles.empty}>No matches</div>}
            {filtered.map((c) => (
              <button
                type="button"
                key={c.iso2}
                role="option"
                aria-selected={c.iso2 === value}
                style={{ ...styles.option, ...(c.iso2 === value ? styles.optionSelected : {}) }}
                onClick={() => { onChange(c.iso2); setOpen(false); setQuery(''); }}
              >
                {flagEmoji(c.iso2)} {c.name} <span style={styles.dialCode}>{c.dialCode}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { position: 'relative', width: '100%' },
  rootDial: { width: '108px', flexShrink: 0 },
  trigger: {
    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    fontSize: 'var(--font-size-sm)', padding: '10px 12px', border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)',
    cursor: 'pointer', fontFamily: 'var(--font-family)', textAlign: 'left',
  },
  caret: { color: 'var(--color-text-secondary)', fontSize: '11px', marginLeft: '6px' },
  panel: {
    position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 20, minWidth: '260px',
    background: 'var(--color-surface-modal)', border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.15))',
    padding: 'var(--space-sm)',
  },
  searchInput: {
    width: '100%', fontSize: 'var(--font-size-sm)', padding: '8px 10px', marginBottom: 'var(--space-xs)',
    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
    background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)',
  },
  list: { maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column' },
  option: {
    textAlign: 'left', background: 'none', border: 'none', borderRadius: 'var(--radius-sm)',
    padding: '7px 8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: '6px',
  },
  optionSelected: { background: 'var(--color-surface-hover)', fontWeight: 600 },
  dialCode: { marginLeft: 'auto', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)' },
  empty: { padding: '8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
};
