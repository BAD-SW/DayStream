import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useTranslation, Trans } from 'react-i18next';
import { PublicLanguageBar } from '../components/PublicLanguageBar';

/**
 * Forgot Password — request a reset link. Submits the email to
 * POST /v1/auth/forgot-password, which (if the account exists) emails a
 * short-lived reset link. The response is always generic to avoid revealing
 * whether an email is registered, so the screen shows the same confirmation
 * either way.
 */
export function ForgotPassword() {
  const { t } = useTranslation('auth');
  const { t: tc } = useTranslation('common');
  // Same seed tenant the Login screen uses until multi-tenant login lands.
  const TENANT_ID = '00000000-0000-0000-0000-000000000001';

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await apiClient.post('/v1/auth/forgot-password', { tenant_id: TENANT_ID, email });
    } catch {
      // Intentionally ignore — the endpoint is anti-enumeration and always 200s;
      // show the same confirmation regardless.
    } finally {
      setLoading(false);
      setSent(true);
    }
  }

  return (
    <div style={styles.container}>
      <PublicLanguageBar />
      <div style={styles.card}>
        <h1 style={styles.title}>{tc('app_name')}</h1>
        <p style={styles.subtitle}>{t('forgot.subtitle')}</p>

        {sent ? (
          <div style={styles.form}>
            <p style={styles.info}>
              <Trans t={t} i18nKey="forgot.sent" values={{ email }} components={{ 1: <strong /> }} />
            </p>
            <Link to="/login" style={styles.linkBtn}>{t('backToSignIn')}</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={styles.form}>
            <p style={styles.info}>{t('forgot.intro')}</p>
            <div style={styles.fieldGroup}>
              <label htmlFor="email" style={styles.label}>{t('email')}</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('login.emailPlaceholder')}
                required
                autoFocus
                style={styles.input}
                autoComplete="email"
              />
            </div>
            <button type="submit" disabled={loading || !email} style={styles.button}>
              {loading ? t('forgot.sending') : t('forgot.send')}
            </button>
            <Link to="/login" style={styles.linkCenter}>{t('backToSignIn')}</Link>
          </form>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-background)', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", padding: '16px', paddingTop: 'var(--space-xl)', position: 'relative' },
  card: { backgroundColor: 'var(--color-surface)', borderRadius: '12px', padding: '48px 40px', width: '100%', maxWidth: '400px', border: '1px solid var(--color-border)' },
  title: { color: 'var(--color-text)', fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, margin: '0 0 8px 0', textAlign: 'center' as const },
  subtitle: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)', margin: '0 0 32px 0', textAlign: 'center' as const },
  form: { display: 'flex', flexDirection: 'column' as const, gap: '20px' },
  info: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)', margin: 0 },
  fieldGroup: { display: 'flex', flexDirection: 'column' as const, gap: '6px' },
  label: { color: 'var(--color-text)', fontSize: 'var(--font-size-base)', fontWeight: 500 },
  input: { backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '10px 12px', fontSize: 'var(--font-size-base)', color: 'var(--color-text)', outline: 'none', width: '100%', boxSizing: 'border-box' as const },
  button: { backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-contrast)', border: 'none', borderRadius: 'var(--button-radius)', padding: '12px 24px', fontSize: 'var(--font-size-base)', fontWeight: 600, cursor: 'pointer', minHeight: 'var(--button-height-sm)' },
  linkCenter: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', textAlign: 'center' as const, textDecoration: 'none' },
  linkBtn: { color: 'var(--color-primary)', fontSize: 'var(--font-size-base)', textAlign: 'center' as const, textDecoration: 'none', fontWeight: 600 },
};
