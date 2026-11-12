import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../design-system/components/actions/Button';
import { Badge } from '../../design-system/components/data/Badge';
import { Card } from '../../design-system/components/data/Card';
import * as selfApi from '../../api/selfCheckIn';
import { getLocations } from '../../api/locations';

/**
 * Settings > Check-In Kiosk (spec 51, design 1.11a): set up the front-desk tablet where customers
 * check themselves in. Set it up once; register the tablet here, open the link it gives you on
 * the tablet, and switch the tablet off here if it is lost. Acts straight away, like Processes.
 */
export function KioskSettings() {
  const businessId = localStorage.getItem('business_id') || '';
  const [kioskName, setKioskName] = useState('');
  const [locationId, setLocationId] = useState('');
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [devices, setDevices] = useState<selfApi.KioskDevice[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // The address for the tablet, shown once: it carries the device's password.
  const [setupLink, setSetupLink] = useState<string | null>(null);
  // Which kiosk the shown link belongs to (null right after registering a new one).
  const [shownFor, setShownFor] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!businessId) return;
    selfApi.listKioskDevices(businessId).then(setDevices).catch(() => setDevices([]));
  }, [businessId]);

  useEffect(() => {
    load();
    if (!businessId) return;
    getLocations(businessId).then((list) => {
      setLocations(list);
      if (list.length === 1) setLocationId(list[0].id);
    }).catch(() => setLocations([]));
  }, [businessId, load]);

  const handleRegister = async () => {
    if (!kioskName.trim() || !locationId) { setMessage({ ok: false, text: 'Give the kiosk a name and choose its location.' }); return; }
    setBusy(true); setMessage(null); setSetupLink(null); setShownFor(null);
    try {
      const kiosk = await selfApi.registerKioskDevice(businessId, kioskName.trim(), locationId);
      setSetupLink(`${window.location.origin}/kiosk?token=${kiosk.token}`);
      setKioskName('');
      load();
    } catch (err: unknown) {
      setMessage({ ok: false, text: (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'The kiosk could not be registered.' });
    } finally { setBusy(false); }
  };

  const fail = (err: unknown, fallback: string) =>
    setMessage({ ok: false, text: (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback });

  const handleOff = async (d: selfApi.KioskDevice) => {
    if (!confirm(`Switch off "${d.device_name}"? The tablet stops working until you switch it back on.`)) return;
    setMessage(null);
    try { await selfApi.switchOffKiosk(businessId, d.id); load(); }
    catch (err) { fail(err, 'The kiosk could not be switched off.'); }
  };

  const handleOn = async (d: selfApi.KioskDevice) => {
    setMessage(null);
    try { await selfApi.switchOnKiosk(businessId, d.id); load(); setMessage({ ok: true, text: `"${d.device_name}" is on again.` }); }
    catch (err) { fail(err, 'The kiosk could not be switched on.'); }
  };

  const handleDelete = async (d: selfApi.KioskDevice) => {
    if (!confirm(`Delete "${d.device_name}"? Its link stops working for good, and the tablet has to be registered again to be used. Past check-ins are kept.`)) return;
    setMessage(null);
    try {
      await selfApi.deleteKioskDevice(businessId, d.id);
      if (shownFor === d.id) { setShownFor(null); setSetupLink(null); }
      load();
    } catch (err) { fail(err, 'The kiosk could not be deleted.'); }
  };

  // Show the link of a registered kiosk again (the tablet's address).
  const handleShowLink = async (d: selfApi.KioskDevice) => {
    setMessage(null);
    try { setSetupLink(await selfApi.getKioskLink(businessId, d.id)); setShownFor(d.id); }
    catch (err) { fail(err, 'The kiosk link could not be shown.'); }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setMessage({ ok: true, text: 'Link copied.' }); }
    catch { setMessage({ ok: false, text: 'Copy did not work. Select the link and copy it by hand.' }); }
  };

  if (!businessId) return <p style={s.muted}>Select a business to set up a kiosk.</p>;

  return (
    <div style={s.section}>
      <h2 style={s.title}>Check-In Kiosk</h2>
      <p style={s.description}>
        A kiosk is a tablet at the front desk where customers check themselves in with the phone number or email
        address on their booking, then complete any forms they still owe. Register the tablet here, then open the
        link on it once. Customers can also check in from their own phone using the link in their reminder email.
      </p>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} style={{ color: message.ok ? 'var(--color-success)' : 'var(--color-error)', margin: '0 0 var(--space-md) 0' }}>
          {message.text}
        </p>
      )}

      <Card variant="outlined" padding="lg" title="Register a kiosk">
        <div style={s.row}>
          <input style={s.input} aria-label="Kiosk name" placeholder="Kiosk name, e.g. Front desk tablet" value={kioskName} onChange={(e) => setKioskName(e.target.value)} />
          <select style={s.input} aria-label="Location" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Choose a location…</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <Button size="sm" onClick={handleRegister} loading={busy}>Register</Button>
        </div>
      </Card>

      {setupLink && (
        <div role="status" style={s.linkBox}>
          <strong>
            {shownFor
              ? `Open this link on the tablet (${devices.find((d) => d.id === shownFor)?.device_name ?? 'kiosk'}).`
              : 'Open this link on the tablet now.'}
          </strong>{' '}
          It is the tablet's password, so share it only with the tablet. You can show it again from the list below.
          <input style={{ ...s.input, width: '100%', marginTop: 'var(--space-xs)' }} readOnly aria-label="Kiosk link" value={setupLink} onFocus={(e) => e.currentTarget.select()} />
          <div style={{ marginTop: 'var(--space-xs)', display: 'flex', gap: 'var(--space-sm)' }}>
            <Button size="sm" variant="secondary" onClick={() => copy(setupLink)}>Copy link</Button>
            <Button size="sm" variant="ghost" onClick={() => { setSetupLink(null); setShownFor(null); }}>Hide link</Button>
          </div>
        </div>
      )}

      <div style={{ height: 'var(--space-md)' }} />

      <Card variant="outlined" padding="lg" title="Registered kiosks">
        {devices.length === 0 && <p style={s.muted}>No kiosks yet.</p>}
        {devices.map((d) => (
          <div key={d.id} style={s.device}>
            <span>
              {d.device_name} <span style={s.muted}>· {d.location_name}</span>
              {d.last_activity_at && <span style={s.muted}> · last seen {new Date(d.last_activity_at).toLocaleString()}</span>}
            </span>
            <span style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', flexWrap: 'wrap' }}>
              <Badge variant={d.is_active ? 'success' : 'neutral'}>{d.is_active ? 'On' : 'Off'}</Badge>
              {d.is_active && <Button size="sm" variant="secondary" onClick={() => handleShowLink(d)}>Show link</Button>}
              {d.is_active
                ? <Button size="sm" variant="secondary" onClick={() => handleOff(d)}>Switch off</Button>
                : <Button size="sm" variant="secondary" onClick={() => handleOn(d)}>Switch on</Button>}
              <Button size="sm" variant="ghost" onClick={() => handleDelete(d)}>Delete</Button>
            </span>
          </div>
        ))}
      </Card>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  section: { maxWidth: '900px' },
  title: { margin: '0 0 var(--space-sm) 0', fontSize: 'var(--font-size-h2, 1.5rem)', fontWeight: 600, color: 'var(--color-text)' },
  description: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-lg) 0', lineHeight: 1.5, maxWidth: '640px' },
  muted: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
  row: { display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'center' },
  input: { padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', fontSize: 'var(--font-size-base)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', minWidth: '220px', boxSizing: 'border-box' },
  linkBox: { marginTop: 'var(--space-md)', padding: 'var(--space-md)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  device: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-md)', padding: 'var(--space-sm) 0', borderBottom: '1px solid var(--color-border)', flexWrap: 'wrap' },
};
