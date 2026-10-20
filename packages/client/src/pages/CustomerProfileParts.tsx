import { useState, useEffect, useRef, useCallback } from 'react';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { Modal } from '../design-system/components/feedback/Modal';
import { apiClient } from '../api/client';
import * as customersApi from '../api/customers';
import type { Customer } from '../api/customers';
import { lifecycleStageLabel } from '@daystream/shared';

/**
 * Parts of the People profile added for Linear THE-16: photo, figures, communication,
 * referrals and reviews cards, the Messages, Tasks and Documents tabs, and the dialogs
 * opened from the More menu.
 */

type Staff = { id: string; first_name: string; last_name: string };

const errorText = (err: any, fallback: string) => err?.response?.data?.error || fallback;

function formatDate(value?: string | null): string {
  return value ? new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';
}
function formatDateTime(value?: string | null): string {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

// --- Photo -------------------------------------------------------------------

/** The person's photo (or initials), with a button to add or change it. */
export function ProfilePhoto({ customer, businessId, initials, onChanged }: {
  customer: Customer; businessId: string; initials: string; onChanged: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    setUrl(null);
    if (customer.has_photo) {
      customersApi.getPhoto(customer.id, businessId)
        .then((blob) => { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); })
        .catch(() => setUrl(null));
    }
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [customer.id, customer.has_photo, businessId]);

  const pick = async (file?: File | null) => {
    if (!file) return;
    setBusy(true); setMessage(null);
    try { await customersApi.uploadPhoto(customer.id, businessId, file); onChanged(); }
    catch (err) { setMessage(errorText(err, 'The photo could not be saved')); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {url
        ? <img src={url} alt="" style={{ ...parts.avatar, objectFit: 'cover' }} />
        : <div style={parts.avatar}>{initials}</div>}
      <button
        type="button" title={customer.has_photo ? 'Change photo' : 'Add photo'} aria-label={customer.has_photo ? 'Change photo' : 'Add photo'}
        onClick={() => input.current?.click()} disabled={busy} style={parts.photoButton}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
      </button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
      {message && <span role="alert" style={{ position: 'absolute', top: '100%', left: 0, width: '220px', fontSize: 'var(--font-size-xs)', color: 'var(--color-error)' }}>{message}</span>}
    </div>
  );
}

// --- Overview cards ------------------------------------------------------------

export function VisitsCreditsCard({ customerId, businessId }: { customerId: string; businessId: string }) {
  const [figures, setFigures] = useState<customersApi.ProfileFigures | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    customersApi.getProfileFigures(customerId, businessId).then(setFigures).catch(() => setFailed(true));
  }, [customerId, businessId]);
  const cell = (label: string, value?: number) => (
    <div style={parts.figure}><span style={parts.label}>{label}</span><span style={parts.figureValue}>{figures ? value : '…'}</span></div>
  );
  return (
    <div style={parts.card}>
      <h3 style={parts.cardTitle}>Visits &amp; Credits</h3>
      {failed ? <p style={parts.muted}>The figures could not be loaded.</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 'var(--space-md)' }}>
            {cell('Visits', figures?.visits)}{cell('Appointments', figures?.appointments)}{cell('Events', figures?.events)}{cell('Session credits', figures?.session_credits)}
          </div>
          <p style={{ ...parts.muted, marginTop: 'var(--space-sm)' }}>Session credits are the sessions left in packs. Money credit is the Account credit in Financial Summary.</p>
        </>
      )}
    </div>
  );
}

export function CommunicationCard({ preferences, onOpenConsent }: { preferences: any; onOpenConsent: () => void }) {
  const row = (label: string, on?: boolean) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--font-size-sm)' }}>
      <span>{label}</span>
      {preferences ? <Badge variant={on ? 'success' : 'neutral'}>{on ? 'Subscribed' : 'Unsubscribed'}</Badge> : <span style={parts.muted}>…</span>}
    </div>
  );
  return (
    <div style={parts.card}>
      <div style={parts.cardHeader}>
        <h3 style={{ ...parts.cardTitle, margin: 0 }}>Communication</h3>
        <button type="button" onClick={onOpenConsent} style={parts.link}>Change in Consent</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        {row('Marketing emails', preferences?.email_marketing)}
        {row('Transactional emails', preferences?.transactional_emails)}
        {row('Marketing SMS', preferences?.sms_marketing)}
        <span style={parts.muted}>Transactional emails off means no confirmations, cancellations or receipts are sent.</span>
      </div>
    </div>
  );
}

