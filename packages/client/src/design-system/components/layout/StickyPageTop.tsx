import { ReactNode } from 'react';

/**
 * Keeps a page's title row and tabs in view under the top bar while the page scrolls
 * (David, 2026-10-28). Put the PageHeader and the TabBar inside it.
 */
export function StickyPageTop({ children }: { children: ReactNode }) {
  return <div style={styles.top}>{children}</div>;
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
