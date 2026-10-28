import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../design-system/components/actions/Button';
import * as leadsApi from '../../api/leads';
import type { LeadStage } from '../../api/leads';

/**
 * Settings → Leads (THE-17): the business's lead stages. Business-wide setup lives under
 * Settings (David, 28 October 2026); Marketing → Leads links here.
 * Deleting a stage that still has leads asks which stage they move to.
 */
export function LeadStagesSettings() {
  const businessId = localStorage.getItem('business_id') || '';
  const [stages, setStages] = useState<LeadStage[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<LeadStage | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function show(list: LeadStage[]) {
    setStages(list);
    setNames(Object.fromEntries(list.map((s) => [s.id, s.name])));
  }

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    leadsApi.getStages(businessId).then(show).catch(() => setError('Could not load the lead stages')).finally(() => setLoading(false));
  }, [businessId]);

  async function run(action: () => Promise<LeadStage[] | void>, done: string) {
    setBusy(true); setError(''); setMessage('');
    try {
      const list = await action();
      show(list || await leadsApi.getStages(businessId));
      setMessage(done);
    } catch (err: any) {
      setError(err.response?.data?.error || 'The change could not be saved');
    } finally { setBusy(false); }
  }

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    run(async () => { await leadsApi.addStage(businessId, name); setNewName(''); }, `Stage "${name}" added.`);
  };

  const rename = (s: LeadStage) => {
    const name = (names[s.id] || '').trim();
    if (!name || name === s.name) { setNames((n) => ({ ...n, [s.id]: s.name })); return; }
    run(async () => { await leadsApi.renameStage(businessId, s.id, name); }, `Stage renamed to "${name}".`);
  };

  const move = (index: number, by: -1 | 1) => {
    const ids = stages.map((s) => s.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + by, 0, id);
    run(() => leadsApi.reorderStages(businessId, ids), 'Order saved.');
  };

  const startDelete = (s: LeadStage) => {
    setDeleting(s);
    setMoveTo(stages.find((x) => x.id !== s.id)?.id || '');
    setError(''); setMessage('');
  };

  const confirmDelete = () => {
    if (!deleting) return;
    const s = deleting;
    run(async () => {
      const list = await leadsApi.deleteStage(businessId, s.id, (s.lead_count || 0) > 0 ? moveTo : undefined);
      setDeleting(null);
      return list;
    }, `Stage "${s.name}" deleted.`);
  };

  if (!businessId) return <div style={styles.section}><p style={styles.muted}>Select a business to set up its lead stages.</p></div>;
  if (loading) return <div style={styles.section}><p style={styles.muted}>Loading…</p></div>;

  return (
    <div style={styles.section} data-testid="lead-stages-settings">
      <h2 style={styles.title}>Lead stages</h2>
      <p style={styles.muted}>
        The stages a lead goes through, in order. A new lead starts in the first stage. A lead who buys or books becomes a customer
        and leaves the <Link to="/marketing" style={styles.link}>Leads</Link> list.
      </p>

      <ol style={styles.list}>
        {stages.map((s, i) => (
          <li key={s.id} style={styles.row}>
            <span style={styles.pos}>{i + 1}</span>
            <input
              style={styles.input}
              aria-label={`Name of stage ${i + 1}`}
              value={names[s.id] ?? s.name}
              maxLength={60}
              onChange={(e) => setNames((n) => ({ ...n, [s.id]: e.target.value }))}
              onBlur={() => rename(s)}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            />
            <span style={styles.count}>{s.lead_count || 0} {s.lead_count === 1 ? 'lead' : 'leads'}</span>
            <Button size="sm" variant="ghost" disabled={busy || i === 0} aria-label={`Move ${s.name} up`} onClick={() => move(i, -1)}>↑</Button>
            <Button size="sm" variant="ghost" disabled={busy || i === stages.length - 1} aria-label={`Move ${s.name} down`} onClick={() => move(i, 1)}>↓</Button>
            <Button size="sm" variant="ghost" disabled={busy || stages.length === 1} onClick={() => startDelete(s)}>Delete</Button>
          </li>
        ))}
      </ol>
      {stages.length === 1 && <p style={styles.hint}>The last stage cannot be deleted.</p>}

      {deleting && (
        <div style={styles.confirm} role="region" aria-label="Delete stage">
          <strong>Delete the stage "{deleting.name}"?</strong>
          {(deleting.lead_count || 0) > 0 ? (
            <label style={styles.confirmLine}>
              Its {deleting.lead_count} {deleting.lead_count === 1 ? 'lead moves' : 'leads move'} to
              <select style={styles.select} aria-label="Move its leads to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                {stages.filter((x) => x.id !== deleting.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
          ) : <span style={styles.muted}>No leads are in this stage.</span>}
          <div style={styles.confirmLine}>
            <Button size="sm" variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button size="sm" variant="destructive" loading={busy} onClick={confirmDelete}>Delete stage</Button>
          </div>
        </div>
      )}

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
        <Button size="sm" disabled={busy || !newName.trim()} onClick={add}>Add stage</Button>
      </div>

      {message && <p style={styles.message} role="status">{message}</p>}
      {error && <p style={styles.error} role="alert">{error}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: { marginBottom: '32px', maxWidth: '720px' },
  title: { fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 8px 0' },
  muted: { fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)', margin: '0 0 16px' },
  link: { color: 'var(--color-primary)' },
  list: { listStyle: 'none', padding: 0, margin: '0 0 8px', display: 'flex', flexDirection: 'column', gap: '6px' },
  row: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
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
  hint: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', margin: '0 0 8px' },
  confirm: {
    display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 16px', margin: '8px 0 16px',
    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)',
    fontSize: 'var(--font-size-sm)',
  },
  confirmLine: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  addRow: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '16px', paddingLeft: '28px' },
  message: { fontSize: 'var(--font-size-sm)', color: 'var(--color-success)', marginTop: '8px' },
  error: { fontSize: 'var(--font-size-sm)', color: 'var(--color-error)', marginTop: '8px' },
};
