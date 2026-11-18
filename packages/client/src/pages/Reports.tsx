import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '../context/AuthContext';
import { getPermissionsFromRole } from '../context/ContextManager';
import { REPORT_CATALOG, ReportCatalogEntry, ReportCategory } from './reports/reportCatalog';
import { getPreference, setPreference } from '../api/preferences';

function matchPermission(userPerm: string, required: string): boolean {
  if (userPerm === '*:*') return true;
  if (userPerm === required) return true;
  const [ur, ua] = userPerm.split(':');
  const [rr] = required.split(':');
  return ur === rr && ua === '*';
}

const ORDER_KEY = 'reports.category_order';

/** The catalog in the person's saved order; a category not in it (new since) keeps its catalog place at the end. */
function ordered(saved: string[] | null): ReportCategory[] {
  if (!saved?.length) return REPORT_CATALOG;
  const byId = new Map(REPORT_CATALOG.map((c) => [c.id, c]));
  const first = saved.map((id) => byId.get(id)).filter((c): c is ReportCategory => !!c);
  return [...first, ...REPORT_CATALOG.filter((c) => !saved.includes(c.id))];
}

/**
 * Reports & Analytics. Each person can put the categories in their own order by dragging a
 * category by its handle (or with the keyboard: focus the handle, Space, arrow keys, Space); the
 * order is saved to their profile and used every time (owner, 19 Nov 2026).
 */
export function Reports() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const permissions = getPermissionsFromRole(user?.role || '');
  const [savedOrder, setSavedOrder] = useState<string[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    getPreference<string[]>(ORDER_KEY).then(setSavedOrder).catch(() => setSavedOrder(null));
  }, []);

  function canView(entry: ReportCatalogEntry): boolean {
    const required = entry.permission || 'reports:read';
    return permissions.some((p) => matchPermission(p, required));
  }

  const categories = useMemo(
    () => ordered(savedOrder).map((c) => ({ ...c, reports: c.reports.filter(canView) })).filter((c) => c.reports.length > 0),
    [savedOrder, user?.role], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const sensors = useSensors(
    // A small move starts a drag, so a click on the handle does nothing by mistake.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const save = (order: string[] | null) => {
    const before = savedOrder;
    setSavedOrder(order);
    setNote(null);
    setPreference(ORDER_KEY, order).catch(() => { setSavedOrder(before); setNote('Could not save the order. Try again.'); });
  };

  function handleDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    // The whole catalog order is saved, including categories this person cannot see.
    const all = ordered(savedOrder).map((c) => c.id);
    save(arrayMove(all, all.indexOf(String(e.active.id)), all.indexOf(String(e.over.id))));
  }

  return (
    <div style={styles.page}>
      <div style={styles.titleRow}>
        <div>
          <h1 style={styles.pageTitle}>Reports &amp; Analytics</h1>
          <p style={styles.pageSubtitle}>Run detailed reports over any date range, filter on screen, and save as PDF or CSV. Drag a category by its handle to put them in your own order.</p>
        </div>
        {savedOrder && <button type="button" style={styles.resetBtn} onClick={() => save(null)}>Reset order</button>}
      </div>
      {note && <p role="alert" style={styles.note}>{note}</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div style={styles.categories}>
            {categories.map((category) => (
              <SortableCategory key={category.id} category={category} onOpen={(id) => navigate(`/reports/run/${id}`)} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableCategory({ category, onOpen }: { category: ReportCategory; onOpen: (reportId: string) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: category.id });
  return (
    <section
      ref={setNodeRef}
      style={{
        ...styles.category,
        ['--group-accent' as string]: category.accentColor,
        transform: CSS.Transform.toString(transform),
        transition,
        ...(isDragging ? styles.categoryDragging : {}),
      }}
    >
      <div style={styles.categoryHeader}>
        <button
          type="button"
          ref={setActivatorNodeRef}
          style={{ ...styles.handle, cursor: isDragging ? 'grabbing' : 'grab' }}
          aria-label={`Move ${category.label}`}
          title="Drag to move this category"
          {...attributes}
          {...listeners}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="currentColor">
            <circle cx="4" cy="3" r="1.3" /><circle cx="10" cy="3" r="1.3" />
            <circle cx="4" cy="7" r="1.3" /><circle cx="10" cy="7" r="1.3" />
            <circle cx="4" cy="11" r="1.3" /><circle cx="10" cy="11" r="1.3" />
          </svg>
        </button>
        <span style={{ ...styles.accentBar, background: category.accentColor }} aria-hidden="true" />
        <h2 style={styles.categoryLabel}>{category.label}</h2>
      </div>
      <div style={styles.tileGrid}>
        {category.reports.map((report) => (
          <button
            key={report.id}
            type="button"
            disabled={report.comingSoon}
            aria-disabled={report.comingSoon}
            style={{ ...styles.tile, ...(report.comingSoon ? styles.tileDisabled : {}) }}
            onClick={report.comingSoon ? undefined : () => onOpen(report.id)}
          >
            <span style={styles.tileIcon} aria-hidden="true">{report.icon}</span>
            <span style={styles.tileTitle}>{report.title}</span>
            <span style={styles.tileDescription}>{report.description}</span>
            {report.comingSoon && <span style={styles.comingSoonBadge}>Coming soon</span>}
          </button>
        ))}
      </div>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)' },
  titleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-md)' },
  pageTitle: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as React.CSSProperties['fontWeight'], color: 'var(--color-text)', margin: 0 },
  pageSubtitle: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: '4px 0 var(--space-lg)' },
  resetBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--button-radius)', padding: 'var(--space-xs) var(--space-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-family)', minHeight: 'var(--button-height-sm)', whiteSpace: 'nowrap' },
  note: { color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-md)' },
  categories: { display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' },
  category: {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderLeft: '4px solid var(--group-accent, var(--color-primary))',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-md)',
    position: 'relative',
  },
  categoryDragging: { zIndex: 2, boxShadow: 'var(--shadow-lg)', background: 'var(--color-surface-modal, var(--color-surface))' },
  categoryHeader: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' },
  handle: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 'var(--button-height-sm)', height: 'var(--button-height-sm)', marginLeft: 'calc(var(--space-xs) * -1)', background: 'none', border: '1px solid transparent', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-secondary)', touchAction: 'none' },
  accentBar: { width: '10px', height: '10px', borderRadius: '3px', display: 'inline-block' },
  categoryLabel: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as React.CSSProperties['fontWeight'], color: 'var(--color-text)', margin: 0 },
  tileGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--space-md)' },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    textAlign: 'left',
    padding: 'var(--space-md)',
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    fontFamily: 'var(--font-family)',
    transition: 'border-color var(--duration-fast) var(--ease-default)',
  },
  tileDisabled: {
    cursor: 'default',
    opacity: 0.55,
    background: 'var(--color-surface-hover)',
    borderStyle: 'dashed',
  },
  tileIcon: { fontSize: 'var(--font-size-2xl)' },
  tileTitle: { fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-bold)' as React.CSSProperties['fontWeight'], color: 'var(--color-text)' },
  tileDescription: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  comingSoonBadge: {
    marginTop: '6px',
    alignSelf: 'flex-start',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-bold)' as React.CSSProperties['fontWeight'],
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--color-text-secondary)',
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '2px 6px',
  },
};
