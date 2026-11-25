import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../design-system/components/icons/Icon';
import { getNotifications, markNotificationsRead } from '../api/inbox';
import type { StaffNotification } from '../api/inbox';
import { formatDateTime } from '../utils/format';

/**
 * The staff bell (THE-18): Inbox notifications as the business set them (Settings → Inbox) and as
 * each user allows. Refreshed every 30 seconds; opening a notification marks it read and goes to it.
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const { t } = useTranslation('nav');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<StaffNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  const load = () => getNotifications().then((r) => { setItems(r.notifications); setUnread(r.unread); }).catch(() => {});
  useEffect(() => { load(); const timer = setInterval(load, 30000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const go = async (n: StaffNotification) => {
    if (!n.read_at) { await markNotificationsRead([n.id]).catch(() => {}); load(); }
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="app-bell" ref={root}>
      <button type="button" className="app-topbar__icon-btn" aria-label={unread ? t('bell.label_unread', { count: unread }) : t('bell.label')} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="Bell" size="md" />
        {unread > 0 && <span className="app-bell__count" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="app-bell__panel" role="dialog" aria-label={t('bell.label')}>
          <div className="app-bell__head">
            <b>{t('bell.label')}</b>
            {unread > 0 && <button type="button" className="ibx-pill" onClick={() => markNotificationsRead().then(load)}>{t('bell.mark_all_read')}</button>}
          </div>
          {items.length === 0 ? <p className="app-bell__empty">{t('bell.empty')}</p> : items.map((n) => (
            <button key={n.id} type="button" className={`app-bell__item${n.read_at ? '' : ' is-unread'}`} onClick={() => go(n)}>
              <b>{n.title}</b>
              {n.body && <span>{n.body}</span>}
              <small>{formatDateTime(n.created_at, undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
