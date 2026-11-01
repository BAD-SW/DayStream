import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../../design-system/components/feedback/ConfirmDialog';

/**
 * Asks "Leave without saving?" (Leave / Stay) while `when` is true, however the person leaves:
 * a link inside the app, the browser's Back button, or a button that navigates through
 * `useGuardedNavigate` / `confirmLeave` (e.g. "← Back to People", Sign out). Closing or
 * reloading the browser tab gets the browser's own warning. Render it once on a page that
 * has unsaved changes.
 */

// The page's guard while it has unsaved changes: asks, then runs `go` if the person leaves.
let askToLeave: ((go: () => void) => void) | null = null;

/** Runs `go` now, or after the person confirms leaving a page with unsaved changes. */
export function confirmLeave(go: () => void) {
  if (askToLeave) askToLeave(go); else go();
}

/** `navigate` that asks first when the page has unsaved changes. */
export function useGuardedNavigate() {
  const navigate = useNavigate();
  return (to: string) => confirmLeave(() => navigate(to));
}

const SENTINEL = { daystreamLeaveGuard: true };

export function LeaveGuard({ when }: { when: boolean }) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<(() => void) | null>(null);
  // The extra history entry that lets the Back button be caught; and whether we are leaving.
  const sentinel = useRef(false);
  const leaving = useRef(false);

  useEffect(() => {
    if (!when) {
      // Nothing unsaved any more: take our extra history entry back out, if it is on top.
      if (sentinel.current && (window.history.state as any)?.daystreamLeaveGuard) {
        sentinel.current = false;
        leaving.current = true;
        window.history.back();
        setTimeout(() => { leaving.current = false; }, 300);
      }
      return;
    }
    leaving.current = false;
    askToLeave = (go) => setPending(() => go);
    if (!sentinel.current) {
      window.history.pushState(SENTINEL, '', window.location.href);
      sentinel.current = true;
    }

    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const next = url.pathname + url.search + url.hash;
      if (next === window.location.pathname + window.location.search + window.location.hash) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(() => () => navigate(next));
    };
    // Back button: our extra entry was taken off, so the page has not changed yet. Ask; on
    // Stay put the entry back, on Leave go back one more step for real.
    const onPopState = () => {
      if (leaving.current || !sentinel.current) return;
      sentinel.current = false;
      setPending(() => () => { leaving.current = true; window.history.back(); });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      askToLeave = null;
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
    };
  }, [when, navigate]);

  const stay = () => {
    setPending(null);
    // The dialog closes after Leave too; then there is nothing to put back.
    if (leaving.current) return;
    if (when && !sentinel.current) {
      window.history.pushState(SENTINEL, '', window.location.href);
      sentinel.current = true;
    }
  };
  const leave = () => {
    const go = pending;
    setPending(null);
    askToLeave = null;
    leaving.current = true;
    go?.();
  };

  return (
    <ConfirmDialog
      open={pending !== null}
      onClose={stay}
      onConfirm={leave}
      title="Leave without saving?"
      message="You have unsaved changes on this page. If you leave now, they are lost."
      confirmLabel="Leave"
      cancelLabel="Stay"
    />
  );
}
