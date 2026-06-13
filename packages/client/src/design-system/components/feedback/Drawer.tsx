import { ReactNode, useEffect } from 'react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  position?: 'left' | 'right';
  title?: string;
  children: ReactNode;
}

export function Drawer({ open, onClose, position = 'right', title, children }: DrawerProps) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) onClose();
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onClose]);

  if (!open) return null;

  const posStyle = position === 'right' ? { right: 0 } : { left: 0 };

  return (
    <>
      <div style={styles.overlay} onClick={onClose} aria-hidden="true" />
      <aside style={{ ...styles.drawer, ...posStyle }} role="dialog" aria-modal="true">
        {title && (
          <div style={styles.header}>
            <h2 style={styles.title}>{title}</h2>
            <button onClick={onClose} style={styles.close} aria-label="Close">✕</button>
          </div>
        )}
        <div style={styles.body}>{children}</div>
      </aside>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'var(--color-overlay)', zIndex: 400 },
  drawer: { position: 'fixed', top: 0, bottom: 0, width: '360px', maxWidth: '90vw', background: 'var(--color-surface)', zIndex: 401, display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-xl)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-lg)', borderBottom: '1px solid var(--color-border)' },
  title: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any, margin: 0, color: 'var(--color-text)' },
  close: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: '20px', cursor: 'pointer' },
  body: { flex: 1, overflowY: 'auto', padding: 'var(--space-lg)' },
};
