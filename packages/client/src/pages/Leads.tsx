import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { LEAD_SOURCE_LABELS } from '@daystream/shared';
import { Table } from '../design-system/components/data/Table';
import { Button } from '../design-system/components/actions/Button';
import { Modal } from '../design-system/components/feedback/Modal';
import { ConfirmDialog } from '../design-system/components/feedback/ConfirmDialog';
import * as leadsApi from '../api/leads';
import * as customersApi from '../api/customers';
import { useAuth } from '../context/AuthContext';
import { getPermissionsFromRole } from '../context/ContextManager';
import type { Lead, LeadStage } from '../api/leads';

/**
 * Marketing → Leads (THE-17): the business's people still at lifecycle stage "lead".
 * Assigned staff, lead stage and tags are changed in the row; the row opens the person's
 * profile. "Delete lead" archives the person, who can be restored from "Show deleted leads".
 * Lead stages are set up under Settings → Leads.
 */
export function Leads() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const perms = getPermissionsFromRole(user?.role || '');
  const canEdit = perms.some((p) => p === '*:*' || p === 'customers:*');
  const canSetUp = perms.some((p) => p === '*:*' || p === 'settings:*');
  const businessId = localStorage.getItem('business_id') || '';

  const [leads, setLeads] = useState<Lead[]>([]);
  const [stages, setStages] = useState<LeadStage[]>([]);
  const [timezone, setTimezone] = useState('UTC');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState('created_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [archived, setArchived] = useState(false);
  const [owners, setOwners] = useState<Array<{ id: string; first_name: string; last_name: string }>>([]);
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([]);
  const [message, setMessage] = useState('');
  const [toDelete, setToDelete] = useState<Lead | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await leadsApi.getLeads(businessId, {
        search: debouncedSearch || undefined, stage_id: stageFilter || undefined, lead_source: sourceFilter || undefined,
        owner: ownerFilter || undefined, archived, sort, order, page, limit: 20,
      });
      setLeads(res.data);
      setStages(res.meta.stages);
      setTimezone(res.meta.timezone || 'UTC');
      setTotal(res.meta.total);
      setTotalPages(res.meta.totalPages || 1);
    } catch { setMessage('Could not load the leads'); }
    finally { setLoading(false); }
  }, [businessId, debouncedSearch, stageFilter, sourceFilter, ownerFilter, archived, sort, order, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!businessId) return;
    customersApi.getOwners(businessId).then(setOwners).catch(() => setOwners([]));
    customersApi.getTags(businessId).then(setTags).catch(() => setTags([]));
  }, [businessId]);

  const replaceRow = (next: Lead) => setLeads((rows) => rows.map((r) => (r.id === next.id ? { ...r, ...next } : r)));

  async function change(lead: Lead, patch: { lead_stage_id?: string; owner_user_id?: string | null }) {
    setMessage('');
    try {
      replaceRow(await leadsApi.updateLead(businessId, lead.id, patch));
      // A changed stage or staff member may take the lead out of the current filter.
      if ((patch.lead_stage_id && stageFilter) || (patch.owner_user_id !== undefined && ownerFilter)) load();
    } catch (err: any) { setMessage(err.response?.data?.error || 'The change could not be saved'); }
  }

  async function addTag(lead: Lead, tagId: string) {
    if (!tagId) return;
    setMessage('');
    try {
      await customersApi.assignTag(lead.id, businessId, tagId);
      const tag = tags.find((t) => t.id === tagId);
      if (tag) replaceRow({ ...lead, tags: [...lead.tags, tag].sort((a, b) => a.name.localeCompare(b.name)) });
    } catch { setMessage('The tag could not be added'); }
  }

  async function removeTag(lead: Lead, tagId: string) {
    setMessage('');
    try {
      await customersApi.removeTag(lead.id, tagId);
      replaceRow({ ...lead, tags: lead.tags.filter((t) => t.id !== tagId) });
    } catch { setMessage('The tag could not be removed'); }
  }

  async function deleteLead(lead: Lead) {
    try {
      await customersApi.archiveCustomer(lead.id, businessId);
      setMessage(`${fullName(lead)} was deleted. You can restore them from "Show deleted leads".`);
      load();
    } catch { setMessage('The lead could not be deleted'); }
  }

  async function restore(lead: Lead) {
    try {
      await leadsApi.restoreLead(businessId, lead.id);
      setMessage(`${fullName(lead)} was restored.`);
      load();
    } catch { setMessage('The lead could not be restored'); }
  }

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const createdAt = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric' });

  const columns = [
    {
      key: 'first_name', header: 'Name', sortable: true,
      render: (_: string, row: Lead) => (
        <span>
          <span style={styles.name}>{fullName(row)}</span>
          {(row.email || row.phone) && <span style={styles.sub}>{row.email || row.phone}</span>}
        </span>
      ),
    },
    {
      key: 'owner_name', header: 'Assigned staff', sortable: true,
      render: (val: string | null, row: Lead) => canEdit && !archived ? (
        <select style={styles.cellSelect} aria-label={`Assigned staff for ${fullName(row)}`} value={row.owner_user_id || ''}
          onClick={stop} onChange={(e) => change(row, { owner_user_id: e.target.value || null })}>
          <option value="">Unassigned</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.first_name} {o.last_name}</option>)}
          {row.owner_user_id && !owners.some((o) => o.id === row.owner_user_id) && <option value={row.owner_user_id}>{val}</option>}
        </select>
      ) : (val || 'Unassigned'),
    },
    { key: 'created_at', header: 'Created at', sortable: true, render: (val: string) => createdAt(val) },
    { key: 'lead_source', header: 'Source', sortable: true, render: (val: string | null) => (val ? LEAD_SOURCE_LABELS[val] || val : '—') },
    { key: 'messages_sent', header: 'Messages sent', sortable: true, align: 'right' as const, render: (val: number) => <span style={styles.num}>{val}</span> },
    {
      key: 'stage', header: 'Lead stage', sortable: true,
      render: (_: unknown, row: Lead) => canEdit && !archived ? (
        <select style={styles.cellSelect} aria-label={`Lead stage for ${fullName(row)}`} value={row.lead_stage_id || ''}
          onClick={stop} onChange={(e) => change(row, { lead_stage_id: e.target.value })}>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      ) : (row.lead_stage_name || '—'),
    },
    {
      key: 'tags', header: 'Tags',
      render: (_: unknown, row: Lead) => (
        <span style={styles.tags} onClick={stop}>
          {row.tags.length === 0 && <span style={styles.sub}>No tags assigned</span>}
          {row.tags.map((t) => (
            <span key={t.id} style={styles.tag}>
              {t.name}
              {canEdit && !archived && (
                <button style={styles.tagRemove} aria-label={`Remove tag ${t.name} from ${fullName(row)}`} onClick={() => removeTag(row, t.id)}>×</button>
              )}
            </span>
          ))}
          {canEdit && !archived && tags.some((t) => !row.tags.some((x) => x.id === t.id)) && (
            <select style={styles.tagAdd} aria-label={`Add a tag to ${fullName(row)}`} value="" onChange={(e) => addTag(row, e.target.value)}>
              <option value="">+ Tag</option>
              {tags.filter((t) => !row.tags.some((x) => x.id === t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </span>
      ),
    },
    ...(canEdit ? [{
      key: 'actions', header: '',
      render: (_: unknown, row: Lead) => (
        <span onClick={stop}>
          {archived
            ? <Button size="sm" variant="secondary" onClick={() => restore(row)}>Restore</Button>
            : <Button size="sm" variant="ghost" onClick={() => setToDelete(row)}>Delete lead</Button>}
        </span>
      ),
    }] : []),
  ];

  return (
    <div>
      <div style={styles.toolbar}>
        <input style={styles.search} placeholder="Search name, email or phone" aria-label="Search leads" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={styles.filter} aria-label="Filter by lead stage" value={stageFilter} onChange={(e) => { setStageFilter(e.target.value); setPage(1); }}>
          <option value="">All stages</option>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select style={styles.filter} aria-label="Filter by source" value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}>
          <option value="">All sources</option>
          {Object.entries(LEAD_SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          <option value="none">No source</option>
        </select>
        <select style={styles.filter} aria-label="Filter by assigned staff" value={ownerFilter} onChange={(e) => { setOwnerFilter(e.target.value); setPage(1); }}>
          <option value="">Anyone</option>
          <option value="me">Mine</option>
          <option value="none">Unassigned</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.first_name} {o.last_name}</option>)}
        </select>
        <label style={styles.check}>
          <input type="checkbox" checked={archived} onChange={(e) => { setArchived(e.target.checked); setPage(1); }} />
          Show deleted leads
        </label>
        <span style={styles.spacer} />
        {canSetUp && <Link to="/settings?tab=leads" style={styles.link}>Lead stages (Settings)</Link>}
        {canEdit && <Button onClick={() => setAdding(true)}>Add lead</Button>}
      </div>

      <p style={styles.count} aria-live="polite">{loading ? ' ' : `${total} ${archived ? 'deleted ' : ''}${total === 1 ? 'lead' : 'leads'}`}</p>
      {message && <p style={styles.message} role="status">{message}</p>}

      <Table
        columns={columns}
        data={leads}
        loading={loading}
        onRowClick={(row) => navigate(`/customers/${row.id}`)}
        onSort={(key, o) => { setSort(key); setOrder(o); setPage(1); }}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        emptyMessage={archived ? 'No deleted leads' : 'No leads'}
        mobileCardMode
      />

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => { if (toDelete) deleteLead(toDelete); }}
        title="Delete lead"
        message={toDelete ? `Delete ${fullName(toDelete)}? They leave the Leads list and can be restored later from "Show deleted leads".` : ''}
        confirmLabel="Delete lead"
      />

      {adding && (
        <AddLeadModal
          businessId={businessId}
          stages={stages}
          owners={owners}
          tags={tags}
          onClose={() => setAdding(false)}
          onAdded={(lead) => { setAdding(false); setMessage(`${fullName(lead)} was added.`); load(); }}
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
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '', lead_source: '', lead_stage_id: stages[0]?.id || '', owner_user_id: '',
  });
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setError('');
    if (!form.first_name.trim()) { setError('First name is required'); return; }
    if (!form.email.trim() && !form.phone.trim()) { setError('An email address or a phone number is required'); return; }
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
      setError(err.response?.data?.error || 'The lead could not be added');
    } finally { setSaving(false); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add lead"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button loading={saving} onClick={save}>Add lead</Button>
      </>}
    >
      <div style={styles.form}>
        <div style={styles.formRow}>
          <label style={styles.field}>First name *<input style={styles.input} value={form.first_name} onChange={set('first_name')} /></label>
          <label style={styles.field}>Last name<input style={styles.input} value={form.last_name} onChange={set('last_name')} /></label>
        </div>
        <div style={styles.formRow}>
          <label style={styles.field}>Email<input style={styles.input} type="email" value={form.email} onChange={set('email')} /></label>
          <label style={styles.field}>Phone<input style={styles.input} type="tel" value={form.phone} onChange={set('phone')} /></label>
        </div>
        <p style={styles.hint}>An email address or a phone number is required.</p>
        <div style={styles.formRow}>
          <label style={styles.field}>Lead source
            <select style={styles.input} value={form.lead_source} onChange={set('lead_source')}>
              <option value="">—</option>
              {Object.entries(LEAD_SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label style={styles.field}>Lead stage
            <select style={styles.input} value={form.lead_stage_id} onChange={set('lead_stage_id')}>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
        <label style={styles.field}>Assigned staff
          <select style={styles.input} value={form.owner_user_id} onChange={set('owner_user_id')}>
            <option value="">Unassigned</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.first_name} {o.last_name}</option>)}
          </select>
        </label>
        <fieldset style={styles.fieldset}>
          <legend style={styles.legend}>Tags</legend>
          {tags.length === 0 && <span style={styles.hint}>No tags defined yet</span>}
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
