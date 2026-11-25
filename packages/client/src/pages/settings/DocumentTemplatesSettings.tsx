import { askConfirm } from '../../design-system/components/feedback/dialogs';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { Button } from '../../design-system/components/actions/Button';
import { Modal } from '../../design-system/components/feedback/Modal';
import { RichTextEditor, RichTextEditorHandle, sanitizeRichText } from '../../design-system/components/forms/RichTextEditor';
import { BrandedDocumentView } from '../../components/BrandedDocumentView';
import { DETAILS_TABLE_TOKEN } from '@daystream/shared';
import { LanguageSelect } from '../../components/LanguageSelect';
import { useBusinessLanguages } from '../../context/useBusinessLanguages';
import { useContextManager } from '../../context/ContextManager';
import { FormsTemplates } from './FormsTemplates';
import { CheckInTextTemplates } from './CheckInTextTemplates';
import { useClinicalAccess } from '../../utils/useClinicalAccess';
import * as payApi from '../../api/payments';
import * as systemApi from '../../api/systemTemplates';
import type {
  DocumentArtifactType,
  DocumentPlaceholder,
  DocumentBrandingTemplate,
  DocumentBrandingInput,
} from '../../api/payments';

/**
 * Document branding "Templates" editor (spec 10, task 6.3 / Requirement C12).
 *
 * A config-driven framework — like the Reports framework — where the shared
 * artifact catalog (fetched from the server) declares every brandable document
 * type and its insertable placeholders. The editor is generic: pick an artifact
 * type, manage its named templates, and edit fields. Adding a new document type
 * later is a catalog entry on the server, not a change here.
 *
 * We prove the framework end-to-end with the first artifact type (Invoice);
 * everything built here applies identically to the rest.
 *
 * Field types:
 *   - Subject / Footer: plain text (email subjects can't be HTML; footers stay simple).
 *   - Body: a constrained rich-text HTML subset (bold/italic/underline/lists/headings)
 *     via RichTextEditor, so businesses can format the message without breaking
 *     email/PDF rendering.
 * Primary/secondary colors are the document's brand accents (header bar + headings
 * / footer rule) — the Preview makes this visible.
 */

/** The Document Type dropdown's extra entry for the business's forms (spec 51); not a branded artifact. */
const FORMS_TYPE = 'forms';
/** The extra entry for clinical chart templates (spec 51, gap 2); only offered to clinical roles. */
const CHARTS_TYPE = 'charts';
/** The extra entry for the words on the customer check-in screens (spec 51, gap 3). */
const CHECKIN_TEXT_TYPE = 'checkin-screen';

/** The editable fields; mirrors the server DocumentBrandingInput (snake_case). */
interface EditForm {
  name: string;
  language: string;
  is_active: boolean;
  logo_url: string;
  color_primary: string;
  color_secondary: string;
  sender_name: string;
  reply_to: string;
  subject_template: string;
  body_template: string;
  footer_text: string;
  footer_link_text: string;
  footer_link_url: string;
}

const EMPTY_FORM: EditForm = {
  name: 'Default',
  language: '',
  is_active: true,
  logo_url: '',
  color_primary: '',
  color_secondary: '',
  sender_name: '',
  reply_to: '',
  subject_template: '',
  body_template: '',
  footer_text: '',
  footer_link_text: '',
  footer_link_url: '',
};

function toForm(t: DocumentBrandingTemplate): EditForm {
  return {
    name: t.name,
    language: t.language ?? '',
    is_active: t.isActive,
    logo_url: t.logoUrl ?? '',
    color_primary: t.colorPrimary ?? '',
    color_secondary: t.colorSecondary ?? '',
    sender_name: t.senderName ?? '',
    reply_to: t.replyTo ?? '',
    subject_template: t.subjectTemplate ?? '',
    body_template: t.bodyTemplate ?? '',
    footer_text: t.footerText ?? '',
    footer_link_text: t.footerLinkText ?? '',
    footer_link_url: t.footerLinkUrl ?? '',
  };
}

