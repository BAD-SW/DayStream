import { useEffect, useMemo } from 'react';
import { Modal } from '../../design-system/components/feedback/Modal';

/**
 * Shows a form page (the one-use link of a device request) in a window over the current page, so
 * staff and customers fill it in without leaving where they are (spec 51, gap 3). The form page
 * runs in "embedded" mode and tells this window when it has been submitted.
 */
export const FORM_COMPLETE_MESSAGE = 'daystream:form-complete';

export function FormFillModal({ url, title, onClose, onDone }: {
  /** The form's address, as returned when the request was started. */
  url: string;
  title: string;
  /** Closed without finishing. */
  onClose: () => void;
  /** The form was submitted. */
  onDone: () => void;
}) {
  const src = useMemo(() => {
    const u = new URL(url, window.location.origin);
    u.searchParams.set('embedded', '1');
    return u.toString();
  }, [url]);

  useEffect(() => {
    const origin = new URL(src).origin;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin) return;
      if ((e.data as { type?: string } | null)?.type === FORM_COMPLETE_MESSAGE) onDone();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [src, onDone]);

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      <iframe
        title={title}
        src={src}
        style={{ width: '100%', height: '70vh', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)' }}
      />
    </Modal>
  );
}
