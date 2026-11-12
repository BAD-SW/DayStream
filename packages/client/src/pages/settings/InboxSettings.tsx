import { useEffect, useState } from 'react';
import { useDraft, draftBox, UnsavedTag, checkMark, fieldMark } from '../../components/unsaved/DraftSections';
import * as inboxApi from '../../api/inbox';
import type { InboxEvent, InboxRole, InboxRule } from '../../api/inbox';

/**
 * Settings → Inbox (THE-18, David 2026-11-04): which roles are told about each Inbox event and by
 * which channel (in-app bell, email), the hours after which an unanswered conversation is
 * reported, and each user's own "My notifications". Saved with the page's Save changes.
 */

const EVENTS: { key: InboxEvent; label: string }[] = [
  { key: 'new_unassigned', label: 'New conversation, nobody assigned' },
  { key: 'assigned_message', label: 'New message in a conversation assigned to me' },
  { key: 'assigned_to_me', label: 'A conversation is assigned to me' },
  { key: 'mentioned', label: 'I am @mentioned in an internal note' },
  { key: 'unanswered', label: 'Unanswered for more than the hours below' },
  { key: 'delivery_failed', label: 'A message to a customer could not be delivered' },
  { key: 'new_lead', label: 'Message from a new lead' },
  { key: 'daily_summary', label: 'Daily summary (08:00 business time)' },
  { key: 'customer_arrived', label: 'A customer has checked in (the booked practitioner is always told)' },
];
const ROLES: { key: InboxRole; label: string }[] = [
  { key: 'owner', label: 'Owner' }, { key: 'manager', label: 'Manager' }, { key: 'front_desk', label: 'Front desk' }, { key: 'staff', label: 'Staff' },
];

type BizDraft = { events: Record<InboxEvent, InboxRule>; unanswered_hours: number };
type MineDraft = Partial<Record<InboxEvent, { in_app: boolean; email: boolean }>>;

export function InboxSettings() {
  const [settings, setSettings] = useState<inboxApi.InboxSettings | null>(null);
  const [failed, setFailed] = useState('');
  useEffect(() => { inboxApi.getSettings().then(setSettings).catch((e) => setFailed(e?.response?.data?.error || 'The Inbox settings could not be loaded.')); }, []);
  if (failed) return <p style={{ color: 'var(--color-text-secondary)' }}>{failed}</p>;
  if (!settings) return <p>Loading…</p>;
  const canEdit = settings.role === 'owner' || settings.role === 'manager';
  return (
    <div style={{ display: 'grid', gap: 'var(--space-lg)' }}>
      <BusinessRules initial={settings} canEdit={canEdit} />
      <MyNotifications initial={settings} />
    </div>
  );
}