function toInput(f: EditForm): DocumentBrandingInput {
  return {
    name: f.name,
    language: f.language || null,
    is_active: f.is_active,
    logo_url: f.logo_url || null,
    color_primary: f.color_primary || null,
    color_secondary: f.color_secondary || null,
    sender_name: f.sender_name || null,
    reply_to: f.reply_to || null,
    subject_template: f.subject_template || null,
    body_template: f.body_template ? sanitizeRichText(f.body_template) : null,
    footer_text: f.footer_text || null,
    footer_link_text: f.footer_link_text || null,
    footer_link_url: f.footer_link_url || null,
  };
}

/** Plain-text fields a placeholder chip can be inserted into via caret math. */
type PlainField = 'subject_template' | 'footer_text' | 'footer_link_text' | 'footer_link_url';

/** Default accents when the business leaves colors blank (uses theme tokens). */
const DEFAULT_PRIMARY = '#1A1A1A';
const DEFAULT_SECONDARY = '#C9A96E';

/** Preset swatches for the color picker (brand-ish neutrals + accents). */
const COLOR_PRESETS = ['#1A1A1A', '#4A90A4', '#C9A96E', '#2E7D32', '#D32F2F', '#6B4FBB', '#0D6E6E', '#B8945A'];

/** Replace every {{token}} with its catalog sample value, for the preview. */
function fillSamples(text: string, placeholders: DocumentPlaceholder[]): string {
  // The details-table token is a placement marker, not a text value — leave it
  // literal so the preview can draw a sample table where the user placed it.
  const map = new Map(placeholders.filter((p) => p.token !== DETAILS_TABLE_TOKEN).map((p) => [p.token, p.sample]));
  return text.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, token) =>
    map.has(token) ? (map.get(token) as string) : `{{${token}}}`,
  );
}

/** Sample rows so {{details_table}} shows a realistic table in the editor preview (the words come from the templates file). */
const sampleDetailsTable = (t: (key: string) => string) => ({
  rows: [
    { description: t('documents.sampleRow1'), qty: 1, amountCents: 4500 },
    { description: t('documents.sampleRow2'), qty: 2, amountCents: 3000 },
  ],
  totalCents: 10500,
  currency: 'EUR',
});

/**
 * Templates keep their own Save (David, 2026-11-02, decision 9). `onDirtyChange` tells the page
 * whether an open template has unsaved changes, so leaving can ask first.
 */
