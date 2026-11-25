import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { Button } from '../actions/Button';
import { subscribeDialogs } from './dialogs';
import type { DialogRequest } from './dialogs';

/**
 * Shows the application's dialogs (askConfirm, showMessage, askText in dialogs.ts), one at a time,
 * in place of the browser's alert, confirm and prompt (Phase 44, requirement 3.8). Mounted once at
 * the root of the app. Titles and buttons are translated; closing a dialog counts as cancelling.
 */
export function DialogHost() {
  const { t } = useTranslation('common');
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => subscribeDialogs((request) => setQueue((q) => [...q, request])), []);

  const current = queue[0];
  useEffect(() => {
    if (current?.kind === 'text') {
      setText(current.options.defaultValue ?? '');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [current]);

  if (!current) return null;
  const next = () => setQueue((q) => q.slice(1));

  if (current.kind === 'confirm') {
    const o = current.options;
    const done = (ok: boolean) => { current.resolve(ok); next(); };
    return (
      <Modal open onClose={() => done(false)} title={o.title ?? t('dialog.confirmTitle')} size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={() => done(false)}>{o.cancelLabel ?? t('cancel')}</Button>
            <Button variant={o.destructive ? 'destructive' : 'primary'} onClick={() => done(true)} autoFocus>
              {o.confirmLabel ?? t('confirm')}
            </Button>
          </>
        )}>
        <p style={styles.message}>{o.message}</p>
      </Modal>
    );
  }

  if (current.kind === 'message') {
    const o = current.options;
    const done = () => { current.resolve(); next(); };
    const title = o.title ?? (o.tone === 'error' ? t('dialog.errorTitle') : o.tone === 'success' ? t('dialog.successTitle') : t('dialog.noticeTitle'));
    return (
      <Modal open onClose={done} title={title} size="sm"
        footer={<Button onClick={done} autoFocus>{o.okLabel ?? t('dialog.ok')}</Button>}>
        <p style={{ ...styles.message, ...(o.tone === 'error' ? styles.error : {}) }} role={o.tone === 'error' ? 'alert' : 'status'}>{o.message}</p>
      </Modal>
    );
  }

  const o = current.options;
  const done = (value: string | null) => { current.resolve(value); next(); };
  const label = o.label ?? o.message;
  return (
    <Modal open onClose={() => done(null)} title={o.title ?? t('dialog.textTitle')} size="sm"
      footer={(
        <>
          <Button variant="ghost" onClick={() => done(null)}>{o.cancelLabel ?? t('cancel')}</Button>
          <Button onClick={() => done(text)}>{o.confirmLabel ?? t('dialog.ok')}</Button>
        </>
      )}>
      <form onSubmit={(e) => { e.preventDefault(); done(text); }}>
        {o.label && <p style={styles.message}>{o.message}</p>}
        <label htmlFor="dialog-text" style={styles.label}>{label}</label>
        {o.multiline ? (
          <textarea id="dialog-text" ref={inputRef} style={{ ...styles.input, minHeight: '96px' }} value={text}
            placeholder={o.placeholder} onChange={(e) => setText(e.target.value)} />
        ) : (
          <input id="dialog-text" ref={inputRef} style={styles.input} value={text}
            placeholder={o.placeholder} onChange={(e) => setText(e.target.value)} />
        )}
      </form>
    </Modal>
  );
}

const styles: Record<string, React.CSSProperties> = {
  message: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-sm) 0', lineHeight: 1.5, whiteSpace: 'pre-line' },
  error: { color: 'var(--color-error)' },
  label: { display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', marginBottom: 'var(--space-xs)' },
  input: {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md, 8px)', fontSize: 'var(--font-size-base)', background: 'var(--color-surface)',
    color: 'var(--color-text)', fontFamily: 'var(--font-family)',
  },
};
