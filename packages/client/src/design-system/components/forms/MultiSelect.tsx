import { useState, useRef, useEffect } from 'react';

export interface MultiSelectOption {
  id: string;
  label: string;
}

interface MultiSelectProps {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  emptyMessage?: string;
}

export function MultiSelect({ label, options, selected, onChange, placeholder = 'Select...', emptyMessage = 'No options available' }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  const selectedLabels = selected
    .map((id) => options.find((o) => o.id === id)?.label)
    .filter(Boolean);

  return (
    <div style={styles.wrapper} ref={containerRef}>
      <label style={styles.label}>{label}</label>
      <div style={styles.inputBox} onClick={() => setOpen(!open)}>
        {selectedLabels.length === 0 && <span style={styles.placeholder}>{placeholder}</span>}
        {selectedLabels.length > 0 && (
          <div style={styles.tags}>
            {selectedLabels.slice(0, 3).map((name, i) => (
              <span key={i} style={styles.tag}>{name}</span>
            ))}
            {selectedLabels.length > 3 && <span style={styles.tag}>+{selectedLabels.length - 3} more</span>}
          </div>
        )}
        <span style={styles.arrow}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={styles.dropdown}>
          <input
            style={styles.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
          <div style={styles.optionsList}>
            {options.length === 0 && <p style={styles.empty}>{emptyMessage}</p>}
            {filtered.length === 0 && options.length > 0 && <p style={styles.empty}>No matches</p>}
            {filtered.map((option) => (
              <label key={option.id} style={styles.option}>
                <input
                  type="checkbox"
                  checked={selected.includes(option.id)}
                  onChange={() => toggle(option.id)}
                  style={{ width: '16px', height: '16px', flexShrink: 0 }}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <button type="button" style={styles.clearBtn} onClick={() => onChange([])}>Clear all</button>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { position: 'relative', display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' },
  inputBox: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '6px 10px', minHeight: '36px', cursor: 'pointer', background: 'var(--color-background)' },
  placeholder: { fontSize: '13px', color: 'var(--color-text-secondary)' },
  tags: { display: 'flex', gap: '4px', flexWrap: 'wrap', flex: 1 },
  tag: { fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' },
  arrow: { fontSize: '10px', color: 'var(--color-text-secondary)', marginLeft: '8px' },
  dropdown: { position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px', background: 'var(--color-surface-modal, #FFFFFF)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 100, overflow: 'hidden' },
  search: { width: '100%', border: 'none', borderBottom: '1px solid var(--color-border)', padding: '8px 10px', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-family)', boxSizing: 'border-box' },
  optionsList: { maxHeight: '160px', overflowY: 'auto', padding: '4px 0' },
  option: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', fontSize: '13px', color: 'var(--color-text)', cursor: 'pointer' },
  empty: { fontSize: '12px', color: 'var(--color-text-secondary)', padding: '8px 10px', margin: 0 },
  clearBtn: { width: '100%', border: 'none', borderTop: '1px solid var(--color-border)', padding: '6px', fontSize: '12px', color: 'var(--color-text-secondary)', cursor: 'pointer', background: 'var(--color-surface-modal, #FFFFFF)', textAlign: 'center' },
};
