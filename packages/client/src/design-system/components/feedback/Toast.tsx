import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

type ToastVariant = 'success' | 'warning' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, variant: ToastVariant) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value: ToastContextValue = {
    success: (msg) => addToast(msg, 'success'),
    error: (msg) => addToast(msg, 'error'),
    warning: (msg) => addToast(msg, 'warning'),
    info: (msg) => addToast(msg, 'info'),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div style={styles.container} aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            style={{ ...styles.toast, ...variantStyles[toast.variant] }}
            onClick={() => dismiss(toast.id)}
            role="alert"
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed', bottom: 'var(--space-lg)', right: 'var(--space-lg)',
    display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)',
    zIndex: 800, maxWidth: '360px',
  },
  toast: {
    padding: 'var(--space-sm) var(--space-md)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--font-size-sm)',
    cursor: 'pointer',
    boxShadow: 'var(--shadow-lg)',
    animation: 'slideIn 0.2s ease-out',
  },
};

const variantStyles: Record<ToastVariant, React.CSSProperties> = {
  success: { background: 'var(--color-success)', color: '#FFFFFF' },
  error: { background: 'var(--color-error)', color: '#FFFFFF' },
  warning: { background: 'var(--color-warning)', color: '#1A1A1A' },
  info: { background: 'var(--color-info)', color: '#FFFFFF' },
};
