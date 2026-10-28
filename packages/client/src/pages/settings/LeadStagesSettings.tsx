import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../design-system/components/actions/Button';
import * as leadsApi from '../../api/leads';
import type { LeadStage } from '../../api/leads';
import { useDraft, draftBox, fieldMark, UnsavedTag } from '../../components/unsaved/DraftSections';

/**
 * Settings → Leads (THE-17): the business's lead stages. Business-wide setup lives under
 * Settings (David, 28 October 2026); Marketing → Leads links here.
 * Changes wait for the page's Save changes like the rest of Settings (David, 2026-10-28):
 * new, renamed and moved stages are marked, and a deleted stage stays listed, crossed out,
 * with the stage its leads move to, until the page is saved.
 */

interface StageRow {
  /** The stage's id, or a temporary key for a stage added on screen. */
  key: string;
  id?: string;
  name: string;
  lead_count: number;
  deleted?: boolean;
  /** Key of the stage a deleted stage's leads move to. */
  moveTo?: string;
}

const toRows = (list: LeadStage[]): StageRow[] => list.map((s) => ({ key: s.id, id: s.id, name: s.name, lead_count: s.lead_count || 0 }));
let newKey = 0;

export function LeadStagesSettings() {
  const businessId = localStorage.getItem('business_id') || '';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');

  const draft = useDraft<StageRow[]>('lead-stages', 'Leads › Lead stages', [], async (rows) => {
    const live = rows.filter((r) => !r.deleted);
    if (live.length === 0) throw new Error('At least one stage must stay');
    if (live.some((r) => !r.name.trim())) throw new Error('Every stage needs a name');
    for (const r of rows) {
      if (r.deleted && r.id && r.lead_count > 0 && !live.some((x) => x.key === r.moveTo)) throw new Error(`Choose where the leads of "${r.name}" move to`);
    }
    // Applied in this order: new stages first (so leads can move to them), then deletions,
    // renames and the order. What went through is kept if a later step fails.
    const idOf: Record<string, string> = {};
    const gone = new Set<string>();
    try {
      for (const r of live) if (!r.id) idOf[r.key] = (await leadsApi.addStage(businessId, r.name.trim())).id;
      for (const r of rows) {
        if (!r.deleted || !r.id) continue;
        const target = r.moveTo ? (idOf[r.moveTo] || r.moveTo) : undefined;
        await leadsApi.deleteStage(businessId, r.id, r.lead_count > 0 ? target : undefined);
        gone.add(r.key);
      }
      for (const r of live) {
        const before = draft.saved.find((x) => x.key === r.key);
        if (r.id && before && before.name !== r.name.trim()) await leadsApi.renameStage(businessId, r.id, r.name.trim());
      }
      const ids = live.map((r) => r.id || idOf[r.key]);
      const stored = await leadsApi.getStages(businessId);
      if (stored.map((s) => s.id).join() !== ids.join()) return toRows(await leadsApi.reorderStages(businessId, ids));
      return toRows(stored);
    } catch (err) {
      // Show what is stored now, keeping the changes that did not go through on screen.
      const stored = toRows(await leadsApi.getStages(businessId));
      const onScreen = rows.filter((r) => !gone.has(r.key)).map((r) => (idOf[r.key] ? { ...r, key: idOf[r.key], id: idOf[r.key] } : r))
        .map((r) => ({ ...r, lead_count: stored.find((x) => x.id === r.id)?.lead_count ?? r.lead_count }));
      draft.rebase(stored, onScreen);
      throw err;
    }
  });
  const rows = draft.value;
  const live = rows.filter((r) => !r.deleted);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    leadsApi.getStages(businessId).then((list) => draft.load(toRows(list))).catch(() => setError('Could not load the lead stages')).finally(() => setLoading(false));
  }, [businessId, draft.load]);

  const update = (key: string, patch: Partial<StageRow>) => draft.setValue(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    newKey += 1;
    draft.setValue([...rows, { key: `new-${newKey}`, name, lead_count: 0 }]);
    setNewName('');
  };

  const move = (index: number, by: -1 | 1) => {
    // Moves past crossed-out (deleted) stages to the next stage that stays.
    let to = index + by;
    while (to >= 0 && to < rows.length && rows[to].deleted) to += by;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(to, 0, row);
    draft.setValue(next);
  };

  const remove = (r: StageRow) => {
    if (!r.id) { draft.setValue(rows.filter((x) => x.key !== r.key)); return; }
    update(r.key, { deleted: true, moveTo: live.find((x) => x.key !== r.key)?.key });
  };

  if (!businessId) return <div style={styles.section}><p style={styles.muted}>Select a business to set up its lead stages.</p></div>;
  if (loading) return <div style={styles.section}><p style={styles.muted}>Loading…</p></div>;

  // A stage counts as moved when its place among the stored stages that stay has changed.
  const keptNow = live.filter((r) => r.id).map((r) => r.key);
  const keptBefore = draft.saved.map((r) => r.key).filter((k) => keptNow.includes(k));
  let position = 0;
  return (
    <div style={{ ...styles.section, ...draftBox(draft.dirty) }} data-testid="lead-stages-settings">
      <h2 style={styles.title}>Lead stages<UnsavedTag dirty={draft.dirty} /></h2>
      <p style={styles.muted}>
        The stages a lead goes through, in order. A new lead starts in the first stage. A lead who buys or books becomes a customer
        and leaves the <Link to="/marketing" style={styles.link}>Leads</Link> list.
      </p>

      <ol style={styles.list}>
        {rows.map((r, i) => {
          const before = draft.saved.find((x) => x.key === r.key);
          const isNew = !r.id;
          const renamed = !!before && before.name !== r.name;
          const moved = !!before && !r.deleted && keptNow.indexOf(r.key) !== keptBefore.indexOf(r.key);
          if (r.deleted) {
            const others = live;
            return (
              <li key={r.key} style={{ ...styles.row, ...styles.deletedRow }}>
                <span style={styles.pos}>–</span>
                <span style={styles.deletedName}>{before?.name || r.name}</span>
                <span style={styles.tag}>Deleted when you save</span>
                {r.lead_count > 0 ? (
                  <label style={styles.confirmLine}>
                    its {r.lead_count} {r.lead_count === 1 ? 'lead moves' : 'leads move'} to
                    <select style={{ ...styles.select, ...fieldMark(true) }} aria-label={`Move the leads of ${r.name} to`} value={r.moveTo || ''} onChange={(e) => update(r.key, { moveTo: e.target.value })}>
                      {others.map((x) => <option key={x.key} value={x.key}>{x.name || '(no name)'}</option>)}
                    </select>
                  </label>
                ) : <span style={styles.count}>no leads</span>}
                <Button size="sm" variant="ghost" onClick={() => update(r.key, { deleted: false, moveTo: undefined })}>Undo</Button>
              </li>
            );
          }
          position += 1;
          return (
            <li key={r.key} style={styles.row}>
              <span style={styles.pos}>{position}</span>
              <input
                style={{ ...styles.input, ...fieldMark(isNew || renamed) }}
                aria-label={`Name of stage ${position}`}
                value={r.name}
                maxLength={60}
                onChange={(e) => update(r.key, { name: e.target.value })}
              />
              <span style={styles.count}>{r.lead_count} {r.lead_count === 1 ? 'lead' : 'leads'}</span>
              <Button size="sm" variant="ghost" disabled={position === 1} aria-label={`Move ${r.name} up`} onClick={() => move(i, -1)}>↑</Button>
              <Button size="sm" variant="ghost" disabled={position === live.length} aria-label={`Move ${r.name} down`} onClick={() => move(i, 1)}>↓</Button>
              <Button size="sm" variant="ghost" disabled={live.length === 1} onClick={() => remove(r)}>Delete</Button>
              {isNew && <span style={styles.tag}>New</span>}
              {moved && <span style={styles.tag}>Moved</span>}
            </li>
          );
        })}
      </ol>
      {live.length === 1 && <p style={styles.hint}>The last stage cannot be deleted.</p>}

      <div style={styles.addRow}>
        <input
          style={styles.input}
          placeholder="New stage name"
          aria-label="New stage name"
          value={newName}
          maxLength={60}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        />
        <Button size="sm" disabled={!newName.trim()} onClick={add}>Add stage</Button>
      </div>

      {error && <p style={styles.error} role="alert">{error}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: { marginBottom: '32px', maxWidth: '760px' },
  title: { fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 8px 0' },
  muted: { fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)', margin: '0 0 16px' },
  link: { color: 'var(--color-primary)' },
  list: { listStyle: 'none', padding: 0, margin: '0 0 8px', display: 'flex', flexDirection: 'column', gap: '6px' },
  row: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  deletedRow: { padding: '4px 0', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
  deletedName: { textDecoration: 'line-through', minWidth: '120px' },
  pos: { width: '20px', textAlign: 'right', color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--font-size-sm)' },
  input: {
    backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '6px 10px',
    color: 'var(--color-text)', fontSize: 'var(--font-size-base)', fontFamily: 'var(--font-family)', flex: '1 1 200px', minWidth: 0, maxWidth: '320px',
  },
  select: {
    backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '4px 8px',
    color: 'var(--color-text)', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)',
  },
  count: { minWidth: '64px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' },
  tag: { padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--color-warning-bg)', color: 'var(--color-warning-dark)', fontSize: 'var(--font-size-xs)', fontWeight: 600 },
  hint: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', margin: '0 0 8px' },
  confirmLine: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  addRow: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '16px', paddingLeft: '28px' },
  error: { fontSize: 'var(--font-size-sm)', color: 'var(--color-error)', marginTop: '8px' },
};
