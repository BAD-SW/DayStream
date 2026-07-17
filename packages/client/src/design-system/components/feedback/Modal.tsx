import { ReactNode, useEffect, useRef } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: 'sm' | 'md' | 'lg' | 'full';
  children: ReactNode;
  footer?: ReactNode;
}

const sizeMap = { sm: '400px', md: '560px', lg: '720px', full: '95vw' };

export function Modal({ open, onClose, title, size = 'md', children, footer }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      // Focus trap — focus the dialog
      dialogRef.current?.focus();
    } else {
      document.body.style.overflow = '';
    }
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

  // Detect mobile for full-screen rendering
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const dialogMaxWidth = isMobile ? '100vw' : sizeMap[size];
  const dialogBorderRadius = isMobile ? '0' : 'var(--radius-lg)';
  const dialogHeight = isMobile ? '100vh' : 'auto';

  return (
    <div style={styles.overlay} aria-hidden="true">
      <div
        ref={dialogRef}
        style={{ ...styles.dialog, maxWidth: dialogMaxWidth, borderRadius: dialogBorderRadius, height: dialogHeight }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
      >
        <div style={styles.header}>
          <h2 id="modal-title" style={styles.title}>{title}</h2>
          <button onClick={onClose} style={styles.close} aria-label="Close">✕</button>
        </div>
        <div style={styles.body}>{children}</div>
        {footer && <div style={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'var(--color-overlay)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 'var(--z-modal)' as any, padding: 'var(--space-md)',
  },
  dialog: {
    background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: 'var(--radius-lg)',
    width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
    boxShadow: 'var(--shadow-xl)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: 'var(--space-lg)', borderBottom: '1px solid var(--color-border)',
  },
  title: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' as any, margin: 0, color: 'var(--color-text)' },
  close: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: '20px', cursor: 'pointer', padding: '4px' },
  body: { padding: 'var(--space-lg)', overflowY: 'auto', flex: 1 },
  footer: { padding: 'var(--space-lg)', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)' },
};
