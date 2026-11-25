import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LEAD_SOURCE_LABELS } from '@daystream/shared';
import { Table } from '../design-system/components/data/Table';
import type { TableFilters } from '../design-system/components/data/Table';
import { Button } from '../design-system/components/actions/Button';
import { Modal } from '../design-system/components/feedback/Modal';
import { ConfirmDialog } from '../design-system/components/feedback/ConfirmDialog';
import { useDraft, fieldMark, UnsavedTag } from '../components/unsaved/DraftSections';
import { useGuardedNavigate } from '../components/unsaved/LeaveGuard';
import * as leadsApi from '../api/leads';
import * as customersApi from '../api/customers';
import { useAuth } from '../context/AuthContext';
import { getPermissionsFromRole } from '../context/ContextManager';
import type { Lead, LeadStage } from '../api/leads';
import { useColumnOrder, orderColumns } from '../utils/peopleColumns';
import { formatDate, formatNumber } from '../utils/format';

// Leads' columns in the business column order (Settings → People lists, THE-18).
const LEADS_CANONICAL: Record<string, string> = { email: 'email', phone: 'phone', owner_name: 'owner', created_at: 'created_at', lead_source: 'source', messages_sent: 'messages_sent', stage: 'stage', tags: 'tags' };

/**
 * Marketing → Leads (THE-17): the business's people still at lifecycle stage "lead".
 * Assigned staff, source, lead stage and tags are changed in the row and wait for Marketing's
 * Save changes (David, 2026-11-02, decision 10); the row opens the person's profile. "Delete lead" archives the person, who can be restored from "Show deleted leads".
 * Lead stages are set up under Settings → Leads.
 */
