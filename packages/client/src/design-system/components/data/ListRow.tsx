import { ReactNode } from 'react';
import './ListRow.css';

interface ListRowProps {
  /** Main content on the left (name, meta text, tags). */
  children: ReactNode;
  /** Right-aligned content (buttons, badges). Clicks here don't trigger onClick. */
  actions?: ReactNode;
  onClick?: () => void;
}

/**
 * A bordered, full-width row for simple lists (campaigns, pages, events…) — THE-15.
 * Clickable when onClick is given (keyboard: Enter / Space).
 */
export function ListRow({ children, actions, onClick }: ListRowProps) {
  const interactive = !!onClick;
  return (
    <div
      className={`ds-list-row${interactive ? ' ds-list-row--interactive' : ''}`}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick!(); } } : undefined}
    >
      <div className="ds-list-row__main">{children}</div>
      {actions && (
        <div className="ds-list-row__actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}

/** Vertical stack of ListRows (and anything nested under them). */
export function ListRows({ children }: { children: ReactNode }) {
  return <div className="ds-list-rows">{children}</div>;
}

/** Secondary text next to a row's name (e.g. channel, slug). */
export function ListRowMeta({ children }: { children: ReactNode }) {
  return <span className="ds-list-row__meta">{children}</span>;
}

/** Bold row title. */
export function ListRowTitle({ children }: { children: ReactNode }) {
  return <span className="ds-list-row__title">{children}</span>;
}

/** Plain "nothing here yet" line for a list. */
export function ListEmpty({ children }: { children: ReactNode }) {
  return <p className="ds-list-empty">{children}</p>;
}
