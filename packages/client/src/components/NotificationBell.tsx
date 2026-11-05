import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../design-system/components/icons/Icon';
import { getNotifications, markNotificationsRead } from '../api/inbox';
import type { StaffNotification } from '../api/inbox';

/**
 * The staff bell (THE-18): Inbox notifications as the business set them (Settings → Inbox) and as
 * each user allows. Refreshed every 30 seconds; opening a notification marks it read and goes to it.
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<StaffNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  const load = () => getNotifications().then((r) => { setItems(r.notifications); setUnread(r.unread); }).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);
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
      <button type="button" className="app-topbar__icon-btn" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="Bell" size="md" />
        {unread > 0 && <span className="app-bell__count" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="app-bell__panel" role="dialog" aria-label="Notifications">
          <div className="app-bell__head">
            <b>Notifications</b>
            {unread > 0 && <button type="button" className="ibx-pill" onClick={() => markNotificationsRead().then(load)}>Mark all read</button>}
          </div>
          {items.length === 0 ? <p className="app-bell__empty">Nothing new.</p> : items.map((n) => (
            <button key={n.id} type="button" className={`app-bell__item${n.read_at ? '' : ' is-unread'}`} onClick={() => go(n)}>
              <b>{n.title}</b>
              {n.body && <span>{n.body}</span>}
              <small>{new Date(n.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