export function Leads() {
  const { t } = useTranslation('customers');
  const navigate = useGuardedNavigate();
  const { user } = useAuth();
  const perms = getPermissionsFromRole(user?.role || '');
  const canEdit = perms.some((p) => p === '*:*' || p === 'customers:*');
  const canSetUp = perms.some((p) => p === '*:*' || p === 'settings:*');
  const columnOrder = useColumnOrder();
  const businessId = localStorage.getItem('business_id') || '';

  const [leads, setLeads] = useState<Lead[]>([]);
  const [stages, setStages] = useState<LeadStage[]>([]);
  const [timezone, setTimezone] = useState('UTC');
  const [loading, setLoading] = useState(true);
  // No pages (David, 2026-11-02): more leads load as the list scrolls.
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState('created_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Column filters from the icon beside each sort icon (replace the stage / source / staff menus).
  const [tableFilters, setTableFilters] = useState<TableFilters>({});
  const [archived, setArchived] = useState(false);
  const [owners, setOwners] = useState<Array<{ id: string; first_name: string; last_name: string }>>([]);
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([]);
  const [message, setMessage] = useState('');
  const [toDelete, setToDelete] = useState<Lead | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await leadsApi.getLeads(businessId, {
        search: debouncedSearch || undefined, columns: tableFilters, archived, sort, order, page: 1, limit: 50,
      });
      setLeads(res.data);
      setPage(1);
      setStages(res.meta.stages);
      setTimezone(res.meta.timezone || 'UTC');
      setTotal(res.meta.total);
    } catch { setMessage(t('leads.loadFailed')); }
    finally { setLoading(false); }
  }, [businessId, debouncedSearch, tableFilters, archived, sort, order, t]);

  useEffect(() => { load(); }, [load]);

  // The next leads, when the end of the list scrolls into view.
  const loadMore = useCallback(async () => {
    if (loadingMore || leads.length >= total) return;
    setLoadingMore(true);
    try {
      const res = await leadsApi.getLeads(businessId, { search: debouncedSearch || undefined, columns: tableFilters, archived, sort, order, page: page + 1, limit: 50 });
      setLeads((rows) => [...rows, ...res.data]);
      setPage(page + 1);
      setTotal(res.meta.total);
    } catch { /* Show more stays to try again */ }
    finally { setLoadingMore(false); }
  }, [businessId, debouncedSearch, tableFilters, archived, sort, order, page, loadingMore, leads.length, total]);

  // A column's filter list: every value among the matching leads, named as the cells show them.
  const filterOptions = useCallback(async (key: string) => {
    const values = await leadsApi.getLeadColumnValues(businessId, key, { search: debouncedSearch || undefined, columns: tableFilters, archived });
    return values.map((v) => ({
      value: v.value, count: v.count,
      label: key === 'lead_source' ? (v.value ? t('leadSource.' + v.value, { defaultValue: LEAD_SOURCE_LABELS[v.value] || v.value }) : t('leads.noSource'))
        : key === 'owner_name' ? (v.label || t('leads.unassigned'))
        : v.label || v.value,
    }));
  }, [businessId, debouncedSearch, tableFilters, archived, t]);

  useEffect(() => {
    if (!businessId) return;
    customersApi.getOwners(businessId).then(setOwners).catch(() => setOwners([]));
    customersApi.getTags(businessId).then(setTags).catch(() => setTags([]));
  }, [businessId]);

  const replaceRow = (next: Lead) => setLeads((rows) => rows.map((r) => (r.id === next.id ? { ...r, ...next } : r)));

  // Changes made in the rows, per lead, until Save changes stores them (stage changes then go on the Timeline).
  type Fields = { lead_stage_id?: string; owner_user_id?: string | null; lead_source?: string | null };
  type Pending = Record<string, Fields & { addTags?: string[]; removeTags?: string[] }>;
  const draft = useDraft<Pending>('leads-rows', t('leads.draftLabel'), {}, async (all) => {
    const left: Pending = { ...all };
    try {
      for (const [id, p] of Object.entries(all)) {
        const { addTags = [], removeTags = [], ...fields } = p;
        let row = leads.find((l) => l.id === id);
        if (Object.keys(fields).length) { const updated = await leadsApi.updateLead(businessId, id, fields); replaceRow(updated); row = row && { ...row, ...updated }; }
        for (const tagId of addTags) await customersApi.assignTag(id, businessId, tagId);
        for (const tagId of removeTags) await customersApi.removeTag(id, tagId);
        delete left[id];
      }
    } catch (err) { draft.rebase({}, left); load(); throw err; }
    // Stage, staff, source and tags may take leads out of the current filters.
    load();
    return {};
  });
  const pending = (lead: Lead) => draft.value[lead.id] || {};
  const value = <K extends keyof Fields>(lead: Lead, key: K): Lead[K & keyof Lead] => (key in pending(lead) ? (pending(lead) as any)[key] : (lead as any)[key]);
  const changed = (lead: Lead, key: keyof Fields) => key in pending(lead);
  const setPending = (lead: Lead, next: Fields & { addTags?: string[]; removeTags?: string[] }) => {
    // A value put back as it was is no longer a change.
    const clean: any = {};
    for (const [k, v] of Object.entries(next)) {
      if (k === 'addTags' || k === 'removeTags') { if ((v as string[]).length) clean[k] = v; }
      else if ((v ?? null) !== ((lead as any)[k] ?? null)) clean[k] = v;
    }
    const all = { ...draft.value };
    if (Object.keys(clean).length) all[lead.id] = clean; else delete all[lead.id];
    draft.setValue(all);
  };
  function change(lead: Lead, patch: Fields) {
    setMessage('');
    setPending(lead, { ...pending(lead), ...patch });
  }

  function addTag(lead: Lead, tagId: string) {
    if (!tagId) return;
    const p = pending(lead);
    const removing = (p.removeTags || []).includes(tagId);
    setPending(lead, { ...p, removeTags: (p.removeTags || []).filter((x) => x !== tagId), addTags: removing ? (p.addTags || []) : [...(p.addTags || []), tagId] });
  }

  function removeTag(lead: Lead, tagId: string) {
    const p = pending(lead);
    const adding = (p.addTags || []).includes(tagId);
    setPending(lead, { ...p, addTags: (p.addTags || []).filter((x) => x !== tagId), removeTags: adding ? (p.removeTags || []) : [...(p.removeTags || []), tagId] });
  }

  // Tags as they will be after Save changes, with what is new or going marked.
  const shownTags = (lead: Lead) => {
    const p = pending(lead);
    const kept = lead.tags.map((t) => ({ ...t, state: (p.removeTags || []).includes(t.id) ? 'removed' : '' }));
    const added = (p.addTags || []).map((id) => tags.find((t) => t.id === id)).filter(Boolean).map((t) => ({ ...t!, state: 'added' }));
    return [...kept, ...added];
  };

  async function deleteLead(lead: Lead) {
    try {
      await customersApi.archiveCustomer(lead.id, businessId);
      setMessage(t('leads.deleted', { name: fullName(lead) }));
      load();
    } catch { setMessage(t('leads.deleteFailed')); }
  }

  async function restore(lead: Lead) {
    try {
      await leadsApi.restoreLead(businessId, lead.id);
      setMessage(t('leads.restored', { name: fullName(lead) }));
      load();
    } catch { setMessage(t('leads.restoreFailed')); }
  }

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const createdAt = (iso: string) => formatDate(iso, { timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric' });

  const allColumns = [
    {
      key: 'first_name', header: t('leads.col.name'), sortable: true,
      render: (_: string, row: Lead) => (
        <span>
          <span style={styles.name}>{fullName(row)}</span>
          {(row.email || row.phone) && <span style={styles.sub}>{row.email || row.phone}</span>}
        </span>
      ),
    },
    {
      key: 'owner_name', header: t('leads.col.assignedStaff'), sortable: true,
      render: (val: string | null, row: Lead) => canEdit && !archived ? (
        <select style={{ ...styles.cellSelect, ...fieldMark(changed(row, 'owner_user_id')) }} aria-label={t('leads.assignedStaffFor', { name: fullName(row) })} value={value(row, 'owner_user_id') || ''}
          onClick={stop} onChange={(e) => change(row, { owner_user_id: e.target.value || null })}>
          <option value="">{t('leads.unassigned')}</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.first_name} {o.last_name}</option>)}
          {row.owner_user_id && !owners.some((o) => o.id === row.owner_user_id) && <option value={row.owner_user_id}>{val}</option>}
        </select>
      ) : (val || t('leads.unassigned')),
    },
    { key: 'created_at', header: t('leads.col.createdAt'), sortable: true, filter: 'date' as const, render: (val: string) => createdAt(val) },
    {
      // Editable in the row, like stage and staff (David, 2026-10-29: a wrong source can be corrected).
      key: 'lead_source', header: t('leads.col.source'), sortable: true,
      render: (val: string | null, row: Lead) => canEdit && !archived ? (
        <select style={{ ...styles.cellSelect, ...fieldMark(changed(row, 'lead_source')) }} aria-label={t('leads.sourceFor', { name: fullName(row) })} value={value(row, 'lead_source') || ''}
          onClick={stop} onChange={(e) => change(row, { lead_source: e.target.value || null })}>
          <option value="">—</option>
          {Object.entries(LEAD_SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{t('leadSource.' + v, { defaultValue: l })}</option>)}
        </select>
      ) : (val ? t('leadSource.' + val, { defaultValue: LEAD_SOURCE_LABELS[val] || val }) : '—'),
    },
    { key: 'messages_sent', header: t('leads.col.messagesSent'), sortable: true, align: 'right' as const, render: (val: number) => <span style={styles.num}>{formatNumber(val)}</span> },
    {
      key: 'stage', header: t('leads.col.leadStage'), sortable: true,
      render: (_: unknown, row: Lead) => canEdit && !archived ? (
        <select style={{ ...styles.cellSelect, ...fieldMark(changed(row, 'lead_stage_id')) }} aria-label={t('leads.leadStageFor', { name: fullName(row) })} value={value(row, 'lead_stage_id') || ''}
          onClick={stop} onChange={(e) => change(row, { lead_stage_id: e.target.value })}>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      ) : (row.lead_stage_name || '—'),
    },
    {
      key: 'tags', header: t('leads.col.tags'), filter: false as const,
      render: (_: unknown, row: Lead) => (
        <span style={styles.tags} onClick={stop}>
          {shownTags(row).length === 0 && <span style={styles.sub}>{t('leads.noTags')}</span>}
          {shownTags(row).map((tg) => (
            <span key={tg.id} style={{ ...styles.tag, ...(tg.state ? fieldMark(true) : {}), ...(tg.state === 'removed' ? { textDecoration: 'line-through', opacity: 0.7 } : {}) }}
              title={tg.state === 'added' ? t('leads.tagAddedOnSave') : tg.state === 'removed' ? t('leads.tagRemovedOnSave') : undefined}>
              {tg.name}
              {canEdit && !archived && (tg.state === 'removed'
                ? <button style={styles.tagRemove} aria-label={t('leads.keepTag', { tag: tg.name, name: fullName(row) })} title={t('leads.undo')} onClick={() => addTag(row, tg.id)}>↺</button>
                : <button style={styles.tagRemove} aria-label={t('leads.removeTag', { tag: tg.name, name: fullName(row) })} onClick={() => removeTag(row, tg.id)}>×</button>)}
            </span>
          ))}
          {canEdit && !archived && tags.some((t) => !shownTags(row).some((x) => x.id === t.id)) && (
            <select style={styles.tagAdd} aria-label={t('leads.addTagTo', { name: fullName(row) })} value="" onChange={(e) => addTag(row, e.target.value)}>
              <option value="">{t('leads.addTag')}</option>
              {tags.filter((t) => !shownTags(row).some((x) => x.id === t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </span>
      ),
    },
    ...(canEdit ? [{
      key: 'actions', header: '', filter: false as const,
      render: (_: unknown, row: Lead) => (
        <span onClick={stop}>
          {archived
            ? <Button size="sm" variant="secondary" onClick={() => restore(row)}>{t('leads.restore')}</Button>
            : <Button size="sm" variant="ghost" onClick={() => setToDelete(row)}>{t('leads.deleteLead')}</Button>}
        </span>
      ),
    }] : []),
  ];
  const columns = orderColumns(allColumns, columnOrder, LEADS_CANONICAL, ['first_name', 'last_name']);

  return (
    <div>
      <div style={styles.toolbar}>
        <input style={styles.search} placeholder={t('leads.searchPlaceholder')} aria-label={t('leads.searchLabel')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <label style={styles.check}>
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          {t('leads.showDeleted')}
        </label>
        <span style={styles.spacer} />
        {canSetUp && <Link to="/settings?tab=leads" style={styles.link}>{t('leads.stagesLink')}</Link>}
        {canEdit && <Button onClick={() => setAdding(true)}>{t('leads.addLead')}</Button>}
      </div>

      <p style={styles.count} aria-live="polite">{loading ? ' ' : t(archived ? 'leads.deletedCount' : 'leads.count', { count: total })}<UnsavedTag dirty={draft.dirty} /></p>
      {message && <p style={styles.message} role="status">{message}</p>}

      <Table
        columns={columns}
        data={leads}
        loading={loading}
        onRowClick={(row) => navigate(`/customers/${row.id}`)}
        onSort={(key, o) => { setSort(key); setOrder(o); }}
        filters={tableFilters}
        onFiltersChange={setTableFilters}
        filterOptions={filterOptions}
        onLoadMore={loadMore}
        hasMore={leads.length < total}
        loadingMore={loadingMore}
        emptyMessage={archived ? t('leads.noDeleted') : t('leads.none')}
        mobileCardMode
      />

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => { if (toDelete) deleteLead(toDelete); }}
        title={t('leads.deleteLead')}
        message={toDelete ? t('leads.deleteConfirm', { name: fullName(toDelete) }) : ''}
        confirmLabel={t('leads.deleteLead')}
      />

      {adding && (
        <AddLeadModal
          businessId={businessId}
          stages={stages}
          owners={owners}
          tags={tags}
          onClose={() => setAdding(false)}
          onAdded={(lead) => { setAdding(false); setMessage(t('leads.added', { name: fullName(lead) })); load(); }}
        />
      )}
    </div>
  );
}

function fullName(l: { first_name: string; last_name: string | null }) {
  return `${l.first_name} ${l.last_name || ''}`.trim();
}

/** Add lead (David, THE-17): name, email, phone, lead source, stage (first by default), staff, tags. Email or phone required. */
function AddLeadModal({ businessId, stages, owners, tags, onClose, onAdded }: {
  businessId: string;
  stages: LeadStage[];
  owners: Array<{ id: string; first_name: string; last_name: string }>;
  tags: Array<{ id: string; name: string }>;
  onClose: () => void;
  onAdded: (lead: Lead) => void;
}) {
  const { t } = useTranslation('customers');
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '', lead_source: '', lead_stage_id: stages[0]?.id || '', owner_user_id: '',
  });
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setError('');
    if (!form.first_name.trim()) { setError(t('leads.form.firstNameRequired')); return; }
    if (!form.email.trim() && !form.phone.trim()) { setError(t('leads.form.contactRequired')); return; }
    setSaving(true);
    try {
      const lead = await leadsApi.createLead(businessId, {
        first_name: form.first_name.trim(), last_name: form.last_name.trim() || undefined,
        email: form.email.trim() || undefined, phone: form.phone.trim() || undefined,
        lead_source: form.lead_source || undefined, lead_stage_id: form.lead_stage_id || undefined,
        owner_user_id: form.owner_user_id || undefined, tag_ids: tagIds,
      });
      onAdded(lead);
    } catch (err: any) {
      setError(err.response?.data?.error || t('leads.form.addFailed'));
    } finally { setSaving(false); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('leads.addLead')}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t('common:cancel')}</Button>
        <Button loading={saving} onClick={save}>{t('leads.addLead')}</Button>
      </>}
    >
      <div style={styles.form}>
        <div style={styles.formRow}>
          <label style={styles.field}>{t('leads.form.firstName')}<input style={styles.input} value={form.first_name} onChange={set('first_name')} /></label>
          <label style={styles.field}>{t('leads.form.lastName')}<input style={styles.input} value={form.last_name} onChange={set('last_name')} /></label>
        </div>
        <div style={styles.formRow}>
          <label style={styles.field}>{t('leads.form.email')}<input style={styles.input} type="email" value={form.email} onChange={set('email')} /></label>
          <label style={styles.field}>{t('leads.form.phone')}<input style={styles.input} type="tel" value={form.phone} onChange={set('phone')} /></label>
        </div>
        <p style={styles.hint}>{t('leads.form.contactHint')}</p>
        <div style={styles.formRow}>
          <label style={styles.field}>{t('leads.form.leadSource')}
            <select style={styles.input} value={form.lead_source} onChange={set('lead_source')}>
              <option value="">—</option>
              {Object.entries(LEAD_SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{t('leadSource.' + v, { defaultValue: l })}</option>)}
            </select>
          </label>
          <label style={styles.field}>{t('leads.col.leadStage')}
            <select style={styles.input} value={form.lead_stage_id} onChange={set('lead_stage_id')}>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
        <label style={styles.field}>{t('leads.col.assignedStaff')}
          <select style={styles.input} value={form.owner_user_id} onChange={set('owner_user_id')}>
            <option value="">{t('leads.unassigned')}</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.first_name} {o.last_name}</option>)}
          </select>
        </label>
        <fieldset style={styles.fieldset}>
          <legend style={styles.legend}>{t('leads.col.tags')}</legend>
          {tags.length === 0 && <span style={styles.hint}>{t('leads.form.noTagsDefined')}</span>}
          {tags.map((t) => (
            <label key={t.id} style={styles.check}>
              <input type="checkbox" checked={tagIds.includes(t.id)}
                onChange={(e) => setTagIds((ids) => (e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id)))} />
              {t.name}
            </label>
          ))}
        </fieldset>
        {error && <p style={styles.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

const control: React.CSSProperties = {
  fontSize: 'var(--font-size-sm)', padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', maxWidth: '100%',
};

const styles: Record<string, React.CSSProperties> = {
  toolbar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm)', margin: 'var(--space-md) 0 var(--space-sm)' },
  search: { ...control, minWidth: '220px', flex: '1 1 220px', maxWidth: '320px' },
  filter: control,
  check: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', cursor: 'pointer' },
  spacer: { flex: '1 1 auto' },
  link: { fontSize: 'var(--font-size-sm)', color: 'var(--color-primary)' },
  count: { margin: '0 0 var(--space-sm)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', minHeight: '1.2em' },
  message: { margin: '0 0 var(--space-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  name: { display: 'block', fontWeight: 'var(--font-weight-semibold)' as any },
  sub: { display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  num: { display: 'block', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  cellSelect: { ...control, padding: '4px 8px', fontSize: 'var(--font-size-xs)' },
  tags: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' },
  tag: {
    display: 'inline-flex', alignItems: 'center', gap: '2px', padding: '2px 8px', borderRadius: 'var(--radius-full)',
    background: 'var(--color-surface-hover)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text)',
  },
  tagRemove: { background: 'none', border: 'none', padding: '0 2px', cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', lineHeight: 1 },
  tagAdd: { ...control, padding: '2px 6px', fontSize: 'var(--font-size-xs)' },
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' },
  formRow: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)' },
  field: { display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 200px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  input: { ...control, padding: '8px 10px' },
  hint: { margin: 0, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  fieldset: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-sm) var(--space-md)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)' },
  legend: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', padding: '0 4px' },
  error: { margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-error)' },
};
