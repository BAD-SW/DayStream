import { useCallback, useEffect, useRef, useState } from 'react';
import {
  kioskCheckIn, kioskForms, kioskStartForm, kioskStatus, selfCheckInError,
} from '../api/selfCheckIn';
import type { SelfVisit, UpcomingAppointment } from '../api/selfCheckIn';
import { SelfFormsList } from '../components/forms/SelfFormsList';

/**
 * The front-desk check-in screen (spec 51, design 1.11a): a full-screen page for a tablet.
 *
 * The customer types the phone number or email address on their booking (or a scanner types their
 * QR code). Never a name. They are checked in, then see every form for the visit, with a tick on
 * the completed ones and a button on the rest. A form never holds the check-in back.
 *
 * The tablet is registered once under Check-In > Kiosk; staff open the link shown there, which
 * carries the device token. The token is kept in this browser and removed from the address.
 */
const TOKEN_KEY = 'kiosk_token';
const VISIT_KEY = 'kiosk_visit';
const VISIT_MAX_AGE_MS = 10 * 60 * 1000;
const IDLE_MS = 2 * 60 * 1000;
// How often the tablet asks whether it is still switched on.
const AVAILABILITY_CHECK_MS = 30 * 1000;

interface StoredVisit { visit: SelfVisit; at: number }

function readStoredVisit(): SelfVisit | null {
  try {
    const raw = sessionStorage.getItem(VISIT_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredVisit;
    return Date.now() - stored.at < VISIT_MAX_AGE_MS ? stored.visit : null;
  } catch { return null; }
}

/** What was typed: an email address, a scanned booking code, or a phone number. */
function classify(input: string): { email?: string; code?: string; phone?: string } {
  const v = input.trim();
  if (v.includes('@')) return { email: v };
  if (/^DSC[IC]-/i.test(v)) return { code: v };
  return { phone: v };
}

/*
 * The kiosk's key. Each browser tab remembers its own (sessionStorage), so two kiosks open in two
 * tabs of one browser stay two kiosks, and a reload keeps the tab's own kiosk. The last key is also
 * kept for the whole browser (localStorage), which is what a real tablet needs after it is closed
 * and opened again. A key in the address (the link from Settings) always wins and is saved at once.
 */
function saveToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(TOKEN_KEY, token);
}
function forgetToken(token: string) {
  if (sessionStorage.getItem(TOKEN_KEY) === token) sessionStorage.removeItem(TOKEN_KEY);
  if (localStorage.getItem(TOKEN_KEY) === token) localStorage.removeItem(TOKEN_KEY);
}
function initialToken(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get('token');
  if (fromUrl) { saveToken(fromUrl); return fromUrl; }
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
}

