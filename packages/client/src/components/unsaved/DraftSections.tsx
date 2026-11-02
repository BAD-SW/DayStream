import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * One Save for a whole page (David, 2026-10-28): each section of the page keeps its own
 * edits as a draft and registers here whether it has unsaved changes and how to save
 * them. The page shows one Save button, marks the tabs and sections with unsaved
 * changes, and asks before leaving with unsaved changes (see LeaveGuard).
 */

interface SectionEntry {
  id: string;
  tab: string;
  label: string;
  dirty: boolean;
  save: () => Promise<void>;
}

interface DraftContextValue {
  register: (entry: SectionEntry) => void;
  unregister: (id: string) => void;
  dirtySections: SectionEntry[];
  saveAll: () => Promise<{ failed: { label: string; error: string }[] }>;
  saving: boolean;
}

const DraftContext = createContext<DraftContextValue | null>(null);
const TabContext = createContext<string>('');

export function DraftSectionsProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, SectionEntry>());
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);

  const register = useCallback((entry: SectionEntry) => {
    const before = entries.current.get(entry.id);
    entries.current.set(entry.id, entry);
    if (!before || before.dirty !== entry.dirty || before.label !== entry.label) setVersion((v) => v + 1);
  }, []);
  const unregister = useCallback((id: string) => {
    if (entries.current.delete(id)) setVersion((v) => v + 1);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dirtySections = useMemo(() => [...entries.current.values()].filter((e) => e.dirty), [version]);

  const saveAll = useCallback(async () => {
    setSaving(true);
    const failed: { label: string; error: string }[] = [];
    try {
      for (const e of [...entries.current.values()].filter((x) => x.dirty)) {
        try { await e.save(); }
        catch (err: any) { failed.push({ label: e.label, error: err?.response?.data?.error || err?.message || 'Not saved' }); }
      }
    } finally { setSaving(false); }
    return { failed };
  }, []);

  const value = useMemo(() => ({ register, unregister, dirtySections, saveAll, saving }), [register, unregister, dirtySections, saveAll, saving]);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useDraftSections() {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error('useDraftSections needs a DraftSectionsProvider');
  return ctx;
}

/** Marks the sections inside it as belonging to one tab of the page. */
export function DraftTab({ tab, children }: { tab: string; children: ReactNode }) {
  return <TabContext.Provider value={tab}>{children}</TabContext.Provider>;
}

/**
 * A section's draft: `value` is what is on screen, `saved` what is stored. `dirty` is
 * true while they differ. Call `load` with the stored value once it is fetched, and
 * pass `persist` (stores the value; may return the stored result) to register the
 * section with the page's Save.
 */
export function useDraft<T>(id: string, label: string, initial: T, persist: (value: T) => Promise<T | void>, options?: { tab?: string }) {
  const ctx = useContext(DraftContext);
  const tabFromContext = useContext(TabContext);
  // The tab can be named here when the section is not inside a DraftTab (e.g. forms of one component).
  const tab = options?.tab ?? tabFromContext;
  const [value, setValue] = useState<T>(initial);
  const [saved, setSaved] = useState<T>(initial);
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  const latest = useRef({ value, persist });
  latest.current = { value, persist };

  const load = useCallback((v: T) => { setValue(v); setSaved(v); }, []);
  /** After a save that went only part of the way: what is stored now, and what is still on screen. */
  const rebase = useCallback((storedNow: T, onScreen: T) => { setSaved(storedNow); setValue(onScreen); }, []);
  /** Whether one part of the value differs from what is stored (to mark that field). */
  const changed = (pick: (v: T) => unknown) => JSON.stringify(pick(value)) !== JSON.stringify(pick(saved));
  const save = useCallback(async () => {
    const out = await latest.current.persist(latest.current.value);
    const stored = (out === undefined ? latest.current.value : out) as T;
    setSaved(stored);
    setValue(stored);
  }, []);

  useEffect(() => {
    ctx?.register({ id, tab, label, dirty, save });
  }, [ctx, id, tab, label, dirty, save]);
  useEffect(() => () => ctx?.unregister(id), [ctx, id]);

  return { value, setValue, dirty, load, rebase, changed, saved, save };
}

/** One row of a list kept as a draft: added on screen (`isNew`), or deleted until the page is saved. */
export interface DraftRow<T> { key: string; item: T; isNew?: boolean; deleted?: boolean }

let draftRowKey = 0;
const toRows = <T extends { id?: string }>(items: T[]): DraftRow<T>[] => items.map((item) => ({ key: String(item.id), item }));

/**
 * A list whose additions, edits and deletions wait for the page's Save (lead stages set the
 * pattern: new rows are marked "New", edited fields are marked, deleted rows stay crossed out
 * with Undo). `ops` stores one change each; deletions go first, then additions, then edits.
 * If a change fails, what went through is kept and the rest stays on screen as unsaved.
 */
export function useDraftList<T extends { id?: string }>(
  id: string,
  label: string,
  ops: { create?: (item: T) => Promise<T>; update?: (item: T, before: T) => Promise<T>; remove?: (item: T) => Promise<void> },
) {
  const draft = useDraft<DraftRow<T>[]>(id, label, [], async (rows) => {
    const stored = [...draft.saved];
    let onScreen = rows;
    try {
      for (const r of rows.filter((x) => x.deleted && !x.isNew)) {
        await ops.remove!(r.item);
        const i = stored.findIndex((s) => s.key === r.key); if (i >= 0) stored.splice(i, 1);
        onScreen = onScreen.filter((x) => x.key !== r.key);
      }
      for (const r of rows.filter((x) => x.isNew && !x.deleted)) {
        const created = await ops.create!(r.item);
        const row = { key: String(created.id), item: created };
        stored.push(row);
        onScreen = onScreen.map((x) => (x.key === r.key ? row : x));
      }
      for (const r of rows.filter((x) => !x.isNew && !x.deleted)) {
        const before = draft.saved.find((s) => s.key === r.key);
        if (!before || JSON.stringify(before.item) === JSON.stringify(r.item)) continue;
        const updated = await ops.update!(r.item, before.item);
        const row = { key: r.key, item: { ...r.item, ...updated } };
        stored.splice(stored.findIndex((s) => s.key === r.key), 1, row);
        onScreen = onScreen.map((x) => (x.key === r.key ? row : x));
      }
    } catch (err) {
      draft.rebase(stored, onScreen.filter((x) => !(x.isNew && x.deleted)));
      throw err;
    }
    return onScreen.filter((x) => !x.deleted);
  });
  const rows = draft.value;
  const load = useCallback((items: T[]) => draft.load(toRows(items)), [draft.load]);
  const add = (item: T) => { draftRowKey += 1; draft.setValue([...rows, { key: `new-${draftRowKey}`, item, isNew: true }]); };
  const edit = (key: string, patch: Partial<T>) => draft.setValue(rows.map((r) => (r.key === key ? { ...r, item: { ...r.item, ...patch } } : r)));
  // A row added on screen just goes; a stored one is crossed out until the page is saved.
  const remove = (key: string) => draft.setValue(rows.flatMap((r) => (r.key !== key ? [r] : r.isNew ? [] : [{ ...r, deleted: true }])));
  const undo = (key: string) => draft.setValue(rows.map((r) => (r.key === key ? { ...r, deleted: false } : r)));
  /** Whether one field of a stored row differs from what is stored. */
  const changed = (row: DraftRow<T>, pick: (item: T) => unknown) => {
    const before = draft.saved.find((s) => s.key === row.key);
    return !!before && JSON.stringify(pick(before.item)) !== JSON.stringify(pick(row.item));
  };
  return { rows, load, add, edit, remove, undo, changed, dirty: draft.dirty };
}

/** Mark on a changed text field, number, date, time or select. */
export function fieldMark(changed: boolean): React.CSSProperties {
  return changed ? { outline: '2px solid var(--color-warning)', outlineOffset: '1px', background: 'var(--color-warning-bg)' } : {};
}

/** Mark on a changed checkbox or radio button (on a radio group: the newly chosen one). */
export function checkMark(changed: boolean): React.CSSProperties {
  return changed ? { outline: '2px solid var(--color-warning)', outlineOffset: '2px' } : {};
}

/** Mark on the track of a changed on/off switch. */
export function toggleMark(changed: boolean): React.CSSProperties {
  return changed ? { boxShadow: '0 0 0 3px var(--color-warning)' } : {};
}

/** Highlight for a section with unsaved changes. */
export function draftBox(dirty: boolean): React.CSSProperties {
  return dirty
    ? { outline: '2px solid var(--color-warning)', outlineOffset: '4px', borderRadius: 'var(--radius-lg)' }
    : {};
}

/** Small label on a list row: "New", "Moved", "Deleted when you save". */
export function RowTag({ children }: { children: ReactNode }) {
  return (
    <span style={{ padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--color-warning-bg)', color: 'var(--color-warning-dark)', fontSize: 'var(--font-size-xs)', fontWeight: 600, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

export function UnsavedTag({ dirty }: { dirty: boolean }) {
  if (!dirty) return null;
  return (
    <span style={{ display: 'inline-block', marginLeft: '8px', padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--color-warning-bg)', color: 'var(--color-warning-dark)', fontSize: 'var(--font-size-xs)', fontWeight: 600, verticalAlign: 'middle' }}>
      Unsaved changes
    </span>
  );
}
