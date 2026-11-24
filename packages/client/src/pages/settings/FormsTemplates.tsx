import { useState, useEffect, useCallback } from 'react';
import { Button } from '../../design-system/components/actions/Button';
import { Modal } from '../../design-system/components/feedback/Modal';
import { LANGUAGE_OPTIONS } from '@daystream/shared';
import { LanguageSelect } from '../../components/LanguageSelect';
import { FormTemplateEditor } from './FormTemplateEditor';
import { FormRenderer } from '../../components/forms/FormRenderer';
import * as formsApi from '../../api/forms';
import * as systemApi from '../../api/systemTemplates';
import type { Form, SystemForm } from '../../api/forms';

/**
 * The "Forms" type on the Templates tab (spec 51, gap 1): the business's forms in the same list
 * style as the other templates, with Edit, Duplicate, Add language and Delete (archive).
 */
export function FormsTemplates({ businessId, onDirtyChange, kind = 'form', scope = 'business' }: {
  businessId: string;
  /** 'system': the platform's system forms or chart templates (spec 51, gap 17). */
  scope?: 'business' | 'system';
  /** 'chart' lists the clinical chart templates (spec 51, gap 2) instead of forms. */
  kind?: 'form' | 'chart';
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [forms, setForms] = useState<Form[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which form is open in the builder: a form, 'new', or nothing.
  const [editing, setEditing] = useState<Form | 'new' | null>(null);
  const [langTarget, setLangTarget] = useState<Form | null>(null);
  const [newLang, setNewLang] = useState('');
  const [busy, setBusy] = useState(false);
  // Unsaved changes in the open builder; switching to another row asks first.
  const [editorDirty, setEditorDirty] = useState(false);
  const handleDirty = useCallback((d: boolean) => { setEditorDirty(d); onDirtyChange?.(d); }, [onDirtyChange]);
  const open = (target: Form | 'new') => {
    if (editorDirty && !confirm('Discard your unsaved changes?')) return;
    setEditing(target);
  };

  const isChart = kind === 'chart';
  const isSystem = scope === 'system';
  const noun = isChart ? 'chart template' : 'form';
  // A business also sees the platform's active system forms, read only, to preview and duplicate.
  const [systemForms, setSystemForms] = useState<SystemForm[]>([]);
  const [preview, setPreview] = useState<SystemForm | null>(null);
  const [copying, setCopying] = useState<string | null>(null);

  const load = useCallback(() => {
    const own = isSystem
      ? systemApi.listAdminSystemForms(kind).then((list) => list.map(formsApi.systemFormAsForm))
      : formsApi.listForms(businessId, kind);
    own.then(setForms)
      .catch(() => setError(`Could not load the ${noun}s.`))
      .finally(() => setLoading(false));
    if (!isSystem) formsApi.listSystemForms(businessId, kind).then(setSystemForms).catch(() => setSystemForms([]));
  }, [businessId, kind, noun, isSystem]);

  // Duplicate a system form into the business and open the copy (not active, applying to nothing yet).
  const copyFromSystem = async (f: SystemForm) => {
    setCopying(f.id); setError(null);
    try { const created = await formsApi.copySystemForm(businessId, f.id); load(); setEditorDirty(false); setEditing(created); }
    catch (e) { fail(e); } finally { setCopying(null); }
  };
  useEffect(() => { load(); }, [load]);

  const fail = (e: unknown) => {
    const err = e as { response?: { data?: { error?: string } }; message?: string };
    setError(err.response?.data?.error || err.message || 'Something went wrong.');
  };

  const handleDuplicate = async (f: Form) => {
    setError(null);
    try {
      if (isSystem) await systemApi.createAdminSystemForm(kind, { name: `${f.name} (Copy)`, language: f.language, definition: f.definition, is_active: false });
      else await formsApi.duplicateForm(businessId, f.id);
      load();
    } catch (e) { fail(e); }
  };

  const handleDelete = async (f: Form) => {
    const label = f.language ? `${f.name} (${f.language})` : f.name;
    if (!confirm(isChart
      ? `Delete chart template "${label}"? Charts already written from it are kept.`
      : `Delete form "${label}"? Forms customers already completed are kept.`)) return;
    setError(null);
    try { if (isSystem) await systemApi.deleteAdminSystemForm(f.id); else await formsApi.deleteForm(businessId, f.id); if (editing && editing !== 'new' && editing.id === f.id) setEditing(null); load(); } catch (e) { fail(e); }
  };

  const openLanguage = (f: Form) => {
    if (editorDirty && !confirm('Discard your unsaved changes?')) return;
    const used = new Set(forms.filter((x) => x.groupId === f.groupId).map((x) => x.language));
    const free = LANGUAGE_OPTIONS.find((l) => !used.has(l.code));
    setNewLang(free?.code ?? '');
    setLangTarget(f);
  };

  const handleAddLanguage = async () => {
    if (!langTarget || !newLang) return;
    setBusy(true); setError(null);
    try {
      const created = await formsApi.addFormLanguageVersion(businessId, langTarget.id, newLang);
      setLangTarget(null);
      load();
      setEditorDirty(false);
      setEditing(created);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  if (loading) return <p style={s.muted}>Loading...</p>;

  const usedForTarget = langTarget
    ? new Set(forms.filter((x) => x.groupId === langTarget.groupId).map((x) => x.language))
    : new Set<string | null>();
  const availableLanguages = LANGUAGE_OPTIONS.filter((l) => !usedForTarget.has(l.code));

  return (
    <div>
      <p style={s.description}>
        {isChart ? (
          <>
            Build the chart templates your practitioners fill in about a customer, for example SOAP notes or a
            treatment record. Charts are private to staff who work with clients, are stored encrypted, and
            are locked when a practitioner signs them off.
          </>
        ) : (
          <>
            Build the forms and waivers your customers complete: intake questions, health history, or a
            waiver with an "I agree" box and signature. Each form can have a version per language.
            Completed forms are saved as a PDF in the customer's folder.
          </>
        )}
      </p>
      {error && <p style={s.error} role="alert">{error}</p>}

      {/* The lists on the left at a set width, the open builder on the right (owner, 24 Nov 2026) */}
      <div style={s.split}>
      <div style={s.splitList}>
      {/* The platform's system forms, read only: Preview and Duplicate (spec 51, gap 17) */}
      {!isSystem && systemForms.length > 0 && (
        <>
          <div style={s.listHeader}>
            <h3 style={s.subTitle}>{isChart ? 'System chart templates' : 'System forms'}</h3>
          </div>
          <p style={s.helper}>Starting points from the platform. Duplicate one to make your own copy, then choose when it is needed.</p>
          <div style={s.list}>
            {systemForms.map((f) => (
              <div key={f.id} style={s.listRow}>
                <div style={s.listInfo}>
                  <span style={s.listName}>{f.name}</span>
                  <span style={s.tag}>System</span>
                  {!isChart && f.signed && <span style={s.tag}>Signed</span>}
                </div>
                <div style={s.listActions}>
                  <Button size="sm" variant="secondary" onClick={() => setPreview(f)}>Preview</Button>
                  <Button size="sm" variant="ghost" loading={copying === f.id} onClick={() => { if (editorDirty && !confirm('Discard your unsaved changes?')) return; copyFromSystem(f); }}>Duplicate</Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <div style={s.listHeader}>
        <h3 style={s.subTitle}>{isChart ? 'Charts' : 'Forms'}</h3>
        <Button size="sm" onClick={() => open('new')}>{isChart ? 'New chart template' : 'New form'}</Button>
      </div>

      {forms.length === 0 ? (
        <p style={s.muted}>{isChart
          ? 'No chart templates yet. Create one to start recording treatments.'
          : 'No forms yet. Create one to start collecting waivers and intake answers.'}</p>
      ) : (
        <div style={s.list}>
          {forms.map((f) => (
            <div key={f.id} style={{ ...s.listRow, marginLeft: f.language ? 'var(--space-lg)' : 0, ...(editing !== null && editing !== 'new' && editing.id === f.id ? s.listRowOpen : {}) }}
              aria-current={editing !== null && editing !== 'new' && editing.id === f.id ? 'true' : undefined}>
              <div style={s.listInfo}>
                <span style={s.listName}>{f.name}</span>
                {f.language && <span style={s.tag}>{f.language}</span>}
                {!isChart && f.signed && <span style={s.tag}>Signed</span>}
                <span style={{ ...s.statusTag, color: f.isActive ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                  {f.isActive ? '● Active' : '○ Inactive'}
                </span>
              </div>
              <div style={s.listActions}>
                <Button size="sm" variant="secondary" onClick={() => open(f)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => handleDuplicate(f)}>Duplicate</Button>
                {!isChart && !isSystem && <Button size="sm" variant="ghost" onClick={() => openLanguage(f)}>Add language</Button>}
                <Button size="sm" variant="ghost" onClick={() => handleDelete(f)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      </div>

      {editing && (
        <div style={s.splitEditor}>
          <FormTemplateEditor
            key={editing === 'new' ? 'new' : editing.id}
            businessId={businessId}
            form={editing === 'new' ? null : editing}
            kind={kind}
            scope={scope}
            onSaved={() => { setEditing(null); load(); }}
            onCancel={() => setEditing(null)}
            onDirtyChange={handleDirty}
          />
        </div>
      )}
      </div>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={`Preview — ${preview?.name ?? ''}`} size="lg">
        {preview && (
          <>
            <p style={s.helper}>Read only. Duplicate it to make your own copy you can change.</p>
            <FormRenderer definition={preview.definition} idPrefix="system-preview" answers={{}} onChange={() => undefined} disabled />
          </>
        )}
      </Modal>

      <Modal open={!!langTarget} onClose={() => setLangTarget(null)} title="Add a language version" size="sm">
        {availableLanguages.length === 0 ? (
          <p style={s.muted}>This form already has every language the list offers.</p>
        ) : (
          <>
            <p style={s.helper}>
              This copies "{langTarget?.name}" into a new version for you to translate. It stays inactive
              until you switch it on.
            </p>
            <label style={s.label} htmlFor="frm-new-lang">Language</label>
            <LanguageSelect id="frm-new-lang" style={s.select} value={newLang} onChange={setNewLang}
              exclude={[...usedForTarget].filter((l): l is string => !!l)} />
            <div style={s.modalActions}>
              <Button onClick={handleAddLanguage} loading={busy} disabled={!newLang}>Add and edit</Button>
              <Button variant="ghost" onClick={() => setLangTarget(null)} disabled={busy}>Cancel</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  description: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-lg) 0', lineHeight: 1.5, maxWidth: '640px' },
  subTitle: { margin: 0, fontSize: 'var(--font-size-h4, 1.125rem)', fontWeight: 600, color: 'var(--color-text)' },
  muted: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)' },
  error: { color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-md) 0' },
  helper: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-md) 0' },
  label: { display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', marginBottom: '4px' },
  select: { padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', fontSize: 'var(--font-size-base)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', minWidth: '240px' },
  listHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: 'var(--space-lg) 0 var(--space-sm) 0' },
  list: { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: 'var(--space-lg)' },
  listRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '12px 16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', background: 'var(--color-surface)' },
  listInfo: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
  listName: { fontWeight: 600, color: 'var(--color-text)', fontSize: 'var(--font-size-base)' },
  tag: { fontSize: 'var(--font-size-xs)', padding: '2px 8px', borderRadius: 'var(--radius-full, 9999px)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' },
  statusTag: { fontSize: 'var(--font-size-xs)' },
  listActions: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  // Lists on the left at a set width, the open builder on the right; stacked when there is no room.
  split: { display: 'flex', alignItems: 'flex-start', gap: 'var(--space-lg)', flexWrap: 'wrap' },
  splitList: { flex: '0 0 340px', minWidth: 0, maxWidth: '100%' },
  splitEditor: { flex: '1 1 480px', minWidth: 0, paddingTop: 'var(--space-sm)' },
  listRowOpen: { borderColor: 'var(--color-primary)', boxShadow: 'inset 3px 0 0 var(--color-primary)' },
  modalActions: { display: 'flex', gap: '12px', marginTop: 'var(--space-lg)' },
};