export function Kiosk() {
  const [token, setToken] = useState<string | null>(initialToken);
  const [visit, setVisit] = useState<SelfVisit | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Nothing today, but the person has other appointments: shown so they can tell the front desk.
  const [upcoming, setUpcoming] = useState<UpcomingAppointment[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Whether staff have this kiosk switched on. Checked when the page opens and every 30 seconds,
  // so switching it off takes effect at once and switching it back on needs no one to touch the tablet.
  const [availability, setAvailability] = useState<'checking' | 'on' | 'off'>('checking');

  // The kiosk's name, shown in the browser tab's title (handy when several kiosks are open).
  const [kioskName, setKioskName] = useState<string | null>(null);
  useEffect(() => { document.title = kioskName ? `Kiosk · ${kioskName}` : 'Kiosk'; }, [kioskName]);

  useEffect(() => {
    if (!token) return;
    // An answer for a key this page no longer uses must never change what is shown.
    let stale = false;
    setAvailability('checking');
    const check = async () => {
      try {
        const info = await kioskStatus(token);
        if (stale) return;
        setKioskName(info.device_name);
        setAvailability('on');
      } catch (err) {
        if (stale) return;
        const { code } = selfCheckInError(err, '');
        if (code === 'KIOSK_UNKNOWN') { forgetToken(token); setToken(null); setKioskName(null); }   // deleted: forget the key
        else if (code === 'KIOSK_OFF') setAvailability('off');                                      // switched off: keep the key
        // Any other failure (no network for a moment) leaves the screen as it is.
      }
    };
    check();
    const timer = window.setInterval(check, AVAILABILITY_CHECK_MS);
    return () => { stale = true; window.clearInterval(timer); };
  }, [token]);

  // The key came in the address (the link from Settings): it is already saved, so take it out of the address.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('token')) window.history.replaceState(null, '', '/kiosk');
  }, []);

  const startOver = useCallback(() => {
    sessionStorage.removeItem(VISIT_KEY);
    setVisit(null); setUpcoming(null); setInput(''); setError(null);
  }, []);

  const remember = (v: SelfVisit) => sessionStorage.setItem(VISIT_KEY, JSON.stringify({ visit: v, at: Date.now() } satisfies StoredVisit));

  // Coming back from a form: show the same visit again with the forms refreshed.
  useEffect(() => {
    const stored = readStoredVisit();
    if (!stored?.session || !token) return;
    kioskForms(token, stored.session)
      .then((fresh) => {
        const next = { ...fresh, session: stored.session, checked_in_now: stored.checked_in_now };
        setVisit(next); remember(next);
      })
      .catch(() => startOver());
  }, [token, startOver]);

  // Back to the start after two minutes of nobody touching the screen, so the next person never
  // sees the last one's name.
  useEffect(() => {
    if (!visit && !upcoming) return;
    let timer = window.setTimeout(startOver, IDLE_MS);
    const reset = () => { window.clearTimeout(timer); timer = window.setTimeout(startOver, IDLE_MS); };
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
    };
  }, [visit, upcoming, startOver]);

  useEffect(() => { if (!visit && !upcoming) inputRef.current?.focus(); }, [visit, upcoming]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !input.trim()) return;
    setBusy(true); setError(null);
    try {
      const v = await kioskCheckIn(token, classify(input));
      setVisit(v); remember(v); setInput('');
    } catch (err) {
      const { message, code, upcoming: others } = selfCheckInError(err, 'Check-in did not work. Please see the front desk.');
      // A kiosk that is switched off (or deleted) keeps its key on the tablet and says so, so it
      // works again as soon as staff switch it back on.
      if (code === 'KIOSK_OFF') setAvailability('off');
      else if (code === 'KIOSK_UNKNOWN') { forgetToken(token); setToken(null); }
      else if (code === 'NOT_TODAY' && others.length > 0) { setUpcoming(others); setInput(''); }
      else setError(message);
    } finally { setBusy(false); }
  };

  const fillIn = async (groupId: string) => {
    if (!token || !visit?.session) return;
    setBusyGroup(groupId); setError(null);
    try {
      const { path } = await kioskStartForm(token, visit.session, groupId);
      window.location.assign(`${path}?next=/kiosk`);
    } catch (err) {
      const { message, code } = selfCheckInError(err, 'The form could not be opened. Please see the front desk.');
      if (code === 'SESSION_EXPIRED') startOver(); else setError(message);
    } finally { setBusyGroup(null); }
  };

  if (!token) {
    return (
      <Screen>
        <h1 style={s.title}>This screen is not set up</h1>
        <p style={s.text}>Ask a member of staff to open the check-in screen from Check-In &gt; Kiosk.</p>
      </Screen>
    );
  }

  // Not switched on (or not yet known): never show the entry form, so no one types details that go nowhere.
  if (!visit && !upcoming && availability !== 'on') {
    return (
      <Screen>
        {availability === 'checking'
          ? <p style={s.text} role="status">Loading…</p>
          : <>
            <h1 style={s.title}>Check-in is not available</h1>
            <p style={s.text} role="status">This kiosk is switched off. Please see the front desk.</p>
          </>}
      </Screen>
    );
  }

  if (upcoming) {
    return (
      <Screen>
        <h1 style={s.title}>Nothing is scheduled for today</h1>
        <p style={s.text}>We could not find an appointment for you today, but you have {upcoming.length === 1 ? 'this appointment' : 'these appointments'}:</p>
        <ul style={s.upcoming} aria-label="Your other appointments">
          {upcoming.map((a, i) => (
            <li key={i} style={s.upcomingRow}>
              <strong>{a.service_name}</strong>
              <span>{new Date(a.start_time).toLocaleString([], { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: a.timezone })}</span>
            </li>
          ))}
        </ul>
        <p style={s.text}>If one of these should be today, please see the front desk. It may have been moved.</p>
        <button type="button" style={s.done} onClick={startOver}>Back</button>
      </Screen>
    );
  }

  if (visit) {
    const time = new Date(visit.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: visit.timezone });
    const todo = visit.forms.some((f) => f.status !== 'done');
    return (
      <Screen>
        <h1 style={s.title}>Welcome, {visit.first_name}</h1>
        <p style={s.text} role="status">
          {visit.checked_in_now === false ? 'You are already checked in for ' : 'You are checked in for '}
          <strong>{visit.service_name}</strong> at {time}.
        </p>
        <SelfFormsList forms={visit.forms} busyGroupId={busyGroup} onFillIn={fillIn} />
        {error && <p role="alert" style={s.error}>{error}</p>}
        <p style={s.text}>{todo ? 'You can fill these in now, or later at the front desk.' : 'All set. Please take a seat.'}</p>
        <button type="button" style={s.done} onClick={startOver}>Done</button>
      </Screen>
    );
  }

  return (
    <Screen>
      <h1 style={s.title}>Welcome</h1>
      <p style={s.text}>Please check in. Enter the phone number or email address you booked with.</p>
      <form onSubmit={submit} style={s.form} noValidate>
        <label htmlFor="kiosk-who" style={s.label}>Phone number or email address</label>
        <input
          id="kiosk-who" ref={inputRef} style={s.input} value={input} disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="email"
          aria-invalid={!!error} aria-describedby={error ? 'kiosk-error' : undefined}
        />
        {error && <p id="kiosk-error" role="alert" style={s.error}>{error}</p>}
        <button type="submit" style={{ ...s.go, opacity: busy || !input.trim() ? 0.6 : 1 }} disabled={busy || !input.trim()}>
          {busy ? 'Checking in…' : 'Check in'}
        </button>
      </form>
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
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-background)', fontFamily: 'var(--font-family)', padding: 'var(--space-lg)', boxSizing: 'border-box' },
  card: { width: '100%', maxWidth: '720px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '16px', padding: 'var(--space-xl)', boxSizing: 'border-box', textAlign: 'center' },
  title: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-h1, 2rem)', fontWeight: 700, color: 'var(--color-text)' },
  text: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-lg, 1.125rem)', color: 'var(--color-text)', lineHeight: 1.5 },
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', textAlign: 'left' },
  label: { fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--color-text)' },
  input: { width: '100%', minHeight: '64px', padding: '12px 16px', fontSize: '1.5rem', border: '2px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', boxSizing: 'border-box' },
  go: { minHeight: '64px', fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--font-family)', background: 'var(--color-primary)', color: 'var(--color-primary-contrast)', border: 'none', borderRadius: 'var(--button-radius)', cursor: 'pointer' },
  done: { minHeight: '56px', minWidth: '160px', padding: '12px 32px', fontSize: '1.125rem', fontWeight: 600, fontFamily: 'var(--font-family)', background: 'transparent', color: 'var(--color-text)', border: '2px solid var(--color-border)', borderRadius: 'var(--button-radius)', cursor: 'pointer' },
  error: { margin: 0, color: 'var(--color-error)', fontSize: 'var(--font-size-base)', fontWeight: 600 },
  upcoming: { listStyle: 'none', margin: '0 0 var(--space-md) 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' },
  upcomingRow: { display: 'flex', flexDirection: 'column', gap: '2px', padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)', color: 'var(--color-text)', fontSize: 'var(--font-size-lg, 1.125rem)' },
};
