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
export function useDraft<T>(id: string, label: string, initial: T, persist: (value: T) => Promise<T | void>) {
  const ctx = useContext(DraftContext);
  const tab = useContext(TabContext);
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

export function UnsavedTag({ dirty }: { dirty: boolean }) {
  if (!dirty) return null;
  return (
    <span style={{ display: 'inline-block', marginLeft: '8px', padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--color-warning-bg)', color: 'var(--color-warning-dark)', fontSize: 'var(--font-size-xs)', fontWeight: 600, verticalAlign: 'middle' }}>
      Unsaved changes
    </span>
  );
}
