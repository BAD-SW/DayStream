import { useState, FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';

/**
 * Reset Password — reached from the emailed link (/reset-password?token=...).
 * Collects a new password (enforcing the same policy the server requires:
 * min 10 chars with lower, upper, digit, and special), submits it with the
 * token to POST /v1/auth/reset-password, and on success sends the user to sign in.
 */

const RULES: { test: (p: string) => boolean; label: string }[] = [
  { test: (p) => p.length >= 10, label: 'At least 10 characters' },
  { test: (p) => /[a-z]/.test(p), label: 'A lowercase letter' },
  { test: (p) => /[A-Z]/.test(p), label: 'An uppercase letter' },
  { test: (p) => /[0-9]/.test(p), label: 'A number' },
  { test: (p) => /[^a-zA-Z0-9]/.test(p), label: 'A special character' },
];

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const allRulesPass = RULES.every((r) => r.test(password));
  const matches = password === confirm && confirm.length > 0;
  const canSubmit = !!token && allRulesPass && matches;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      await apiClient.post('/v1/auth/reset-password', { token, password });
      setDone(true);
      setTimeout(() => navigate('/login'), 1800);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not reset your password. The link may have expired.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>DayStream</h1>
        <p style={styles.subtitle}>Set a new password</p>

        {!token ? (
          <div style={styles.form}>
            <p style={styles.error}>This reset link is missing its token. Please use the link from your email, or request a new one.</p>
            <Link to="/forgot-password" style={styles.linkBtn}>Request a new link</Link>
          </div>
        ) : done ? (
          <div style={styles.form}>
            <p style={styles.success}>✓ Your password has been reset. Redirecting to sign in…</p>
            <Link to="/login" style={styles.linkBtn}>Go to sign in</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.fieldGroup}>
              <label htmlFor="pw" style={styles.label}>New password</label>
              <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus style={styles.input} autoComplete="new-password" />
            </div>
            <ul style={styles.rules}>
              {RULES.map((r) => {
                const ok = r.test(password);
                return (
                  <li key={r.label} style={{ ...styles.rule, color: ok ? 'var(--color-success, #17794A)' : 'var(--color-text-secondary)' }}>
                    {ok ? '✓' : '○'} {r.label}
                  </li>
                );
              })}
            </ul>
            <div style={styles.fieldGroup}>
              <label htmlFor="pw2" style={styles.label}>Confirm password</label>
              <input id="pw2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required style={styles.input} autoComplete="new-password" />
              {confirm.length > 0 && !matches && <span style={styles.hint}>Passwords don't match.</span>}
            </div>
            {error && <p style={styles.error}>{error}</p>}
            <button type="submit" disabled={loading || !canSubmit} style={{ ...styles.button, opacity: canSubmit ? 1 : 0.6 }}>
              {loading ? 'Saving…' : 'Reset password'}
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
  form: { display: 'flex', flexDirection: 'column' as const, gap: '16px' },
  fieldGroup: { display: 'flex', flexDirection: 'column' as const, gap: '6px' },
  label: { color: 'var(--color-text)', fontSize: 'var(--font-size-base)', fontWeight: 500 },
  input: { backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '10px 12px', fontSize: 'var(--font-size-base)', color: 'var(--color-text)', outline: 'none', width: '100%', boxSizing: 'border-box' as const },
  rules: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column' as const, gap: '2px' },
  rule: { fontSize: 'var(--font-size-sm)' },
  hint: { color: 'var(--color-error, #C4291C)', fontSize: 'var(--font-size-sm)' },
  error: { color: 'var(--color-error, #C4291C)', fontSize: 'var(--font-size-base)', margin: 0, textAlign: 'center' as const },
  success: { color: 'var(--color-success, #17794A)', fontSize: 'var(--font-size-base)', margin: 0, textAlign: 'center' as const },
  button: { backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-contrast)', border: 'none', borderRadius: 'var(--button-radius)', padding: '12px 24px', fontSize: 'var(--font-size-base)', fontWeight: 600, cursor: 'pointer', minHeight: 'var(--button-height-sm)' },
  linkCenter: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', textAlign: 'center' as const, textDecoration: 'none' },
  linkBtn: { color: 'var(--color-primary)', fontSize: 'var(--font-size-base)', textAlign: 'center' as const, textDecoration: 'none', fontWeight: 600 },
};
