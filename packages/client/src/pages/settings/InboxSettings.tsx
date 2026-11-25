import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useDraft, draftBox, UnsavedTag, checkMark, fieldMark } from '../../components/unsaved/DraftSections';
import * as inboxApi from '../../api/inbox';
import type { InboxEvent, InboxRole, InboxRule } from '../../api/inbox';

/**
 * Settings → Inbox (THE-18, David 2026-11-04): which roles are told about each Inbox event and by
 * which channel (in-app bell, email), the hours after which an unanswered conversation is
 * reported, and each user's own "My notifications". Saved with the page's Save changes.
 */

// The words of each event and role are looked up by key (inbox.event.<key>, inbox.role.<key>) where they are shown.
const EVENTS: { key: InboxEvent }[] = [
  { key: 'new_unassigned' }, { key: 'assigned_message' }, { key: 'assigned_to_me' }, { key: 'mentioned' }, { key: 'unanswered' },
  { key: 'delivery_failed' }, { key: 'new_lead' }, { key: 'daily_summary' }, { key: 'customer_arrived' }, { key: 'low_stock' },
];
const ROLES: { key: InboxRole }[] = [
  { key: 'owner' }, { key: 'manager' }, { key: 'front_desk' }, { key: 'staff' },
];

type BizDraft = { events: Record<InboxEvent, InboxRule>; unanswered_hours: number };
type MineDraft = Partial<Record<InboxEvent, { in_app: boolean; email: boolean }>>;

export function InboxSettings() {
  const { t } = useTranslation('settings');
  const [settings, setSettings] = useState<inboxApi.InboxSettings | null>(null);
  const [failed, setFailed] = useState('');
  useEffect(() => { inboxApi.getSettings().then(setSettings).catch((e) => setFailed(e?.response?.data?.error || t('inbox.loadFailed'))); }, []);
  if (failed) return <p style={{ color: 'var(--color-text-secondary)' }}>{failed}</p>;
  if (!settings) return <p>{t('common:loading')}</p>;
  const canEdit = settings.role === 'owner' || settings.role === 'manager';
  return (
    <div style={{ display: 'grid', gap: 'var(--space-lg)' }}>
      <BusinessRules initial={settings} canEdit={canEdit} />
      <MyNotifications initial={settings} />
    </div>
  );
}

