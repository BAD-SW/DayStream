import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { phoneVisit, phoneCheckIn, phoneStartForm, selfCheckInError } from '../api/selfCheckIn';
import type { SelfVisit } from '../api/selfCheckIn';
import { SelfFormsList } from '../components/forms/SelfFormsList';

/**
 * Check in from your own phone (spec 51, design 1.11a). Reached from the link in the reminder
 * email; no login, the personal code in the link identifies the booking. An "I'm here" button,
 * then the list of forms for the visit. A form never holds the check-in back.
 */
export function PhoneCheckIn() {
  const { code = '' } = useParams<{ code: string }>();
  const [visit, setVisit] = useState<SelfVisit | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyGroup, setBusyGroup] = useState<string | null>(null);

  const load = useCallback(() => {
    phoneVisit(code)
      .then(setVisit)
      .catch((err) => setInvalid(selfCheckInError(err, 'This link is no longer valid. Please see the front desk.').message));
  }, [code]);
  useEffect(() => { load(); }, [load]);

  // Forms are completed on another page; check again when the customer comes back.
  useEffect(() => {
    const onFocus = () => { if (visit) load(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [visit, load]);

  const here = async () => {
    setBusy(true); setError(null);
    try {
      setVisit(await phoneCheckIn(code));
    } catch (err) {
      setError(selfCheckInError(err, 'Check-in did not work. Please see the front desk.').message);
    } finally { setBusy(false); }
  };

  const fillIn = async (groupId: string) => {
    setBusyGroup(groupId); setError(null);
    try {
      const { path } = await phoneStartForm(code, groupId);
      window.location.assign(`${path}?next=${encodeURIComponent(`/check-in/${code}`)}`);
    } catch (err) {
      setError(selfCheckInError(err, 'The form could not be opened. Please see the front desk.').message);
    } finally { setBusyGroup(null); }
  };

  if (invalid) {
    return <Screen><h1 style={s.title}>Check-in</h1><p role="alert" style={s.text}>{invalid}</p></Screen>;
  }
  if (!visit) {
    return <Screen><p role="status" style={s.text}>Loading…</p></Screen>;
  }

  const when = new Date(visit.start_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short', timeZone: visit.timezone });
  const canCheckIn = visit.status === 'confirmed';
  const closed = !canCheckIn && !visit.checked_in;

  return (
    <Screen>
      <h1 style={s.title}>Hello, {visit.first_name}</h1>
      <p style={s.text}><strong>{visit.service_name}</strong><br />{when}</p>

      {visit.checked_in && (
        <p role="status" style={s.ok}>You are checked in. Please take a seat; we will be with you shortly.</p>
      )}
      {canCheckIn && (
        <button type="button" style={{ ...s.go, opacity: busy ? 0.7 : 1 }} disabled={busy} onClick={here}>
          {busy ? 'Checking in…' : "I'm here"}
        </button>
      )}
      {closed && <p role="status" style={s.text}>This appointment can no longer be checked in. Please see the front desk.</p>}
      {error && <p role="alert" style={s.error}>{error}</p>}

      <SelfFormsList forms={visit.forms} busyGroupId={busyGroup} onFillIn={fillIn} />
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div style={s.page}>
      <main style={s.card}>{children}</main>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--color-background)', fontFamily: 'var(--font-family)', padding: 'var(--space-md)', boxSizing: 'border-box' },
  card: { maxWidth: '560px', margin: '0 auto', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: 'var(--space-lg)', boxSizing: 'border-box', textAlign: 'center' },
  title: { margin: '0 0 var(--space-sm) 0', fontSize: 'var(--font-size-h2, 1.5rem)', fontWeight: 700, color: 'var(--color-text)' },
  text: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-base)', color: 'var(--color-text)', lineHeight: 1.5 },
  ok: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-base)', color: 'var(--color-success)', fontWeight: 600 },
  go: { width: '100%', minHeight: '64px', fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--font-family)', background: 'var(--color-primary)', color: 'var(--color-primary-contrast)', border: 'none', borderRadius: 'var(--button-radius)', cursor: 'pointer', marginBottom: 'var(--space-md)' },
  error: { margin: '0 0 var(--space-md) 0', color: 'var(--color-error)', fontSize: 'var(--font-size-base)', fontWeight: 600 },
};
