import { useState } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { useContextManager } from '../context/ContextManager';
import * as clockApi from '../api/clock';
import type { ClockEventType } from '../api/clock';
import { useTranslation, Trans } from 'react-i18next';
import { formatTime } from '../utils/format';

/**
 * Clock — a shared time-clock screen. Any staff member walks up, enters their
 * email + 4-digit PIN, and the screen shows only the actions valid for
 * their current state (clocked out → Clock In; working → Clock Out / Start
 * Break; on break → End Break). After a punch it confirms and resets for the
 * next person. The PIN is the per-employee authorization for the punch.
 */

const EVENT_VARIANT: Record<ClockEventType, 'primary' | 'outline'> = {
  clock_in: 'primary',
  break_start: 'outline',
  break_end: 'primary',
  clock_out: 'primary',
};

type Phase = 'identify' | 'actions' | 'done';

export function Clock() {
  const { t } = useTranslation('staff');
  // Use the active context, not localStorage: the stored business_id can be
  // empty or stale and point at a different business than the one on screen.
  const businessId = useContextManager().activeContext.businessId || '';

  const [phase, setPhase] = useState<Phase>('identify');
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [state, setState] = useState<clockApi.ClockState | null>(null);
  const [allowed, setAllowed] = useState<ClockEventType[]>([]);
  const [staffName, setStaffName] = useState('');
  const [doneMessage, setDoneMessage] = useState('');

  function reset() {
    setPhase('identify');
    setEmail('');
    setPin('');
    setState(null);
    setAllowed([]);
    setStaffName('');
    setErrorMsg(null);
    setDoneMessage('');
  }

  async function handleIdentify(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}$/.test(pin)) { setErrorMsg(t('clock.errPin')); return; }
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await clockApi.getClockState(businessId, email.trim(), pin);
      setState(result.state);
      setAllowed(result.allowed);
      setStaffName(`${result.staff.first_name} ${result.staff.last_name}`.trim());
      setPhase('actions');
    } catch (err: any) {
      const code = err?.response?.data?.code;
      setErrorMsg(
        code === 'LOCKED' ? t('clock.errLocked')
          : code === 'INVALID_CREDENTIALS' ? t('clock.errCredentials')
            : t('clock.errVerify'),
      );
    } finally { setLoading(false); }
  }

  async function handlePunch(eventType: ClockEventType) {
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await clockApi.punch(businessId, email.trim(), pin, eventType);
      const name = `${result.staff.first_name} ${result.staff.last_name}`.trim();
      setDoneMessage(t('clock.recorded', { event: t(`clock.event.${eventType}`), name, time: formatTime(result.event.event_at, undefined, { hour: '2-digit' }) }));
      setPhase('done');
    } catch (err: any) {
      const code = err?.response?.data?.code;
      setErrorMsg(
        code === 'INVALID_TRANSITION' ? (err.response.data.error || t('clock.errTransition'))
          : code === 'LOCKED' ? t('clock.errLocked')
            : t('clock.errPunch'),
      );
    } finally { setLoading(false); }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>{t('clock.title')}</h1>

        {phase === 'identify' && (
          <form onSubmit={handleIdentify} style={styles.form}>
            <p style={styles.subtitle}>{t('clock.identify')}</p>
            <div style={styles.field}>
              <label htmlFor="clock-email" style={styles.label}>{t('clock.email')}</label>
              <input
                id="clock-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                type="email"
                autoComplete="email"
                style={styles.input}
                placeholder={t('clock.emailPlaceholder')}
              />
            </div>
            <div style={styles.field}>
              <label htmlFor="clock-pin" style={styles.label}>{t('clock.pin')}</label>
              <input
                id="clock-pin"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                type="password"
                autoComplete="off"
                style={styles.input}
                placeholder={t('clock.pinPlaceholder')}
              />
            </div>
            {errorMsg && <p style={styles.error}>{errorMsg}</p>}
            <Button type="submit" variant="primary" loading={loading} disabled={!businessId || !email.trim() || pin.length !== 4}>
              {t('clock.continue')}
            </Button>
          </form>
        )}

        {phase === 'actions' && state && (
          <div style={styles.form}>
            <p style={styles.subtitle}>
              <Trans i18nKey="clock.currently" ns="staff" values={{ name: staffName, state: t(`clock.state.${state}`).toLowerCase() }} components={{ strong: <strong /> }} />
            </p>
            <div style={styles.actions}>
              {allowed.map((ev) => (
                <Button key={ev} variant={EVENT_VARIANT[ev]} loading={loading} onClick={() => handlePunch(ev)}>
                  {t(`clock.event.${ev}`)}
                </Button>
              ))}
            </div>
            {errorMsg && <p style={styles.error}>{errorMsg}</p>}
            <button type="button" style={styles.linkBtn} onClick={reset}>{t('common:cancel')}</button>
          </div>
        )}

        {phase === 'done' && (
          <div style={styles.form}>
            <p style={styles.done}>✓ {doneMessage}</p>
            <Button variant="primary" onClick={reset}>{t('clock.done')}</Button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 'var(--space-xl)' },
  card: { width: '100%', maxWidth: '420px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--card-radius, 16px)', padding: 'var(--space-xl)', boxShadow: 'var(--shadow-md)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: '0 0 var(--space-md)' },
  subtitle: { fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-md)' },
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' },
  field: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any, color: 'var(--color-text)' },
  input: { padding: '12px 14px', fontSize: 'var(--font-size-lg)', border: '1px solid var(--color-border)', borderRadius: 'var(--control-radius, 10px)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', letterSpacing: '0.02em' },
  actions: { display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' },
  error: { color: 'var(--color-error, #C4291C)', fontSize: 'var(--font-size-sm)', margin: 0 },
  done: { color: 'var(--color-success, #17794A)', fontSize: 'var(--font-size-lg)', margin: 0, textAlign: 'center' },
  linkBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)' },
};