export function DocumentTemplatesSettings({ onDirtyChange, scope = 'business' }: {
  onDirtyChange?: (dirty: boolean) => void;
  /** 'system': the platform's templates, on System Configuration → Templates (spec 51, gap 17). */
  scope?: 'business' | 'system';
} = {}) {
  const { t } = useTranslation('templates');
  // The document types and their placeholders come from the shared English catalogue; the words shown are looked up by key with that English as the default.
  const typeLabel = (c: DocumentArtifactType) => t(`types.${c.key}.label`, { defaultValue: c.label });
  const typeDescription = (c: DocumentArtifactType) => t(`types.${c.key}.description`, { defaultValue: c.description });
  const phText = (typeKey: string, p: DocumentPlaceholder, field: 'label' | 'description' | 'sample') =>
    t([`types.${typeKey}.placeholders.${p.token}.${field}`, `placeholders.${p.token}.${field}`], { defaultValue: p[field] });
  const businessId = useContextManager().activeContext.businessId || '';
  const canUseCharts = useClinicalAccess();
  const isSystem = scope === 'system';
  const { languages: businessLanguages } = useBusinessLanguages();
  const languages = isSystem ? undefined : businessLanguages;
  // Where templates are read and saved: the business's own, or the platform's system templates.
  const api = useMemo(() => (isSystem ? {
    types: () => systemApi.getSystemArtifactTypes(),
    list: (type: string) => systemApi.listSystemTemplates(type),
    create: (type: string, input: DocumentBrandingInput) => systemApi.createSystemTemplate(type, input),
    update: (id: string, input: DocumentBrandingInput) => systemApi.updateSystemTemplate(id, input),
    remove: (id: string) => systemApi.deleteSystemTemplate(id),
  } : {
    types: () => payApi.getDocumentArtifactTypes(),
    list: (type: string) => payApi.listDocumentTemplates(businessId, type),
    create: (type: string, input: DocumentBrandingInput) => payApi.createDocumentTemplate(businessId, type, input),
    update: (id: string, input: DocumentBrandingInput) => payApi.updateDocumentTemplate(businessId, id, input),
    remove: (id: string) => payApi.deleteDocumentTemplate(businessId, id),
  }), [isSystem, businessId]);
  // A business also sees the platform's active system templates, read only (spec 51, gap 17).
  const [systemTemplates, setSystemTemplates] = useState<DocumentBrandingTemplate[]>([]);
  const [copying, setCopying] = useState<string | null>(null);
  // What the Preview shows: the template being edited, or a system template (read only).
  const [previewForm, setPreviewForm] = useState<EditForm | null>(null);

  const [catalog, setCatalog] = useState<DocumentArtifactType[]>([]);
  const [artifactType, setArtifactType] = useState<string>('');
  const [templates, setTemplates] = useState<DocumentBrandingTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editor state: which template is open (or 'new'), the working form, saving flag.
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);
  // The form as it was opened, to tell whether it has been changed.
  const [openedForm, setOpenedForm] = useState<EditForm>(EMPTY_FORM);
  const dirty = editingId !== null && JSON.stringify(form) !== JSON.stringify(openedForm);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Which field last had focus, so a placeholder chip knows where to insert.
  const lastFocused = useRef<PlainField | 'body'>('body');
  const plainRefs = useRef<Record<PlainField, HTMLInputElement | null>>({
    subject_template: null,
    footer_text: null,
    footer_link_text: null,
    footer_link_url: null,
  });
  const bodyRef = useRef<RichTextEditorHandle>(null);

  const selectedType = catalog.find((c) => c.key === artifactType);

  // Load the artifact catalog once.
  useEffect(() => {
    api.types()
      .then((cat) => {
        setCatalog(cat);
        if (cat.length > 0) setArtifactType(cat[0].key);
      })
      .catch(() => setError(t('documents.loadTypesFailed')))
      .finally(() => setLoading(false));
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTemplates = useCallback(() => {
    if ((!isSystem && !businessId) || !artifactType || artifactType === FORMS_TYPE || artifactType === CHARTS_TYPE || artifactType === CHECKIN_TEXT_TYPE) return;
    api.list(artifactType)
      .then(setTemplates)
      .catch(() => setError(t('documents.loadFailed')));
    if (!isSystem) {
      payApi.listSystemDocumentTemplates(businessId, artifactType)
        .then(setSystemTemplates)
        .catch(() => setSystemTemplates([]));
    }
  }, [api, isSystem, businessId, artifactType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Duplicate a system template into the business and open the copy (not active yet).
  const copyFromSystem = async (t: DocumentBrandingTemplate) => {
    if (!(await keepOrDiscard())) return;
    setCopying(t.id); setError(null);
    try {
      const created = await payApi.copySystemDocumentTemplate(businessId, t.id);
      loadTemplates();
      void openEdit(created);
    } catch (e: unknown) { setError(saveErr(e)); }
    finally { setCopying(null); }
  };

  // Reload templates whenever the selected artifact type changes.
  useEffect(() => {
    setEditingId(null);
    loadTemplates();
  }, [loadTemplates]);

  // With the editor beside the list, opening another row would drop unsaved changes; ask first.
  const keepOrDiscard = async (): Promise<boolean> => !dirty || askConfirm({ message: t('documents.discardConfirm'), confirmLabel: t('common:action.discard'), destructive: true });

  const openNew = async () => {
    if (!(await keepOrDiscard())) return;
    setForm({ ...EMPTY_FORM, name: t('documents.newTemplate') });
    setOpenedForm({ ...EMPTY_FORM, name: t('documents.newTemplate') });
    setEditingId('new');
  };

  const openEdit = async (t: DocumentBrandingTemplate) => {
    if (!(await keepOrDiscard())) return;
    setForm(toForm(t));
    setOpenedForm(toForm(t));
    setEditingId(t.id);
  };

  // Duplicate: open the editor pre-filled from an existing template as a NEW one
  // (name suffixed "(Copy)"), so a business can tweak seasonal details and save a
  // fresh variant without re-entering everything. Saving creates a new template.
  const openDuplicate = async (tpl: DocumentBrandingTemplate) => {
    if (!(await keepOrDiscard())) return;
    setForm({ ...toForm(tpl), name: t('documents.copyName', { name: tpl.name }) });
    setOpenedForm({ ...toForm(tpl), name: t('documents.copyName', { name: tpl.name }) });
    setEditingId('new');
  };

  const closeEditor = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setOpenedForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError(t('documents.nameRequired')); return; }
    setSaving(true); setError(null);
    try {
      if (editingId === 'new') {
        await api.create(artifactType, toInput(form));
      } else if (editingId) {
        await api.update(editingId, toInput(form));
      }
      loadTemplates();
      closeEditor();
    } catch (e: unknown) {
      setError(saveErr(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (tpl: DocumentBrandingTemplate) => {
    if (!(await askConfirm({ message: t('documents.confirmDelete', { name: tpl.name }), confirmLabel: t('common:action.delete'), destructive: true }))) return;
    try {
      await api.remove(tpl.id);
      if (editingId === tpl.id) closeEditor();
      loadTemplates();
    } catch (e: unknown) {
      setError(saveErr(e));
    }
  };

  /** Insert a {{token}} into whichever field last had focus. */
  const insertPlaceholder = (ph: DocumentPlaceholder) => {
    const token = `{{${ph.token}}}`;
    if (lastFocused.current === 'body') {
      bodyRef.current?.insertText(token);
      return;
    }
    const field = lastFocused.current;
    const el = plainRefs.current[field];
    const current = form[field];
    if (el && typeof el.selectionStart === 'number') {
      const start = el.selectionStart;
      const end = el.selectionEnd ?? start;
      const next = current.slice(0, start) + token + current.slice(end);
      setForm((f) => ({ ...f, [field]: next }));
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      setForm((f) => ({ ...f, [field]: current + token }));
    }
  };

  if (loading) return <p style={s.muted}>{t('common:loading')}</p>;

  if (!isSystem && !businessId) {
    return <p style={s.muted}>{t('documents.selectBusiness')}</p>;
  }

  // Which template the business's emails of this type use now (criterion 4).
  const ownActive = templates.find((t) => t.isActive);
  const usedNote = isSystem ? null
    : ownActive ? t('documents.usedOwn', { name: ownActive.name })
    : systemTemplates[0] ? t('documents.usedSystem', { name: systemTemplates[0].name })
    : t('documents.usedNone');


  // Artifact type selector
  const typePicker = (
    <div style={s.field}>
      <label style={s.label} htmlFor="artifact-type">{t('documents.documentType')}</label>
      <select
        id="artifact-type"
        style={s.select}
        value={artifactType}
        onChange={(e) => setArtifactType(e.target.value)}
      >
        {catalog.map((c) => (
          <option key={c.key} value={c.key}>{typeLabel(c)}</option>
        ))}
        {/* The same types on System Configuration as on a business (spec 51, gap 17, criterion 7) */}
        <option value={FORMS_TYPE}>{t('documents.typeForms')}</option>
        {(isSystem || canUseCharts) && <option value={CHARTS_TYPE}>{t('documents.typeCharts')}</option>}
        <option value={CHECKIN_TEXT_TYPE}>{t('documents.typeCheckIn')}</option>
      </select>
      {selectedType && <span style={s.helper}>{typeDescription(selectedType)}</span>}
    </div>
  );
  const splitLayout = artifactType !== CHECKIN_TEXT_TYPE && artifactType !== FORMS_TYPE && artifactType !== CHARTS_TYPE;

  return (
    <div style={s.section}>
      <h2 style={s.title}>{isSystem ? t('documents.titleSystem') : t('documents.titleBusiness')}</h2>
      <p style={s.description}>
        {t(isSystem ? 'documents.introSystem' : 'documents.introBusiness')}
      </p>

      {error && <p style={s.error} role="alert">{error}</p>}

      {/* The document type picker: above Forms, Charts and Check-In; at the top of the left column for the other types */}
      {!splitLayout && typePicker}

      {artifactType === CHECKIN_TEXT_TYPE ? (
        <CheckInTextTemplates businessId={businessId} onDirtyChange={onDirtyChange} scope={scope} />
      ) : artifactType === FORMS_TYPE || artifactType === CHARTS_TYPE ? (
        <FormsTemplates key={`${scope}-${artifactType}`} businessId={businessId} onDirtyChange={onDirtyChange}
          kind={artifactType === CHARTS_TYPE ? 'chart' : 'form'} scope={scope} />
      ) : (<>
      {/* The lists on the left at a set width, the open template on the right (owner, 24 Nov 2026) */}
      <div style={s.split}>
      <div style={s.splitList}>
      {typePicker}
      {/* The platform's system templates, read only: Preview and Duplicate (spec 51, gap 17) */}
      {!isSystem && systemTemplates.length > 0 && (
        <>
          <div style={s.listHeader}>
            <h3 style={s.subTitle}>{t('documents.systemTemplates')}</h3>
          </div>
          <div style={s.list}>
            {systemTemplates.map((tpl) => (
              <div key={tpl.id} style={s.listRow}>
                <div style={s.listInfo}>
                  <span style={s.listName}>{tpl.name}</span>
                  <span style={s.langTag}>{t('documents.system')}</span>
                  {tpl.language && <span style={s.langTag}>{tpl.language}</span>}
                </div>
                <div style={s.listActions}>
                  <Button size="sm" variant="secondary" onClick={() => setPreviewForm(toForm(tpl))}>{t('documents.preview')}</Button>
                  <Button size="sm" variant="ghost" loading={copying === tpl.id} onClick={() => copyFromSystem(tpl)}>{t('documents.duplicate')}</Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {/* Template list */}
      <div style={s.listHeader}>
        <h3 style={s.subTitle}>{t('documents.templates')}</h3>
        <Button size="sm" onClick={openNew}>{t('documents.newTemplate')}</Button>
      </div>

      {usedNote && <p style={s.helper} role="status">{usedNote}</p>}

      {templates.length === 0 ? (
        <p style={s.muted}>{t(isSystem ? 'documents.noSystemTemplate' : 'documents.noTemplates')}</p>
      ) : (
        <div style={s.list}>
          {templates.map((tpl) => (
            <div key={tpl.id} style={{ ...s.listRow, ...(editingId === tpl.id ? s.listRowOpen : {}) }} aria-current={editingId === tpl.id ? 'true' : undefined}>
              <div style={s.listInfo}>
                <span style={s.listName}>{tpl.name}</span>
                {tpl.language && <span style={s.langTag}>{tpl.language}</span>}
                <span style={{ ...s.statusTag, color: tpl.isActive ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                  {tpl.isActive ? t('documents.active') : t('documents.inactive')}
                </span>
              </div>
              <div style={s.listActions}>
                <Button size="sm" variant="secondary" onClick={() => openEdit(tpl)}>{t('common:edit')}</Button>
                <Button size="sm" variant="ghost" onClick={() => openDuplicate(tpl)}>{t('documents.duplicate')}</Button>
                <Button size="sm" variant="ghost" onClick={() => handleDelete(tpl)}>{t('common:delete')}</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      </div>

      {/* Editor, to the right of the lists; its Preview and Save at its top as well as its bottom */}
      {editingId && selectedType && (
        <div style={{ ...s.editor, ...s.splitEditor }}>
          <div style={s.editorHead}>
            <h3 style={s.subTitle}>{editingId === 'new' ? t('documents.newTemplate') : t('documents.editTemplate')}</h3>
            <div style={s.listActions}>
              <Button size="sm" variant="secondary" onClick={() => setPreviewOpen(true)} disabled={saving}>{t('documents.preview')}</Button>
              <Button size="sm" onClick={handleSave} loading={saving}>{editingId === 'new' ? t('documents.createTemplate') : t('documents.saveChanges')}</Button>
            </div>
          </div>

          <div style={s.formGrid}>
            <div style={s.field}>
              <label style={s.label} htmlFor="tmpl-name">{t('documents.name')}<span style={s.req}>*</span></label>
              <input id="tmpl-name" style={s.input} value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div style={s.field}>
              <label style={s.label} htmlFor="tmpl-lang">{t('documents.language')}</label>
              <LanguageSelect languages={languages} id="tmpl-lang" style={s.input} value={form.language}
                onChange={(v) => setForm({ ...form, language: v })} blankLabel={t('documents.defaultNoLanguage')} />
            </div>
          </div>

          <div style={s.field}>
            <label style={s.checkLabel}>
              <input type="checkbox" checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              <span>{t('documents.activeHint')}</span>
            </label>
          </div>

          <div style={s.field}>
            <label style={s.label} htmlFor="tmpl-logo">{t('documents.logoUrl')}</label>
            <input id="tmpl-logo" style={s.input} placeholder="https://..." value={form.logo_url}
              onChange={(e) => setForm({ ...form, logo_url: e.target.value })} />
          </div>

          <div style={s.formGrid}>
            <ColorField label={t('documents.primaryColor')} value={form.color_primary}
              helper={t('documents.primaryColorHelper')}
              onChange={(v) => setForm({ ...form, color_primary: v })} />
            <ColorField label={t('documents.secondaryColor')} value={form.color_secondary}
              helper={t('documents.secondaryColorHelper')}
              onChange={(v) => setForm({ ...form, color_secondary: v })} />
          </div>

          <div style={s.formGrid}>
            <div style={s.field}>
              <label style={s.label} htmlFor="tmpl-sender">{t('documents.senderName')}</label>
              <input id="tmpl-sender" style={s.input} value={form.sender_name}
                onChange={(e) => setForm({ ...form, sender_name: e.target.value })} />
            </div>
            <div style={s.field}>
              <label style={s.label} htmlFor="tmpl-reply">{t('documents.replyTo')}</label>
              <input id="tmpl-reply" style={s.input} type="email" value={form.reply_to}
                onChange={(e) => setForm({ ...form, reply_to: e.target.value })} />
            </div>
          </div>

          {/* Placeholder chips — click to insert into the last-focused field */}
          <div style={s.chipArea}>
            <label style={s.label}>{t('documents.insertPlaceholder')}</label>
            <p style={s.helper}>
              {t('documents.insertHelper')}
            </p>
            <div style={s.chips}>
              {selectedType.placeholders.map((ph) => (
                <button key={ph.token} type="button" style={s.chip}
                  title={t('documents.chipTitle', { description: phText(selectedType.key, ph, 'description'), sample: phText(selectedType.key, ph, 'sample') })}
                  onClick={() => insertPlaceholder(ph)}>
                  {phText(selectedType.key, ph, 'label')}
                </button>
              ))}
            </div>
          </div>

          <div style={s.field}>
            <label style={s.label} htmlFor="tmpl-subject">{t('documents.subject')}</label>
            <input id="tmpl-subject" style={s.input} value={form.subject_template}
              ref={(el) => { plainRefs.current.subject_template = el; }}
              onFocus={() => { lastFocused.current = 'subject_template'; }}
              onChange={(e) => setForm({ ...form, subject_template: e.target.value })} />
          </div>

          <div style={s.field}>
            <label style={s.label}>{t('documents.body')}</label>
            <RichTextEditor
              ref={bodyRef}
              ariaLabel={t('documents.documentBody')}
              value={form.body_template}
              onFocus={() => { lastFocused.current = 'body'; }}
              onChange={(html) => setForm((f) => ({ ...f, body_template: html }))}
            />
          </div>

          <div style={s.field}>
            <label style={s.label} htmlFor="tmpl-footer">{t('documents.footer')}</label>
            <input id="tmpl-footer" style={s.input} value={form.footer_text}
              ref={(el) => { plainRefs.current.footer_text = el; }}
              onFocus={() => { lastFocused.current = 'footer_text'; }}
              onChange={(e) => setForm({ ...form, footer_text: e.target.value })} />
          </div>

          <div style={s.formGrid}>
            <div style={s.field}>
              <label style={s.label} htmlFor="tmpl-footer-link-text">{t('documents.footerLinkText')}</label>
              <input id="tmpl-footer-link-text" style={s.input} placeholder={t('documents.footerLinkTextPlaceholder')}
                value={form.footer_link_text}
                ref={(el) => { plainRefs.current.footer_link_text = el; }}
                onFocus={() => { lastFocused.current = 'footer_link_text'; }}
                onChange={(e) => setForm({ ...form, footer_link_text: e.target.value })} />
              <span style={s.helper}>{t('documents.footerLinkTextHelper')}</span>
            </div>
            <div style={s.field}>
              <label style={s.label} htmlFor="tmpl-footer-link-url">{t('documents.footerLinkUrl')}</label>
              <input id="tmpl-footer-link-url" style={s.input} placeholder="https://..."
                value={form.footer_link_url}
                ref={(el) => { plainRefs.current.footer_link_url = el; }}
                onFocus={() => { lastFocused.current = 'footer_link_url'; }}
                onChange={(e) => setForm({ ...form, footer_link_url: e.target.value })} />
              <span style={s.helper}>{t('documents.footerLinkUrlHelper')}</span>
            </div>
          </div>

          <div style={s.actions}>
            <Button onClick={handleSave} loading={saving}>
              {editingId === 'new' ? t('documents.createTemplate') : t('documents.saveChanges')}
            </Button>
            <Button variant="secondary" onClick={() => setPreviewOpen(true)} disabled={saving}>{t('documents.preview')}</Button>
            <Button variant="ghost" onClick={closeEditor} disabled={saving}>{t('common:cancel')}</Button>
          </div>
        </div>
      )}
      </div>

      {/* Preview — renders the template with sample values + chosen branding. */}
      {selectedType && (() => {
        // The template being edited, or a system template opened with Preview (read only).
        const shown = previewForm ?? form;
        // The sample values in the language shown, for the filled-in preview.
        const samplePlaceholders = selectedType.placeholders.map((p) => ({ ...p, sample: phText(selectedType.key, p, 'sample') }));
        return (
        <Modal open={previewOpen || !!previewForm} onClose={() => { setPreviewOpen(false); setPreviewForm(null); }}
          title={t(previewForm ? 'documents.previewTitleSystem' : 'documents.previewTitle', { type: typeLabel(selectedType) })} size="lg">
          <div style={s.previewNote}>
            {t(previewForm ? 'documents.previewNoteSystem' : 'documents.previewNote')}
          </div>
          <BrandedDocumentView fields={{
            primaryColor: shown.color_primary || DEFAULT_PRIMARY,
            secondaryColor: shown.color_secondary || DEFAULT_SECONDARY,
            logoUrl: shown.logo_url || null,
            businessName: fillSamples('{{business_name}}', samplePlaceholders),
            subject: fillSamples(shown.subject_template, samplePlaceholders),
            // Keep the {{details_table}} marker literal in the body so the preview
            // can draw a sample table where the user placed it.
            bodyHtml: shown.body_template ? sanitizeRichText(fillSamples(shown.body_template, samplePlaceholders)) : '',
            footerText: fillSamples(shown.footer_text, samplePlaceholders),
            footerLinkText: fillSamples(shown.footer_link_text, samplePlaceholders),
            footerLinkUrl: fillSamples(shown.footer_link_url, samplePlaceholders),
            detailsTable: sampleDetailsTable(t),
          }} />
          {previewForm && (
            <div style={{ ...s.actions, marginTop: 'var(--space-md)' }}>
              <p style={s.helper}>{t('documents.readOnly')}</p>
            </div>
          )}
        </Modal>
        );
      })()}
      </>)}
    </div>
  );
}

/** Color field: native swatch + hex text + preset swatches (matches theme editor). */
function ColorField({ label, value, helper, onChange }: {
  label: string; value: string; helper?: string; onChange: (v: string) => void;
}) {
  const { t } = useTranslation('templates');
  const valid = /^#[0-9A-Fa-f]{6}$/.test(value);
  const id = `color-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div style={s.field}>
      <label style={s.label} htmlFor={id}>{label}</label>
      <div style={s.colorInputRow}>
        <input type="color" aria-label={t('documents.colorPicker', { label })}
          value={valid ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)} style={s.colorSwatch} />
        <input id={id} type="text" value={value} placeholder={t('documents.colorPlaceholder')}
          spellCheck={false} onChange={(e) => onChange(e.target.value)} style={s.colorHex} />
      </div>
      <div style={s.presetRow} role="group" aria-label={t('documents.colorPresets', { label })}>
        {COLOR_PRESETS.map((c) => (
          <button key={c} type="button" title={c} aria-label={c}
            aria-pressed={value.toLowerCase() === c.toLowerCase()}
            onClick={() => onChange(c)}
            style={{ ...s.preset, background: c, outline: value.toLowerCase() === c.toLowerCase() ? '2px solid var(--color-text)' : 'none' }} />
        ))}
      </div>
      {helper && <span style={s.helper}>{helper}</span>}
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function saveErr(e: unknown): string {
  const anyE = e as any;
  return anyE?.response?.data?.message || anyE?.message || i18n.t('templates:documents.somethingWrong');
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const s: Record<string, React.CSSProperties> = {
  section: {},
  title: { margin: '0 0 var(--space-sm) 0', fontSize: 'var(--font-size-h2, 1.5rem)', fontWeight: 600, color: 'var(--color-text)' },
  subTitle: { margin: 0, fontSize: 'var(--font-size-h4, 1.125rem)', fontWeight: 600, color: 'var(--color-text)' },
  description: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-lg) 0', lineHeight: 1.5, maxWidth: '640px' },
  muted: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)' },
  error: { color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-md) 0' },
  field: { marginBottom: 'var(--space-md)', flex: 1, minWidth: '240px' },
  formGrid: { display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap' as const },
  label: { display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', marginBottom: '4px' },
  req: { color: 'var(--color-error)', marginLeft: '2px' },
  helper: { display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: '4px' },
  input: { width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', fontSize: 'var(--font-size-base)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', boxSizing: 'border-box' as const },
  select: { padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', fontSize: 'var(--font-size-base)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', minWidth: '240px' },
  checkLabel: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', cursor: 'pointer' },
  // Color picker
  colorInputRow: { display: 'flex', gap: '8px', alignItems: 'center' },
  colorSwatch: { width: '40px', height: '40px', padding: 0, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', background: 'none', cursor: 'pointer', flexShrink: 0 },
  colorHex: { flex: 1, padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', fontSize: 'var(--font-size-base)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', boxSizing: 'border-box' as const },
  presetRow: { display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' as const },
  preset: { width: '22px', height: '22px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-full, 9999px)', cursor: 'pointer', outlineOffset: '1px' },
  // List
  listHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: 'var(--space-lg) 0 var(--space-sm) 0' },
  list: { display: 'flex', flexDirection: 'column' as const, gap: '8px', marginBottom: 'var(--space-lg)' },
  listRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' as const, gap: '8px', padding: '12px 16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', background: 'var(--color-surface)' },
  listInfo: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' as const, minWidth: 0 },
  listName: { fontWeight: 600, color: 'var(--color-text)', fontSize: 'var(--font-size-base)' },
  langTag: { fontSize: 'var(--font-size-xs)', padding: '2px 8px', borderRadius: 'var(--radius-full, 9999px)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' },
  statusTag: { fontSize: 'var(--font-size-xs)' },
  listActions: { display: 'flex', gap: '8px' },
  // Editor
  editor: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg, 12px)', padding: 'var(--space-lg)', background: 'var(--color-surface)', marginTop: 'var(--space-md)' },
  // Lists on the left at a set width, the open template on the right; side by side when there is room
  split: { display: 'flex', alignItems: 'flex-start', gap: 'var(--space-lg)', flexWrap: 'wrap' as const },
  splitList: { flex: '0 0 340px', minWidth: 0, maxWidth: '100%' },
  splitEditor: { flex: '1 1 480px', minWidth: 0, marginTop: 0 },
  editorHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' as const, marginBottom: 'var(--space-md)' },
  listRowOpen: { borderColor: 'var(--color-primary)', boxShadow: 'inset 3px 0 0 var(--color-primary)' },
  chipArea: { margin: 'var(--space-md) 0', padding: 'var(--space-md)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md, 8px)' },
  chips: { display: 'flex', flexWrap: 'wrap' as const, gap: '6px', marginTop: '8px' },
  chip: { padding: '4px 10px', fontSize: 'var(--font-size-xs)', borderRadius: 'var(--radius-full, 9999px)', border: '1px solid var(--color-accent)', background: 'transparent', color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  actions: { display: 'flex', gap: '12px', marginTop: 'var(--space-lg)', flexWrap: 'wrap' as const },
  // Preview — the document itself renders via the shared BrandedDocumentView.
  previewNote: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-md)' },
};