function BusinessRules({ initial, canEdit }: { initial: inboxApi.InboxSettings; canEdit: boolean }) {
  const { t } = useTranslation('settings');
  const draft = useDraft<BizDraft>('inbox-notifications', t('inbox.notificationsDraft'), { events: initial.events, unanswered_hours: initial.unanswered_hours }, async (d) => {
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
      <h3 style={{ margin: '0 0 4px', fontSize: 'var(--font-size-lg)' }}>{t('inbox.notifications')}<UnsavedTag dirty={draft.dirty} /></h3>
      <p style={{ margin: '0 0 var(--space-sm)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
        {t('inbox.notificationsIntro')}
        {!canEdit && ` ${t('inbox.ownersOnly')}`}
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)', minWidth: 720 }}>
          <thead><tr>
            <th style={{ ...cell, textAlign: 'left' }}>{t('inbox.when')}</th>
            {ROLES.map((r) => <th key={r.key} style={cell}>{t(`inbox.role.${r.key}`)}</th>)}
            <th style={cell}>{t('inbox.inApp')}</th><th style={cell}>{t('inbox.email')}</th>
          </tr></thead>
          <tbody>
            {EVENTS.map((ev) => {
              const rule = d.events[ev.key];
              return (
                <tr key={ev.key}>
                  <td style={{ ...cell, textAlign: 'left' }}>{t(`inbox.event.${ev.key}`)}</td>
                  {ROLES.map((r) => (
                    <td key={r.key} style={cell}>
                      <input type="checkbox" disabled={!canEdit} checked={rule.roles[r.key]} aria-label={t('inbox.cellRole', { event: t(`inbox.event.${ev.key}`), role: t(`inbox.role.${r.key}`) })}
                        onChange={(e) => setRule(ev.key, { role: [r.key, e.target.checked] })} style={checkMark(draft.changed((v) => v.events[ev.key].roles[r.key]))} />
                    </td>
                  ))}
                  <td style={cell}><input type="checkbox" disabled={!canEdit} checked={rule.in_app} aria-label={t('inbox.cellInApp', { event: t(`inbox.event.${ev.key}`) })} onChange={(e) => setRule(ev.key, { in_app: e.target.checked })} style={checkMark(draft.changed((v) => v.events[ev.key].in_app))} /></td>
                  <td style={cell}><input type="checkbox" disabled={!canEdit} checked={rule.email} aria-label={t('inbox.cellEmail', { event: t(`inbox.event.${ev.key}`) })} onChange={(e) => setRule(ev.key, { email: e.target.checked })} style={checkMark(draft.changed((v) => v.events[ev.key].email))} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'var(--space-sm)', fontSize: 'var(--font-size-sm)' }}>
        <Trans i18nKey="inbox.unansweredAfter" ns="settings" components={{
          hours: <input type="number" min={1} max={168} disabled={!canEdit} value={d.unanswered_hours} aria-label={t('inbox.hoursBeforeUnanswered')}
            onChange={(e) => draft.setValue({ ...d, unanswered_hours: Number(e.target.value) })}
            style={{ width: 70, padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-surface)', color: 'var(--color-text)', ...fieldMark(draft.changed((v) => v.unanswered_hours)) }} />,
        }} />
      </label>
    </section>
  );
}

function MyNotifications({ initial }: { initial: inboxApi.InboxSettings }) {
  const { t } = useTranslation('settings');
  const start: MineDraft = Object.fromEntries(EVENTS.map((e) => [e.key, initial.mine[e.key] || { in_app: true, email: true }]));
  const draft = useDraft<MineDraft>('inbox-mine', t('inbox.mineDraft'), start, async (m) => {
    const saved = await inboxApi.saveMyPrefs(m);
    return Object.fromEntries(EVENTS.map((e) => [e.key, saved[e.key] || { in_app: true, email: true }]));
  });
  const m = draft.value;
  // Only what the business sends to this person's role is listed.
  const mine = EVENTS.filter((e) => initial.events[e.key].roles[initial.role] && (initial.events[e.key].in_app || initial.events[e.key].email));
  return (
    <section style={draftBox(draft.dirty)}>
      <h3 style={{ margin: '0 0 4px', fontSize: 'var(--font-size-lg)' }}>{t('inbox.mine')}<UnsavedTag dirty={draft.dirty} /></h3>
      <p style={{ margin: '0 0 var(--space-sm)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>{t('inbox.mineIntro')}</p>
      {mine.length === 0 ? <p style={{ fontSize: 'var(--font-size-sm)' }}>{t('inbox.noneForRole')}</p> : (
        <div style={{ display: 'grid', gap: 6 }}>
          {mine.map((ev) => {
            const rule = initial.events[ev.key];
            const fixed = initial.always_in_app.includes(ev.key);
            const v = m[ev.key] || { in_app: true, email: true };
            return (
              <div key={ev.key} style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 'var(--font-size-sm)' }}>
                <span style={{ flex: '1 1 260px' }}>{t(`inbox.event.${ev.key}`)}</span>
                {rule.in_app && (
                  <label style={{ display: 'flex', gap: 4, alignItems: 'center' }} title={fixed ? t('inbox.alwaysInApp') : undefined}>
                    <input type="checkbox" checked={fixed || v.in_app} disabled={fixed} onChange={(e) => draft.setValue({ ...m, [ev.key]: { ...v, in_app: e.target.checked } })} /> {t('inbox.inApp')}
                  </label>
                )}
                {rule.email && (
                  <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input type="checkbox" checked={v.email} onChange={(e) => draft.setValue({ ...m, [ev.key]: { ...v, email: e.target.checked } })} /> {t('inbox.email')}
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
