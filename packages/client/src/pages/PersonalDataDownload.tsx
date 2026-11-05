import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';

/**
 * Personal data download — reached from the emailed link (/personal-data?token=...).
 * No sign-in: the token in the link is the key, and it works for 24 hours. The file is
 * a password-protected PDF; the business gives the person the password separately.
 */
export function PersonalDataDownload() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const download = async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiClient.get(`/v1/public/personal-data/${encodeURIComponent(token)}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a'); a.href = url; a.download = 'personal-data.pdf'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDone(true);
    } catch (err: any) {
      // The error body arrives as a blob because of responseType.
      let msg = 'This link has expired or is not valid. Ask the business to send it again.';
      try { const body = JSON.parse(await err?.response?.data?.text?.()); if (body?.error) msg = body.error; } catch { /* keep default */ }
      setError(msg);
    } finally { setLoading(false); }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>DayStream</h1>
        <p style={styles.subtitle}>Your personal data</p>
        <div style={styles.form}>
          {!token && <p style={styles.error}>This link is missing its key. Please use the link from your email.</p>}
          {token && (
            <>
              <p style={styles.text}>The file is protected with a password. The business gives you the password separately. The link works for 24 hours.</p>
              <button type="button" onClick={download} disabled={loading} style={styles.button}>{loading ? 'Downloading…' : 'Download'}</button>
              {done && <p style={styles.success}>✓ The file has been downloaded.</p>}
              {error && <p role="alert" style={styles.error}>{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-background)', fontFamily: 'var(--font-family)', padding: '16px' },
  card: { backgroundColor: 'var(--color-surface)', borderRadius: '12px', padding: '48px 40px', width: '100%', maxWidth: '400px', border: '1px solid var(--color-border)' },
  title: { color: 'var(--color-text)', fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, margin: '0 0 8px 0', textAlign: 'center' as const },
  subtitle: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)', margin: '0 0 32px 0', textAlign: 'center' as const },
  form: { display: 'flex', flexDirection: 'column' as const, gap: '16px' },
  text: { color: 'var(--color-text)', fontSize: 'var(--font-size-sm)', margin: 0, textAlign: 'center' as const },
  error: { color: 'var(--color-error, #C4291C)', fontSize: 'var(--font-size-base)', margin: 0, textAlign: 'center' as const },
  success: { color: 'var(--color-success, #17794A)', fontSize: 'var(--font-size-base)', margin: 0, textAlign: 'center' as const },
  button: { backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-contrast)', border: 'none', borderRadius: 'var(--button-radius)', padding: '12px 24px', fontSize: 'var(--font-size-base)', fontWeight: 600, cursor: 'pointer', minHeight: 'var(--button-height-sm)' },
};