function BusinessRules({ initial, canEdit }: { initial: inboxApi.InboxSettings; canEdit: boolean }) {
  const draft = useDraft<BizDraft>('inbox-notifications', 'Inbox › Notifications', { events: initial.events, unanswered_hours: initial.unanswered_hours }, async (d) => {
    const saved = await inboxApi.saveSettings(d);
    return { events: saved.events, unanswered_hours: saved.unanswered_hours };
  });
  const d = draft.value;
  const setRule = (e: InboxEvent, patch: Partial<InboxRule> & { role?: [InboxRole, boolean] }) => {
    const rule = d.events[e];
    const roles = patch.role ? { ...rule.roles, [patch.role[0]]: patch.role[1] } : rule.roles;
    draft.setValue({ ...d, events: { ...d.events, [e]: { ...rule, ...patch, roles, role: undefined } as InboxRule } });
  };
  const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--color-border)', textAlign: 'center' };
  return (
    <section style={draftBox(draft.dirty)}>
      <h3 style={{ margin: '0 0 4px', fontSize: 'var(--font-size-lg)' }}>Notifications<UnsavedTag dirty={draft.dirty} /></h3>
      <p style={{ margin: '0 0 var(--space-sm)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
        Who is told about each Inbox event, and how. Each person can switch off what they don't want under My notifications (except assignments and mentions in-app).
        {!canEdit && ' Only owners and managers can change this.'}
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)', minWidth: 720 }}>
          <thead><tr>
            <th style={{ ...cell, textAlign: 'left' }}>When</th>
            {ROLES.map((r) => <th key={r.key} style={cell}>{r.label}</th>)}
            <th style={cell}>In-app</th><th style={cell}>Email</th>
          </tr></thead>
          <tbody>
            {EVENTS.map((ev) => {
              const rule = d.events[ev.key];
              return (
                <tr key={ev.key}>
                  <td style={{ ...cell, textAlign: 'left' }}>{ev.label}</td>
                  {ROLES.map((r) => (
                    <td key={r.key} style={cell}>
                      <input type="checkbox" disabled={!canEdit} checked={rule.roles[r.key]} aria-label={`${ev.label}: ${r.label}`}
                        onChange={(e) => setRule(ev.key, { role: [r.key, e.target.checked] })} style={checkMark(draft.changed((v) => v.events[ev.key].roles[r.key]))} />
                    </td>
                  ))}
                  <td style={cell}><input type="checkbox" disabled={!canEdit} checked={rule.in_app} aria-label={`${ev.label}: in-app`} onChange={(e) => setRule(ev.key, { in_app: e.target.checked })} style={checkMark(draft.changed((v) => v.events[ev.key].in_app))} /></td>
                  <td style={cell}><input type="checkbox" disabled={!canEdit} checked={rule.email} aria-label={`${ev.label}: email`} onChange={(e) => setRule(ev.key, { email: e.target.checked })} style={checkMark(draft.changed((v) => v.events[ev.key].email))} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'var(--space-sm)', fontSize: 'var(--font-size-sm)' }}>
        Report a conversation as unanswered after
        <input type="number" min={1} max={168} disabled={!canEdit} value={d.unanswered_hours} aria-label="Hours before unanswered"
          onChange={(e) => draft.setValue({ ...d, unanswered_hours: Number(e.target.value) })}
          style={{ width: 70, padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-surface)', color: 'var(--color-text)', ...fieldMark(draft.changed((v) => v.unanswered_hours)) }} />
        hours
      </label>
    </section>
  );
}

function MyNotifications({ initial }: { initial: inboxApi.InboxSettings }) {
  const start: MineDraft = Object.fromEntries(EVENTS.map((e) => [e.key, initial.mine[e.key] || { in_app: true, email: true }]));
  const draft = useDraft<MineDraft>('inbox-mine', 'Inbox › My notifications', start, async (m) => {
    const saved = await inboxApi.saveMyPrefs(m);
    return Object.fromEntries(EVENTS.map((e) => [e.key, saved[e.key] || { in_app: true, email: true }]));
  });
  const m = draft.value;
  // Only what the business sends to this person's role is listed.
  const mine = EVENTS.filter((e) => initial.events[e.key].roles[initial.role] && (initial.events[e.key].in_app || initial.events[e.key].email));
  return (
    <section style={draftBox(draft.dirty)}>
      <h3 style={{ margin: '0 0 4px', fontSize: 'var(--font-size-lg)' }}>My notifications<UnsavedTag dirty={draft.dirty} /></h3>
      <p style={{ margin: '0 0 var(--space-sm)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>What you receive, as the business set it for your role. Untick what you don't want.</p>
      {mine.length === 0 ? <p style={{ fontSize: 'var(--font-size-sm)' }}>Your role receives no Inbox notifications.</p> : (
        <div style={{ display: 'grid', gap: 6 }}>
          {mine.map((ev) => {
            const rule = initial.events[ev.key];
            const fixed = initial.always_in_app.includes(ev.key);
            const v = m[ev.key] || { in_app: true, email: true };
            return (
              <div key={ev.key} style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 'var(--font-size-sm)' }}>
                <span style={{ flex: '1 1 260px' }}>{ev.label}</span>
                {rule.in_app && (
                  <label style={{ display: 'flex', gap: 4, alignItems: 'center' }} title={fixed ? 'Always shown in the app' : undefined}>
                    <input type="checkbox" checked={fixed || v.in_app} disabled={fixed} onChange={(e) => draft.setValue({ ...m, [ev.key]: { ...v, in_app: e.target.checked } })} /> In-app
                  </label>
                )}
                {rule.email && (
                  <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input type="checkbox" checked={v.email} onChange={(e) => draft.setValue({ ...m, [ev.key]: { ...v, email: e.target.checked } })} /> Email
                  </label>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
