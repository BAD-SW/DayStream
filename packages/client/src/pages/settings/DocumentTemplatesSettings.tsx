import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '../../design-system/components/actions/Button';
import { Modal } from '../../design-system/components/feedback/Modal';
import { RichTextEditor, RichTextEditorHandle, sanitizeRichText } from '../../design-system/components/forms/RichTextEditor';
import { BrandedDocumentView } from '../../components/BrandedDocumentView';
import { DETAILS_TABLE_TOKEN } from '@daystream/shared';
import { useContextManager } from '../../context/ContextManager';
import * as payApi from '../../api/payments';
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

/** Sample rows so {{details_table}} shows a realistic table in the editor preview. */
const SAMPLE_DETAILS_TABLE = {
  rows: [
    { description: 'Infrared Sauna — 60 min', qty: 1, amountCents: 4500 },
    { description: 'Cold Plunge', qty: 2, amountCents: 3000 },
  ],
  totalCents: 10500,
  currency: 'EUR',
};

export function DocumentTemplatesSettings() {
  const businessId = useContextManager().activeContext.businessId || '';

  const [catalog, setCatalog] = useState<DocumentArtifactType[]>([]);
  const [artifactType, setArtifactType] = useState<string>('');
  const [templates, setTemplates] = useState<DocumentBrandingTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editor state: which template is open (or 'new'), the working form, saving flag.
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);
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
    payApi.getDocumentArtifactTypes()
      .then((cat) => {
        setCatalog(cat);
        if (cat.length > 0) setArtifactType(cat[0].key);
      })
      .catch(() => setError('Failed to load document types.'))
      .finally(() => setLoading(false));
  }, []);

  const loadTemplates = useCallback(() => {
    if (!businessId || !artifactType) return;
    payApi.listDocumentTemplates(businessId, artifactType)
      .then(setTemplates)
      .catch(() => setError('Failed to load templates.'));
  }, [businessId, artifactType]);

  // Reload templates whenever the selected artifact type changes.
  useEffect(() => {
    setEditingId(null);
    loadTemplates();
  }, [loadTemplates]);

  const openNew = () => {
    setForm({ ...EMPTY_FORM, name: 'New Template' });
    setEditingId('new');
  };

  const openEdit = (t: DocumentBrandingTemplate) => {
    setForm(toForm(t));
    setEditingId(t.id);
  };

  // Duplicate: open the editor pre-filled from an existing template as a NEW one
  // (name suffixed "(Copy)"), so a business can tweak seasonal details and save a
  // fresh variant without re-entering everything. Saving creates a new template.
  const openDuplicate = (t: DocumentBrandingTemplate) => {
    setForm({ ...toForm(t), name: `${t.name} (Copy)` });
    setEditingId('new');
  };

  const closeEditor = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Template name is required.'); return; }
    setSaving(true); setError(null);
    try {
      if (editingId === 'new') {
        await payApi.createDocumentTemplate(businessId, artifactType, toInput(form));
      } else if (editingId) {
        await payApi.updateDocumentTemplate(businessId, editingId, toInput(form));
      }
      loadTemplates();
      closeEditor();
    } catch (e: unknown) {
      setError(saveErr(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t: DocumentBrandingTemplate) => {
    if (!confirm(`Delete template "${t.name}"? This cannot be undone.`)) return;
    try {
      await payApi.deleteDocumentTemplate(businessId, t.id);
      if (editingId === t.id) closeEditor();
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

  if (loading) return <p style={s.muted}>Loading...</p>;

  if (!businessId) {
    return <p style={s.muted}>Select a business to manage document templates.</p>;
  }

  const primary = form.color_primary || DEFAULT_PRIMARY;
  const secondary = form.color_secondary || DEFAULT_SECONDARY;

  return (
    <div style={s.section}>
      <h2 style={s.title}>Document Templates</h2>
      <p style={s.description}>
        Brand the documents your customers receive. Pick a document type, then create one or more
        templates — for example a default and a seasonal variant, or per-language versions.
      </p>

      {error && <p style={s.error} role="alert">{error}</p>}

      {/* Artifact type selector */}
      <div style={s.field}>
        <label style={s.label} htmlFor="artifact-type">Document Type</label>
        <select
          id="artifact-type"
          style={s.select}
          value={artifactType}
          onChange={(e) => setArtifactType(e.target.value)}
        >
          {catalog.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        {selectedType && <span style={s.helper}>{selectedType.description}</span>}
      </div>

      {/* Template list */}
      <div style={s.listHeader}>
        <h3 style={s.subTitle}>Templates</h3>
        <Button size="sm" onClick={openNew}>New Template</Button>
      </div>

      {templates.length === 0 ? (
        <p style={s.muted}>No templates yet. Create one to brand this document.</p>
      ) : (
        <div style={s.list}>
          {templates.map((t) => (
            <div key={t.id} style={s.listRow}>
              <div style={s.listInfo}>
                <span style={s.listName}>{t.name}</span>
                {t.language && <span style={s.langTag}>{t.language}</span>}
                <span style={{ ...s.statusTag, color: t.isActive ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                  {t.isActive ? '● Active' : '○ Inactive'}
                </span>
              </div>
              <div style={s.listActions}>
                <Button size="sm" variant="secondary" onClick={() => openEdit(t)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => openDuplicate(t)}>Duplicate</Button>
                <Button size="sm" variant="ghost" onClick={() => handleDelete(t)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor */}
      {editingId && selectedType && (
        <div style={s.editor}>
          <h3 style={s.subTitle}>{editingId === 'new' ? 'New Template' : 'Edit Template'}</h3>

          <div style={s.formGrid}>
            <div style={s.field}>
              <label style={s.label} htmlFor="tmpl-name">Name<span style={s.req}>*</span></label>
              <input id="tmpl-name" style={s.input} value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div style={s.field}>
              <label style={s.label} htmlFor="tmpl-lang">Language</label>
              <input id="tmpl-lang" style={s.input} placeholder="e.g. en, es (blank = default)"
                value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
            </div>
          </div>

          <div style={s.field}>
            <label style={s.checkLabel}>
              <input type="checkbox" checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              <span>Active (inactive templates are drafts and are not used)</span>
            </label>
          </div>

          <div style={s.field}>
            <label style={s.label} htmlFor="tmpl-logo">Logo URL</label>
            <input id="tmpl-logo" style={s.input} placeholder="https://..." value={form.logo_url}
              onChange={(e) => setForm({ ...form, logo_url: e.target.value })} />
          </div>

          <div style={s.formGrid}>
            <ColorField label="Primary Color" value={form.color_primary}
              helper="Header bar and headings."
              onChange={(v) => setForm({ ...form, color_primary: v })} />
            <ColorField label="Secondary Color" value={form.color_secondary}
              helper="Accents and the footer rule."
              onChange={(v) => setForm({ ...form, color_secondary: v })} />
          </div>

          <div style={s.formGrid}>
            <div style={s.field}>
              <label style={s.label} htmlFor="tmpl-sender">Sender Name</label>
              <input id="tmpl-sender" style={s.input} value={form.sender_name}
                onChange={(e) => setForm({ ...form, sender_name: e.target.value })} />
            </div>
            <div style={s.field}>
              <label style={s.label} htmlFor="tmpl-reply">Reply-To Email</label>
              <input id="tmpl-reply" style={s.input} type="email" value={form.reply_to}
                onChange={(e) => setForm({ ...form, reply_to: e.target.value })} />
            </div>
          </div>

          {/* Placeholder chips — click to insert into the last-focused field */}
          <div style={s.chipArea}>
            <label style={s.label}>Insert Placeholder</label>
            <p style={s.helper}>
              Click into a field below, then click a placeholder to insert it. Placeholders are
              replaced with real values when the document is sent.
            </p>
            <div style={s.chips}>
              {selectedType.placeholders.map((ph) => (
                <button key={ph.token} type="button" style={s.chip}
                  title={`${ph.description} (e.g. ${ph.sample})`}
                  onClick={() => insertPlaceholder(ph)}>
                  {ph.label}
                </button>
              ))}
            </div>
          </div>

          <div style={s.field}>
            <label style={s.label} htmlFor="tmpl-subject">Subject</label>
            <input id="tmpl-subject" style={s.input} value={form.subject_template}
              ref={(el) => { plainRefs.current.subject_template = el; }}
              onFocus={() => { lastFocused.current = 'subject_template'; }}
              onChange={(e) => setForm({ ...form, subject_template: e.target.value })} />
          </div>

          <div style={s.field}>
            <label style={s.label}>Body</label>
            <RichTextEditor
              ref={bodyRef}
              ariaLabel="Document body"
              value={form.body_template}
              onFocus={() => { lastFocused.current = 'body'; }}
              onChange={(html) => setForm((f) => ({ ...f, body_template: html }))}
            />
          </div>

          <div style={s.field}>
            <label style={s.label} htmlFor="tmpl-footer">Footer</label>
            <input id="tmpl-footer" style={s.input} value={form.footer_text}
              ref={(el) => { plainRefs.current.footer_text = el; }}
              onFocus={() => { lastFocused.current = 'footer_text'; }}
              onChange={(e) => setForm({ ...form, footer_text: e.target.value })} />
          </div>

          <div style={s.formGrid}>
            <div style={s.field}>
              <label style={s.label} htmlFor="tmpl-footer-link-text">Footer Link Text</label>
              <input id="tmpl-footer-link-text" style={s.input} placeholder="e.g. Visit our website"
                value={form.footer_link_text}
                ref={(el) => { plainRefs.current.footer_link_text = el; }}
                onFocus={() => { lastFocused.current = 'footer_link_text'; }}
                onChange={(e) => setForm({ ...form, footer_link_text: e.target.value })} />
              <span style={s.helper}>The clickable text shown in the footer.</span>
            </div>
            <div style={s.field}>
              <label style={s.label} htmlFor="tmpl-footer-link-url">Footer Link URL</label>
              <input id="tmpl-footer-link-url" style={s.input} placeholder="https://..."
                value={form.footer_link_url}
                ref={(el) => { plainRefs.current.footer_link_url = el; }}
                onFocus={() => { lastFocused.current = 'footer_link_url'; }}
                onChange={(e) => setForm({ ...form, footer_link_url: e.target.value })} />
              <span style={s.helper}>Must start with http:// or https://</span>
            </div>
          </div>

          <div style={s.actions}>
            <Button onClick={handleSave} loading={saving}>
              {editingId === 'new' ? 'Create Template' : 'Save Changes'}
            </Button>
            <Button variant="secondary" onClick={() => setPreviewOpen(true)} disabled={saving}>Preview</Button>
            <Button variant="ghost" onClick={closeEditor} disabled={saving}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Preview — renders the template with sample values + chosen branding. */}
      {selectedType && (
        <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title={`Preview — ${selectedType.label}`} size="lg">
          <div style={s.previewNote}>
            Placeholders are shown filled with example values. Actual documents use real customer data.
          </div>
          <BrandedDocumentView fields={{
            primaryColor: primary,
            secondaryColor: secondary,
            logoUrl: form.logo_url || null,
            businessName: fillSamples('{{business_name}}', selectedType.placeholders),
            subject: fillSamples(form.subject_template, selectedType.placeholders),
            // Keep the {{details_table}} marker literal in the body so the preview
            // can draw a sample table where the user placed it.
            bodyHtml: form.body_template ? sanitizeRichText(fillSamples(form.body_template, selectedType.placeholders)) : '',
            footerText: fillSamples(form.footer_text, selectedType.placeholders),
            footerLinkText: fillSamples(form.footer_link_text, selectedType.placeholders),
            footerLinkUrl: fillSamples(form.footer_link_url, selectedType.placeholders),
            detailsTable: SAMPLE_DETAILS_TABLE,
          }} />
        </Modal>
      )}
    </div>
  );
}

/** Color field: native swatch + hex text + preset swatches (matches theme editor). */
function ColorField({ label, value, helper, onChange }: {
  label: string; value: string; helper?: string; onChange: (v: string) => void;
}) {
  const valid = /^#[0-9A-Fa-f]{6}$/.test(value);
  const id = `color-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div style={s.field}>
      <label style={s.label} htmlFor={id}>{label}</label>
      <div style={s.colorInputRow}>
        <input type="color" aria-label={`${label} picker`}
          value={valid ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)} style={s.colorSwatch} />
        <input id={id} type="text" value={value} placeholder="#RRGGBB (blank = default)"
          spellCheck={false} onChange={(e) => onChange(e.target.value)} style={s.colorHex} />
      </div>
      <div style={s.presetRow} role="group" aria-label={`${label} presets`}>
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
  return anyE?.response?.data?.message || anyE?.message || 'Something went wrong.';
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const s: Record<string, React.CSSProperties> = {
  section: { maxWidth: '900px' },
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
  listRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', background: 'var(--color-surface)' },
  listInfo: { display: 'flex', alignItems: 'center', gap: '12px' },
  listName: { fontWeight: 600, color: 'var(--color-text)', fontSize: 'var(--font-size-base)' },
  langTag: { fontSize: 'var(--font-size-xs)', padding: '2px 8px', borderRadius: 'var(--radius-full, 9999px)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' },
  statusTag: { fontSize: 'var(--font-size-xs)' },
  listActions: { display: 'flex', gap: '8px' },
  // Editor
  editor: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg, 12px)', padding: 'var(--space-lg)', background: 'var(--color-surface)', marginTop: 'var(--space-md)' },
  chipArea: { margin: 'var(--space-md) 0', padding: 'var(--space-md)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md, 8px)' },
  chips: { display: 'flex', flexWrap: 'wrap' as const, gap: '6px', marginTop: '8px' },
  chip: { padding: '4px 10px', fontSize: 'var(--font-size-xs)', borderRadius: 'var(--radius-full, 9999px)', border: '1px solid var(--color-accent)', background: 'transparent', color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  actions: { display: 'flex', gap: '12px', marginTop: 'var(--space-lg)', flexWrap: 'wrap' as const },
  // Preview — the document itself renders via the shared BrandedDocumentView.
  previewNote: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-md)' },
};