export function ReferralsCard({ customerId, businessId }: { customerId: string; businessId: string }) {
  const [data, setData] = useState<customersApi.Referrals | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { customersApi.getReferrals(customerId, businessId).then(setData).catch(() => setFailed(true)); }, [customerId, businessId]);
  const name = (p: { first_name: string; last_name: string }) => `${p.first_name} ${p.last_name}`.trim();
  return (
    <div style={parts.card}>
      <h3 style={parts.cardTitle}>Referrals</h3>
      {failed && <p style={parts.muted}>Referrals could not be loaded.</p>}
      {!failed && !data && <p style={parts.muted}>Loading…</p>}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', fontSize: 'var(--font-size-sm)' }}>
          <div>Referral code {data.codes[0] ? <strong>{data.codes[0].code}</strong> : <span style={parts.muted}>none yet</span>}</div>
          <div style={parts.muted}>Referred by: {data.referred_by ? name(data.referred_by) : 'nobody'}</div>
          {data.referred.length === 0 && <div style={parts.muted}>Has not referred anyone yet.</div>}
          {data.referred.map((r) => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <a href={`/customers/${r.customer_id}`} style={parts.anchor}>{name(r)}</a>
              <Badge variant="neutral">{lifecycleStageLabel(r.lifecycle_stage)}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReviewsCard({ customer, businessId }: { customer: Customer; businessId: string }) {
  const [reviews, setReviews] = useState<customersApi.Review[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { customersApi.getReviews(customer.id, businessId).then(setReviews).catch(() => setFailed(true)); }, [customer.id, businessId]);
  return (
    <div style={parts.card}>
      <h3 style={parts.cardTitle}>Reviews by {customer.first_name || 'this person'}</h3>
      {failed && <p style={parts.muted}>Reviews could not be loaded.</p>}
      {!failed && !reviews && <p style={parts.muted}>Loading…</p>}
      {reviews && reviews.length === 0 && <p style={parts.muted}>No reviews written yet.</p>}
      {reviews && reviews.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', fontSize: 'var(--font-size-sm)' }}>
          {reviews.map((r) => (
            <div key={r.id}>
              <div>
                <span aria-label={`${r.rating} out of 5`} style={{ color: 'var(--color-warning)' }}>{'★'.repeat(r.rating)}{'☆'.repeat(Math.max(0, 5 - r.rating))}</span>{' '}
                <span style={parts.muted}>{r.service_name ? `${r.service_name} · ` : ''}{formatDate(r.created_at)}</span>
              </div>
              {r.content && <div>“{r.content}”</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Messages tab ------------------------------------------------------------------

export function MessagesTab({ customer }: { customer: Customer }) {
  return (
    <div style={parts.tabContent}>
      <div style={{ ...parts.card, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-sm)', textAlign: 'center', padding: 'var(--space-2xl) var(--space-lg)' }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z" /><path d="M8 9h8M8 12h5" /></svg>
        <strong>Messages will appear here</strong>
        <span style={{ ...parts.muted, maxWidth: '520px' }}>
          The conversation with {customer.first_name || 'this person'} on every channel (email, WhatsApp, SMS) will show here, the same as in the Inbox, once the Inbox is built.
        </span>
      </div>
    </div>
  );
}

// --- Tasks tab ---------------------------------------------------------------------

export function TasksTab({ customer, businessId, staff, addSignal }: { customer: Customer; businessId: string; staff: Staff[]; addSignal: number }) {
  const [tasks, setTasks] = useState<customersApi.CustomerTask[] | null>(null);
  const [view, setView] = useState<'open' | 'done'>('open');
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    customersApi.getTasks(customer.id, businessId).then(setTasks).catch(() => setTasks([]));
  }, [customer.id, businessId]);
  useEffect(() => { load(); }, [load]);
  // The header's Add task button opens the form here.
  useEffect(() => { if (addSignal > 0) setAdding(true); }, [addSignal]);

  const toggle = async (task: customersApi.CustomerTask) => {
    setMessage(null);
    try { await customersApi.setTaskDone(customer.id, businessId, task.id, task.status !== 'done'); load(); }
    catch (err) { setMessage(errorText(err, 'The task could not be updated')); }
  };
  const remove = async (task: customersApi.CustomerTask) => {
    if (!window.confirm(`Delete the task "${task.title}"?`)) return;
    try { await customersApi.deleteTask(customer.id, businessId, task.id); load(); }
    catch (err) { setMessage(errorText(err, 'The task could not be deleted')); }
  };

  const open = (tasks || []).filter((t) => t.status === 'open');
  const done = (tasks || []).filter((t) => t.status === 'done');
  const shown = view === 'open' ? open : done;
  const overdue = (t: customersApi.CustomerTask) => t.status === 'open' && t.due_at && new Date(t.due_at) < new Date();

  return (
    <div style={parts.tabContent}>
      <AddTaskDialog open={adding} onClose={() => setAdding(false)} customer={customer} businessId={businessId} staff={staff} onCreated={() => { setAdding(false); setView('open'); load(); }} />
      <div style={parts.card}>
        <div style={parts.cardHeader}>
          <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
            <button type="button" aria-pressed={view === 'open'} onClick={() => setView('open')} style={{ ...parts.filterBtn, ...(view === 'open' ? parts.filterBtnActive : {}) }}>Open {open.length}</button>
            <button type="button" aria-pressed={view === 'done'} onClick={() => setView('done')} style={{ ...parts.filterBtn, ...(view === 'done' ? parts.filterBtnActive : {}) }}>Done {done.length}</button>
          </div>
          <Button size="sm" onClick={() => setAdding(true)}>Add task</Button>
        </div>
        {message && <p role="alert" style={{ ...parts.muted, color: 'var(--color-error)' }}>{message}</p>}
        {tasks === null && <p style={parts.muted}>Loading…</p>}
        {tasks !== null && shown.length === 0 && <p style={parts.empty}>{view === 'open' ? 'No open tasks.' : 'No finished tasks.'}</p>}
        {shown.length > 0 && (
          <div role="table" aria-label="Tasks">
            <div role="row" style={{ ...parts.taskRow, ...parts.tableHead }}>
              <span role="columnheader" aria-label="Done" /><span role="columnheader">Task</span><span role="columnheader">Due</span><span role="columnheader">Staff</span><span role="columnheader">Reminder</span><span role="columnheader" aria-label="Actions" />
            </div>
            {shown.map((t) => (
              <div role="row" key={t.id} style={{ ...parts.taskRow, borderTop: '1px solid var(--color-border)' }}>
                <span role="cell"><input type="checkbox" aria-label={t.status === 'done' ? `Reopen ${t.title}` : `Mark ${t.title} done`} checked={t.status === 'done'} onChange={() => toggle(t)} style={parts.checkbox} /></span>
                <span role="cell" style={{ minWidth: 0 }}>
                  <strong style={{ textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</strong>
                  {(t.description || t.event_title) && (
                    <span style={{ ...parts.muted, display: 'block' }}>
                      {t.event_title ? `For event: ${t.event_title}${t.event_start ? ` · ${formatDate(t.event_start)}` : ''}` : ''}{t.event_title && t.description ? ' · ' : ''}{t.description}
                    </span>
                  )}
                </span>
                <span role="cell" style={{ fontSize: 'var(--font-size-xs)', color: overdue(t) ? 'var(--color-error)' : 'var(--color-text-secondary)', fontWeight: overdue(t) ? 700 : 400 }}>
                  {t.due_at ? `${overdue(t) ? 'Overdue · ' : ''}${formatDateTime(t.due_at)}` : '—'}
                </span>
                <span role="cell" style={{ fontSize: 'var(--font-size-xs)' }}>{t.staff.map((s) => s.name).join(', ')}</span>
                <span role="cell" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }} title={t.reminder_skipped_reason || undefined}>
                  {!t.send_reminder ? '—' : t.reminder_queued_at ? 'Sent' : `Not sent${t.reminder_skipped_reason ? `: ${t.reminder_skipped_reason}` : ''}`}
                </span>
                <span role="cell"><button type="button" onClick={() => remove(t)} style={parts.removeBtn} aria-label={`Delete ${t.title}`} title="Delete task">×</button></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AddTaskDialog({ open, onClose, customer, businessId, staff, onCreated }: {
  open: boolean; onClose: () => void; customer: Customer; businessId: string; staff: Staff[]; onCreated: () => void;
}) {
  const blank = { title: '', description: '', due_at: '', staff_ids: [] as string[], send_reminder: false, event_id: '' };
  const [form, setForm] = useState(blank);
  const [events, setEvents] = useState<Array<{ id: string; title: string; start_time: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(blank); setMessage(null);
    // Upcoming events to link the task to (only when the login may read events).
    apiClient.get(`/v1/events?business_id=${businessId}&status=published&start_date=${new Date().toISOString().slice(0, 10)}&limit=50`)
      .then((r) => setEvents((r.data.data || []).filter((e: any) => new Date(e.start_time) > new Date())))
      .catch(() => setEvents([]));
  }, [open, businessId]);

  const toggleStaff = (id: string) => setForm((f) => ({ ...f, staff_ids: f.staff_ids.includes(id) ? f.staff_ids.filter((x) => x !== id) : [...f.staff_ids, id] }));
  const canSave = form.title.trim() !== '' && form.staff_ids.length > 0;
  const save = async () => {
    if (!canSave) return;
    setSaving(true); setMessage(null);
    try {
      await customersApi.createTask(customer.id, businessId, {
        title: form.title.trim(), description: form.description || undefined,
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
        staff_ids: form.staff_ids, send_reminder: form.send_reminder, event_id: form.event_id || null,
      });
      onCreated();
    } catch (err) { setMessage(errorText(err, 'The task could not be created')); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add task" footer={(
      <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={!canSave} loading={saving}>Create task</Button>
      </div>
    )}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <div style={parts.formGroup}><label htmlFor="task-title" style={parts.label}>Task title</label><input id="task-title" style={parts.input} value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
        <div style={parts.formGroup}><label htmlFor="task-desc" style={parts.label}>Task description</label><textarea id="task-desc" style={{ ...parts.input, minHeight: '72px', resize: 'vertical' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
          <div style={parts.formGroup}><label htmlFor="task-due" style={parts.label}>Due at</label><input id="task-due" type="datetime-local" style={parts.input} value={form.due_at} onChange={(e) => setForm({ ...form, due_at: e.target.value })} /></div>
          <div style={parts.formGroup}><label htmlFor="task-event" style={parts.label}>Task is for event (optional)</label>
            <select id="task-event" style={parts.input} value={form.event_id} onChange={(e) => setForm({ ...form, event_id: e.target.value })}>
              <option value="">No event</option>
              {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title} · {formatDateTime(ev.start_time)}</option>)}
            </select>
          </div>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ ...parts.label, marginBottom: 'var(--space-xs)' }}>Staff members (one or more)</legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)', maxHeight: '140px', overflowY: 'auto' }}>
            {staff.length === 0 && <span style={parts.muted}>No staff members to assign.</span>}
            {staff.map((s) => {
              const on = form.staff_ids.includes(s.id);
              return (
                <button key={s.id} type="button" aria-pressed={on} onClick={() => toggleStaff(s.id)} style={{ ...parts.chip, ...(on ? parts.chipOn : {}) }}>
                  {on ? '✓ ' : ''}{s.first_name} {s.last_name}
                </button>
              );
            })}
          </div>
        </fieldset>
        <label style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start', fontSize: 'var(--font-size-sm)' }}>
          <input type="checkbox" checked={form.send_reminder} onChange={(e) => setForm({ ...form, send_reminder: e.target.checked })} style={parts.checkbox} />
          <span>Send reminder email to {customer.first_name || 'the customer'}<span style={{ ...parts.muted, display: 'block' }}>Sent when the task is created{customer.email ? `, to ${customer.email}` : ''}.</span></span>
        </label>
        <div style={parts.formGroup}><span style={parts.label}>Task is for</span><div style={{ ...parts.input, background: 'var(--color-surface-hover)' }}><strong>{`${customer.first_name} ${customer.last_name}`.trim()}</strong> <span style={parts.muted}>filled in from this profile</span></div></div>
        {message && <p role="alert" style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-error)' }}>{message}</p>}
      </div>
    </Modal>
  );
}

// --- Documents tab -------------------------------------------------------------------

export function DocumentsTab({ customerId, businessId }: { customerId: string; businessId: string }) {
  const [docs, setDocs] = useState<customersApi.CustomerDocument[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    customersApi.getDocuments(customerId, businessId).then(setDocs).catch(() => setDocs([]));
  }, [customerId, businessId]);
  useEffect(() => { load(); }, [load]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true); setMessage(null);
    try { for (const f of Array.from(files)) await customersApi.uploadDocument(customerId, businessId, f); load(); }
    catch (err) { setMessage(errorText(err, 'The file could not be uploaded')); load(); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const download = async (doc: customersApi.CustomerDocument) => {
    try {
      const blob = await customersApi.downloadDocument(customerId, businessId, doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = doc.file_name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setMessage(errorText(err, 'The file could not be downloaded')); }
  };
  const remove = async (doc: customersApi.CustomerDocument) => {
    if (!window.confirm(`Delete ${doc.file_name}?`)) return;
    try { await customersApi.deleteDocument(customerId, businessId, doc.id); load(); }
    catch (err) { setMessage(errorText(err, 'The file could not be deleted')); }
  };
  const size = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const kind = (m: string) => (m === 'application/pdf' ? 'PDF' : m === 'image/png' ? 'PNG' : 'JPG');

  return (
    <div style={parts.tabContent}>
      <div style={parts.card}>
        <div style={parts.cardHeader}>
          <h3 style={{ ...parts.cardTitle, margin: 0 }}>Documents</h3>
          <Button size="sm" onClick={() => input.current?.click()} loading={busy}>Upload document</Button>
          <input ref={input} type="file" multiple accept="application/pdf,image/jpeg,image/png" hidden onChange={(e) => upload(e.target.files)} />
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files); }}
          style={{ border: `2px dashed ${dragOver ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-md)', padding: 'var(--space-lg)', textAlign: 'center', ...parts.muted, marginBottom: 'var(--space-md)' }}
        >
          Drop files here, or use Upload document · PDF, JPG, PNG · up to 10 MB
        </div>
        {message && <p role="alert" style={{ ...parts.muted, color: 'var(--color-error)' }}>{message}</p>}
        {docs === null && <p style={parts.muted}>Loading…</p>}
        {docs !== null && docs.length === 0 && <p style={parts.empty}>No documents yet.</p>}
        {docs && docs.length > 0 && (
          <div role="table" aria-label="Documents">
            <div role="row" style={{ ...parts.docRow, ...parts.tableHead }}>
              <span role="columnheader">Name</span><span role="columnheader">Type</span><span role="columnheader">Size</span><span role="columnheader">Uploaded by</span><span role="columnheader">Date</span><span role="columnheader" aria-label="Actions" />
            </div>
            {docs.map((d) => (
              <div role="row" key={d.id} style={{ ...parts.docRow, borderTop: '1px solid var(--color-border)' }}>
                <span role="cell" style={{ minWidth: 0, overflowWrap: 'anywhere' }}><button type="button" onClick={() => download(d)} style={parts.link}>{d.file_name}</button></span>
                <span role="cell" style={{ fontSize: 'var(--font-size-xs)' }}>{kind(d.mime_type)}</span>
                <span role="cell" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>{size(d.size_bytes)}</span>
                <span role="cell" style={{ fontSize: 'var(--font-size-xs)' }}>{d.uploaded_by_name || '—'}</span>
                <span role="cell" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>{formatDate(d.created_at)}</span>
                <span role="cell" style={{ display: 'flex', gap: 'var(--space-xs)', justifyContent: 'flex-end' }}>
                  <Button size="sm" variant="secondary" onClick={() => download(d)}>Download</Button>
                  <Button size="sm" variant="secondary" onClick={() => remove(d)}>Delete</Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Dialogs opened from More -----------------------------------------------------------

export function AssignStaffDialog({ open, onClose, customer, businessId, staff, onSaved }: {
  open: boolean; onClose: () => void; customer: Customer; businessId: string; staff: Staff[]; onSaved: (c: Customer) => void;
}) {
  const [value, setValue] = useState(customer.owner_user_id || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (open) { setValue(customer.owner_user_id || ''); setMessage(null); } }, [open, customer.owner_user_id]);
  const save = async () => {
    setSaving(true); setMessage(null);
    try { onSaved(await customersApi.updateCustomer(customer.id, businessId, { owner_user_id: value })); onClose(); }
    catch (err) { setMessage(errorText(err, 'The staff member could not be assigned')); }
    finally { setSaving(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Assign staff member" size="sm" footer={(
      <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={saving}>Assign</Button>
      </div>
    )}>
      <p style={{ ...parts.muted, marginTop: 0 }}>One staff member looks after {customer.first_name || 'this person'}. Same field as “Staff member” in Contact Information.</p>
      <div style={parts.formGroup}>
        <label htmlFor="assign-staff" style={parts.label}>Staff member</label>
        <select id="assign-staff" style={parts.input} value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Unassigned</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
        </select>
      </div>
      {message && <p role="alert" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-error)' }}>{message}</p>}
    </Modal>
  );
}

export function PasswordResetDialog({ open, onClose, customer, businessId, onSent }: {
  open: boolean; onClose: () => void; customer: Customer; businessId: string; onSent: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (open) { setSentTo(null); setMessage(null); } }, [open]);
  const send = async () => {
    setBusy(true); setMessage(null);
    try { setSentTo((await customersApi.requestPasswordReset(customer.id, businessId)).sent_to); onSent(); }
    catch (err) { setMessage(errorText(err, 'The link could not be sent')); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Request password reset" size="sm" footer={(
      <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
        {sentTo ? <Button onClick={onClose}>Done</Button> : (<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={send} loading={busy}>Send link</Button></>)}
      </div>
    )}>
      {sentTo
        ? <p style={{ ...parts.notice, ...parts.noticeOk }}>A link to choose a new password was sent to {sentTo}. It works for 15 minutes.</p>
        : <p style={{ ...parts.muted, marginTop: 0 }}>{customer.first_name || 'This person'} gets an email with a link to choose a new password for their account. This is recorded in the Timeline.</p>}
      {message && <p role="alert" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-error)' }}>{message}</p>}
    </Modal>
  );
}

export function PersonalDataDialog({ open, onClose, customer, businessId, onSent }: {
  open: boolean; onClose: () => void; customer: Customer; businessId: string; onSent: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ sent_to: string; expires_at: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (open) { setResult(null); setMessage(null); setCopied(false); } }, [open]);
  const send = async () => {
    setBusy(true); setMessage(null);
    try { setResult(await customersApi.sendPersonalData(customer.id, businessId)); onSent(); }
    catch (err) { setMessage(errorText(err, 'The personal data could not be sent')); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    if (!result) return;
    try { await navigator.clipboard.writeText(result.password); setCopied(true); } catch { setCopied(false); }
  };
  // Closing forgets the password: it is not stored anywhere and cannot be shown again.
  const close = () => { setResult(null); onClose(); };
  return (
    <Modal open={open} onClose={close} title={result ? 'Personal data sent' : 'Send personal data (GDPR)'} size="sm" footer={(
      <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
        {result ? <Button onClick={close}>Done</Button> : (<><Button variant="secondary" onClick={close}>Cancel</Button><Button onClick={send} loading={busy} disabled={!customer.email}>Send</Button></>)}
      </div>
    )}>
      {!result && (
        <>
          <p style={{ ...parts.muted, marginTop: 0 }}>{customer.first_name || 'This person'} gets an email with a download link to a password-protected file holding all the data the business keeps about them.</p>
          <div style={parts.notice}>
            <div>Sent to <strong>{customer.email || 'no email address'}</strong></div>
            <div>Link valid for <strong>24 hours</strong></div>
          </div>
        </>
      )}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <p style={{ ...parts.notice, ...parts.noticeOk, margin: 0 }}>Email sent to {result.sent_to}. The link works until {formatDateTime(result.expires_at)}.</p>
          <p style={{ ...parts.muted, margin: 0 }}>The file's password is below. Copy it and give it to {customer.first_name || 'the person'} any way you choose (phone, WhatsApp, in person). It is not shown again.</p>
          <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
            <code aria-label="File password" style={{ ...parts.input, flex: 1, fontFamily: 'var(--font-family-mono, monospace)', fontSize: 'var(--font-size-lg)', letterSpacing: '0.06em', display: 'flex', alignItems: 'center' }}>{result.password}</code>
            <Button variant="secondary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
          </div>
        </div>
      )}
      {message && <p role="alert" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-error)' }}>{message}</p>}
    </Modal>
  );
}

const parts: Record<string, React.CSSProperties> = {
  avatar: { width: '56px', height: '56px', borderRadius: 'var(--radius-full)', background: 'var(--color-primary)', color: 'var(--color-primary-contrast)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any },
  photoButton: { position: 'absolute', right: '-4px', bottom: '-4px', width: '24px', height: '24px', borderRadius: 'var(--radius-full)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 },
  card: { padding: 'var(--space-lg)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', minWidth: 0 },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' as const },
  cardTitle: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  label: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  muted: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  empty: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', textAlign: 'center', padding: 'var(--space-lg)' },
  figure: { display: 'flex', flexDirection: 'column' as const, gap: '2px', minWidth: 0 },
  figureValue: { fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)' },
  link: { background: 'none', border: 'none', padding: 0, color: 'var(--color-accent)', cursor: 'pointer', font: 'inherit', fontSize: 'var(--font-size-xs)', fontWeight: 700, textAlign: 'left' as const },
  anchor: { color: 'var(--color-accent)', textDecoration: 'none' },
  tabContent: { padding: 'var(--space-md) 0' },
  filterBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 10px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  filterBtnActive: { border: '1px solid var(--color-primary)', color: 'var(--color-primary)', background: 'var(--color-surface-hover)', fontWeight: 700 },
  tableHead: { fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)' as any, color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', paddingBottom: 'var(--space-xs)' },
  taskRow: { display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr) 180px 200px 120px 32px', gap: 'var(--space-sm)', alignItems: 'center', padding: 'var(--space-sm) 0', fontSize: 'var(--font-size-sm)' },
  docRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 60px 80px 160px 120px 190px', gap: 'var(--space-sm)', alignItems: 'center', padding: 'var(--space-sm) 0', fontSize: 'var(--font-size-sm)' },
  checkbox: { width: '20px', height: '20px', cursor: 'pointer', accentColor: 'var(--color-primary)', margin: 0, flexShrink: 0 },
  removeBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-lg)', color: 'var(--color-error)', padding: '2px 6px', lineHeight: 1 },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  input: { backgroundColor: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '8px 12px', color: 'var(--color-text)', fontSize: 'var(--font-size-base)', width: '100%', boxSizing: 'border-box' as const, fontFamily: 'var(--font-family)' },
  chip: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-full)', padding: '4px 12px', fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  chipOn: { background: 'var(--color-surface-hover)', border: '1px solid var(--color-primary)', color: 'var(--color-primary)' },
  notice: { padding: 'var(--space-sm) var(--space-md)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)', fontSize: 'var(--font-size-sm)', display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  noticeOk: { background: 'var(--color-success-bg)', color: 'var(--color-success-dark)', fontWeight: 600 },
};
