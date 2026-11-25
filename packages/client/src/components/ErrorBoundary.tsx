import { Component, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/** The error screen. A function component, so it can use the translation hook (the boundary itself is a class). */
function ErrorScreen({ error }: { error: Error | null }) {
  const { t } = useTranslation('shell');
  return (
    <div style={styles.container}>
      <h2 style={styles.title}>{t('error_boundary.title')}</h2>
      <p style={styles.message}>
        {error?.message || t('error_boundary.fallback_message')}
      </p>
      <button
        onClick={() => window.location.reload()}
        style={styles.button}
      >
        {t('error_boundary.reload')}
      </button>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return <ErrorScreen error={this.state.error} />;
    }

    return this.props.children;
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A1A1A',
    color: '#F5F5F3',
    fontFamily: "'Inter', sans-serif",
    padding: '32px',
    textAlign: 'center' as const,
  },
  title: {
    fontSize: 'var(--font-size-2xl)',
    fontWeight: 300,
    marginBottom: '12px',
  },
  message: {
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--font-size-base)',
    marginBottom: '24px',
  },
  button: {
    backgroundColor: '#C9A96E',
    color: '#1A1A1A',
    border: 'none',
    borderRadius: 'var(--button-radius)',
    padding: '10px 20px',
    fontSize: 'var(--font-size-base)',
    fontWeight: 600,
    cursor: 'pointer', minHeight: 'var(--button-height-sm)' },
};
