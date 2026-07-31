import { Fragment } from 'react';
import { useContextManager } from '../context/ContextManager';
import { formatBreadcrumb, truncateSegment } from '../utils/breadcrumb';
import './ContextSwitcher.css';

export function ContextBreadcrumb() {
  const { activeContext, persona } = useContextManager();
  const segments = formatBreadcrumb(activeContext, persona);

  return (
    <nav className="context-breadcrumb" aria-label="Context hierarchy">
      <ol className="context-breadcrumb__list">
        {segments.map((segment, i) => {
          const { label, truncated } = truncateSegment(segment);
          return (
            <Fragment key={`${segment}-${i}`}>
              {i > 0 && (
                <li className="context-breadcrumb__item context-breadcrumb__item--separator" aria-hidden="true">
                  &rsaquo;
                </li>
              )}
              <li className="context-breadcrumb__item">
                <span className="context-breadcrumb__segment" title={truncated ? segment : undefined}>
                  {label}
                </span>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
