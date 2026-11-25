import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import { PublicLanguageBar } from '../components/PublicLanguageBar';
import { LoginBackdrop } from '../components/LoginBackdrop';

export function Login() {
  const { t } = useTranslation('auth');
  const { t: tc } = useTranslation('common');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  // For now, hardcode the seed tenant
  const TENANT_ID = '00000000-0000-0000-0000-000000000001';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(TENANT_ID, email, password);
      navigate('/dashboard');
    } catch (err: any) {
      const msg = err.response?.data?.error || t('login.failed');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <LoginBackdrop />
      <PublicLanguageBar />
      <div style={styles.card}>
        <h1 style={styles.title}>{tc('app_name')}</h1>
        <p style={styles.subtitle}>{t('sign_in_subtitle')}</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.fieldGroup}>
            <label htmlFor="email" style={styles.label}>{t('email')}</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('login.emailPlaceholder')}
              required
              style={styles.input}
              autoComplete="email"
            />
          </div>

          <div style={styles.fieldGroup}>
            <label htmlFor="password" style={styles.label}>{t('password')}</label>
            <div style={styles.passwordWrapper}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                required
                style={styles.input}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={styles.revealBtn}
                aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? t('signing_in') : t('sign_in')}
          </button>

          <Link to="/forgot-password" style={styles.forgotLink}>{t('login.forgotYourPassword')}</Link>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--color-background)',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    padding: '16px',
    paddingTop: 'var(--space-xl)',
    position: 'relative' as const,
  },
  card: {
    // The light theme's surface is partly see-through; laid over the solid page colour it looks the
    // same but hides the wordmarks behind the panel.
    backgroundColor: 'var(--color-background)',
    backgroundImage: 'linear-gradient(var(--color-surface), var(--color-surface))',
    borderRadius: '12px',
    padding: '48px 40px',
    width: '100%',
    maxWidth: '400px',
    border: '1px solid var(--color-border)',
    // Above the scattered wordmarks behind it.
    position: 'relative' as const,
    zIndex: 1,
  },
  title: {
    color: 'var(--color-text)',
    fontSize: 'var(--page-title-size)',
    fontWeight: 'var(--page-title-weight)' as any,
    margin: '0 0 8px 0',
    textAlign: 'center' as const,
  },
  subtitle: {
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--font-size-base)',
    margin: '0 0 32px 0',
    textAlign: 'center' as const,
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '20px',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  label: {
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-base)',
    fontWeight: 500,
  },
  input: {
    backgroundColor: 'var(--color-background)',
    border: '1px solid var(--color-border)',
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: 'var(--font-size-base)',
    color: 'var(--color-text)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  button: {
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-primary-contrast)',
    border: 'none',
    borderRadius: 'var(--button-radius)',
    padding: '12px 24px',
    fontSize: 'var(--font-size-base)',
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: '8px', minHeight: 'var(--button-height-sm)' },
  error: {
    color: '#EF5350',
    fontSize: 'var(--font-size-base)',
    margin: 0,
    textAlign: 'center' as const,
  },
  forgotLink: {
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--font-size-sm)',
    textAlign: 'center' as const,
    textDecoration: 'none',
  },
  passwordWrapper: {
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
  },
  revealBtn: {
    position: 'absolute' as const,
    right: '12px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 'var(--font-size-base)',
    padding: '4px',
    lineHeight: 1, borderRadius: 'var(--button-radius)', minHeight: 'var(--button-height-sm)' },
};
