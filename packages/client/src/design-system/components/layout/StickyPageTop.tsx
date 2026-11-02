import { ReactNode, useEffect, useRef } from 'react';

/**
 * Keeps a page's title row and tabs in view under the top bar while the page scrolls
 * (David, 2026-10-28). Put the PageHeader and the TabBar inside it. Its height is published as
 * --page-top-h so table headers pin just below it (David, 2026-11-02).
 */
export function StickyPageTop({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--page-top-h', `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty('--page-top-h'); };
  }, []);
  return <div ref={ref} style={styles.top}>{children}</div>;
}

const styles: Record<string, React.CSSProperties> = {
  top: {
    position: 'sticky',
    top: 'var(--app-topbar-height, 76px)',
    zIndex: 50,
    background: 'var(--color-background)',
    // Reaches a little past the content on both sides so highlights of the content
    // scrolling underneath stay hidden.
    margin: '0 -12px',
    padding: 'var(--space-sm) 12px 0',
  },
};
