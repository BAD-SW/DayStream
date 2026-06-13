import { ReactNode, useState, useRef, useEffect } from 'react';

interface DropdownItem {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  divider?: boolean;
  onClick?: () => void;
}

interface DropdownProps {
  trigger: ReactNode;
  items: DropdownItem[];
}

export function Dropdown({ trigger, items }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <div onClick={() => setOpen(!open)} style={{ cursor: 'pointer' }}>
        {trigger}
      </div>
      {open && (
        <div style={styles.menu} role="menu">
          {items.map((item) => {
            if (item.divider) {
              return <div key={item.id} style={styles.divider} role="separator" />;
            }
            return (
              <button
                key={item.id}
                role="menuitem"
                disabled={item.disabled}
                onClick={() => { item.onClick?.(); setOpen(false); }}
                style={{ ...styles.item, ...(item.disabled ? styles.itemDisabled : {}) }}
              >
                {item.icon && <span style={styles.icon}>{item.icon}</span>}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  menu: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 'var(--space-xs)',
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-xs)',
    minWidth: '160px',
    boxShadow: 'var(--shadow-lg)',
    zIndex: 100,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    width: '100%',
    padding: 'var(--space-sm) var(--space-md)',
    background: 'none',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-sm)',
    fontFamily: 'var(--font-family)',
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
  itemDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  divider: { height: '1px', background: 'var(--color-border)', margin: 'var(--space-xs) 0' },
  icon: { fontSize: '14px', width: '18px', textAlign: 'center' as const },
};
