import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setWidgetToken, widgetLogin, widgetRegister, WidgetApiError, WidgetAuthResult } from '../../api/widget';

interface Props {
  tenantId: string;
  businessId: string;
  onAuthenticated: (result: WidgetAuthResult) => void;
  onBack: () => void;
}

export function LoginRegisterStep({ tenantId, businessId, onAuthenticated, onBack }: Props) {
  const { t } = useTranslation('widget');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = mode === 'login'
        ? await widgetLogin(tenantId, email, password)
        : await widgetRegister(tenantId, businessId, email, password, firstName, lastName);
      setWidgetToken(result.access_token);
      onAuthenticated(result);
    } catch (err) {
      setError(err instanceof WidgetApiError ? err.message : t('login.error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="dsw-step">
      <h2 className="dsw-step-title">{mode === 'login' ? t('login.loginTitle') : t('login.registerTitle')}</h2>
      <p className="dsw-step-text">{t('login.required')}</p>

      <div className="dsw-tabs">
        <button
          type="button"
          className={`dsw-tab ${mode === 'login' ? 'dsw-tab--active' : ''}`}
          onClick={() => { setMode('login'); setError(null); }}
        >
          {t('login.loginTab')}
        </button>
        <button
          type="button"
          className={`dsw-tab ${mode === 'register' ? 'dsw-tab--active' : ''}`}
          onClick={() => { setMode('register'); setError(null); }}
        >
          {t('login.registerTab')}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="dsw-form">
        {mode === 'register' && (
          <>
            <div className="dsw-field-row">
              <div className="dsw-field">
                <label className="dsw-label" htmlFor="first_name">{t('login.firstName')}</label>
                <input id="first_name" className="dsw-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              </div>
              <div className="dsw-field">
                <label className="dsw-label" htmlFor="last_name">{t('login.lastName')}</label>
                <input id="last_name" className="dsw-input" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
              </div>
            </div>
          </>
        )}

        <div className="dsw-field">
          <label className="dsw-label" htmlFor="email">{t('login.email')}</label>
          <input id="email" type="email" className="dsw-input" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>

        <div className="dsw-field">
          <label className="dsw-label" htmlFor="password">{t('login.password')}</label>
          <input
            id="password"
            type="password"
            className="dsw-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {mode === 'register' && (
            <span className="dsw-hint">{t('login.passwordHint')}</span>
          )}
        </div>

        {error && <p className="dsw-step-error">{error}</p>}

        <button type="submit" className="dsw-btn dsw-btn--primary" disabled={loading}>
          {loading ? t('login.wait') : mode === 'login' ? t('login.loginTab') : t('login.registerTab')}
        </button>
      </form>

      <button type="button" className="dsw-btn dsw-btn--ghost" onClick={onBack}>{t('common:back')}</button>
    </div>
  );
}
