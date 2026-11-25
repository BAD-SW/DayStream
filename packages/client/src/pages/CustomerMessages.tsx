import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../design-system/components/actions/Button';
import { Alert } from '../design-system/components/feedback/Alert';
import { getMyMessages, sendMyMessage } from '../api/inbox';
import { formatDate } from '../utils/format';
import './Inbox.css';

/**
 * Messages (THE-18): a logged-in customer writes to the business and reads the answers (the
 * in-app channel). Their messages arrive in the business's Inbox.
 */
export function CustomerMessages() {
  const { t } = useTranslation('portal');
  const [msgs, setMsgs] = useState<Awaited<ReturnType<typeof getMyMessages>>>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const load = () => getMyMessages().then(setMsgs).catch(() => {});
  useEffect(() => { load(); const timer = setInterval(load, 20000); return () => clearInterval(timer); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);

  const send = async () => {
    setSending(true); setProblem('');
    try { await sendMyMessage(body); setBody(''); await load(); }
    catch (e: any) { setProblem(e?.response?.data?.error || t('messages.sendFailed')); }
    finally { setSending(false); }
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--space-md)', maxWidth: 720 }}>
      <h1 className="ibx-title">{t('messages.title')}</h1>
      <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>{t('messages.intro')}</p>
      <section className="ibx-thread" style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--card-radius)', background: 'var(--color-surface)', minHeight: 360 }}>
        <span />
        <div className="ibx-msgs">
          {msgs.length === 0 && <p className="ibx-empty">{t('messages.empty')}</p>}
          {msgs.map((m) => (
            <div key={m.id} className={m.direction === 'in' ? 'ibx-msg ibx-msg--out' : 'ibx-msg'}>
              <span className="ibx-msg__body">{m.body}</span>
              <small>{t('messages.meta', { sender: m.direction === 'in' ? t('messages.you') : m.sender_name || t('messages.team'), when: formatDate(m.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })}</small>
            </div>
          ))}
          <div ref={end} />
        </div>
        <div className="ibx-compose">
          <textarea className="ibx-input ibx-compose__box" rows={3} aria-label={t('messages.yourMessage')} placeholder={t('messages.placeholder')} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="ibx-compose__foot">
            {problem && <Alert variant="error">{problem}</Alert>}
            <span className="ibx-spacer" />
            <Button size="sm" onClick={send} loading={sending} disabled={!body.trim()}>{t('messages.send')}</Button>
          </div>
        </div>
      </section>
    </div>
  );
}
