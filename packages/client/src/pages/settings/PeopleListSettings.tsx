import { useEffect, useState } from 'react';
import { Button } from '../../design-system/components/actions/Button';
import { useDraft, draftBox, UnsavedTag } from '../../components/unsaved/DraftSections';
import { getColumnOrder, saveColumnOrder } from '../../api/inbox';
import { ORDERABLE_COLUMNS, DEFAULT_ORDER, fullOrder, forgetColumnOrder } from '../../utils/peopleColumns';

/**
 * Settings → People lists (THE-18, David 2026-11-04): one column order for the business, applied
 * to People and Leads. The selection box, the name and the actions stay fixed. Saved with the
 * page's Save changes.
 */
export function PeopleListSettings() {
  const [loaded, setLoaded] = useState(false);
  const draft = useDraft<string[]>('people-columns', 'People lists › Column order', DEFAULT_ORDER, async (order) => {
    const saved = await saveColumnOrder(order);
    forgetColumnOrder();
    return fullOrder(saved);
  });
  useEffect(() => { getColumnOrder().then((o) => { draft.load(fullOrder(o)); setLoaded(true); }).catch(() => setLoaded(true)); }, [draft.load]); // eslint-disable-line react-hooks/exhaustive-deps

  const order = draft.value;
  const move = (i: number, by: number) => {
    const j = i + by; if (j < 0 || j >= order.length) return;
    const next = [...order]; [next[i], next[j]] = [next[j], next[i]];
    draft.setValue(next);
  };
  const label = (k: string) => ORDERABLE_COLUMNS.find((c) => c.key === k);

  return (
    <div style={{ display: 'grid', gap: 'var(--space-md)', maxWidth: 680 }}>
      <div>
        <h3 style={{ margin: '0 0 4px', fontSize: 'var(--font-size-lg)' }}>Column order<UnsavedTag dirty={draft.dirty} /></h3>
        <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
          One order for the whole business, used by People and Leads (each list shows only its own columns, in this order).
          The selection box and the name always come first, and the action buttons last. Each user can still hide columns on People.
        </p>
      </div>
      {loaded && (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, ...draftBox(draft.dirty) }} aria-label="Column order">
          <li style={row(true)}><span>Selection box · Name</span><small>Fixed, first</small></li>
          {order.map((k, i) => (
            <li key={k} style={row(false, draft.changed((v) => v[i]))}>
              <span style={{ display: 'grid' }}><b style={{ fontWeight: 600 }}>{label(k)?.label || k}</b><small style={{ color: 'var(--color-text-secondary)' }}>{label(k)?.lists}</small></span>
              <span style={{ display: 'flex', gap: 4 }}>
                <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${label(k)?.label} up`}>↑</Button>
                <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Move ${label(k)?.label} down`}>↓</Button>
              </span>
            </li>
          ))}
          <li style={row(true)}><span>Actions (Edit, Archive…)</span><small>Fixed, last</small></li>
        </ol>
      )}
      <div><Button size="sm" variant="ghost" onClick={() => draft.setValue(DEFAULT_ORDER)}>Back to the default order</Button></div>
    </div>
  );
}

const row = (fixed: boolean, changed?: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px',
  border: `1px solid ${changed ? 'var(--color-warning-dark)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-md)',
  background: fixed ? 'var(--color-background)' : 'var(--color-surface)', color: fixed ? 'var(--color-text-secondary)' : 'var(--color-text)', fontSize: 'var(--font-size-sm)',
});
