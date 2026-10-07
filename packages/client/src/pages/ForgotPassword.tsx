import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';

/**
 * Forgot Password — request a reset link. Submits the email to
 * POST /v1/auth/forgot-password, which (if the account exists) emails a
 * short-lived reset link. The response is always generic to avoid revealing
 * whether an email is registered, so the screen shows the same confirmation
 * either way.
 */
export function ForgotPassword() {
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
      <div style={styles.card}>
        <h1 style={styles.title}>DayStream</h1>
        <p style={styles.subtitle}>Reset your password</p>

        {sent ? (
          <div style={styles.form}>
            <p style={styles.info}>
              If an account exists for <strong>{email}</strong>, a password reset link has been sent.
              The link expires in 15 minutes.
            </p>
            <Link to="/login" style={styles.linkBtn}>Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={styles.form}>
            <p style={styles.info}>Enter your email and we'll send you a link to set a new password.</p>
            <div style={styles.fieldGroup}>
              <label htmlFor="email" style={styles.label}>Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
                style={styles.input}
                autoComplete="email"
              />
            </div>
            <button type="submit" disabled={loading || !email} style={styles.button}>
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
            <Link to="/login" style={styles.linkCenter}>Back to sign in</Link>
          </form>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-background)', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", padding: '16px' },
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
