import { useState, useEffect, useMemo } from 'react';
import { Button } from '../../design-system/components/actions/Button';
import { Modal } from '../../design-system/components/feedback/Modal';
import { MultiSelect } from '../../design-system/components/forms/MultiSelect';
import { FormRenderer } from '../../components/forms/FormRenderer';
import { validateFormDefinition, MAX_FORM_COLUMNS } from '@daystream/shared';
import { LanguageSelect } from '../../components/LanguageSelect';
import type { FormItem, FormItemType, FormAnswer, FormValidationIssue } from '@daystream/shared';
import * as formsApi from '../../api/forms';
import type { Form } from '../../api/forms';
import { getServices } from '../../api/services';

/**
 * The form builder behind Business Setup > Templates > Forms (spec 51, gap 1).
 * Edits one form version: header settings, an ordered list of items, and a preview.
 */


const ITEM_TYPE_LABELS: Record<FormItemType, string> = {
  heading: 'Heading',
  text: 'Paragraph',
  write_in: 'Write-in answer',
  date: 'Date',
  yes_no: 'Yes / No',
  single_choice: 'Choose one',
  multi_choice: 'Checkbox table',
  agree: '"I agree" box',
  signature: 'Signature line',
};

const ADD_BUTTONS: FormItemType[] = [
  'heading', 'text', 'write_in', 'date', 'yes_no', 'single_choice', 'multi_choice',
];

/**
 * Items grouped into blocks. An agreement and the signature always form one block (agreement
 * first), wherever they were in the list, so they can only move or go together.
 */
function toBlocks(items: FormItem[]): FormItem[][] {
  const sig = items.find((i) => i.type === 'signature');
  const hasAgree = items.some((i) => i.type === 'agree');
  const out: FormItem[][] = [];
  for (const it of items) {
    if (it.type === 'agree') out.push(sig ? [it, sig] : [it]);
    else if (it.type === 'signature' && hasAgree) continue;
    else out.push([it]);
  }
  return out;
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function blankItem(type: FormItemType): FormItem {
  const id = newId();
  switch (type) {
    case 'heading': return { id, type, text: '' };
    case 'text': return { id, type, text: '' };
    case 'single_choice': return { id, type, label: '', required: false, options: ['', ''] };
    case 'multi_choice': return { id, type, label: '', required: false, options: ['', ''], columns: 2 };
    case 'agree': return { id, type, label: 'I have read and agree to the above' };
    case 'signature': return { id, type, label: 'Signature' };
    default: return { id, type, label: '', required: false } as FormItem;
  }
}

interface Props {
  businessId: string;
  /** The form being edited; null for a new form. */
  form: Form | null;
  onSaved: () => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** 'chart' builds a clinical chart template: no language, no when-needed rules, no customer signature. */
  kind?: 'form' | 'chart';
}

export function FormTemplateEditor({ businessId, form, onSaved, onCancel, onDirtyChange, kind: templateKind = 'form' }: Props) {
  const isChart = templateKind === 'chart';
  const noun = isChart ? 'chart template' : 'form';
  const initial = useMemo(() => ({
    name: form?.name ?? (isChart ? 'New chart template' : 'New form'),
    language: form?.language ?? '',
    isActive: form?.isActive ?? true,
    renewMonths: form?.renewAfterMonths ? String(form.renewAfterMonths) : '',
    firstVisit: !!form?.applies.first_visit,
    serviceIds: form?.applies.service_ids ?? [],
    items: toBlocks(form?.definition.items ?? ([] as FormItem[])).flat(),
  }), [form, isChart]);

  const [name, setName] = useState(initial.name);
  const [language, setLanguage] = useState(initial.language);
  const [isActive, setIsActive] = useState(initial.isActive);
  const [renewMonths, setRenewMonths] = useState(initial.renewMonths);
  const [firstVisit, setFirstVisit] = useState(initial.firstVisit);
  const [serviceIds, setServiceIds] = useState<string[]>(initial.serviceIds);
  const [items, setItems] = useState<FormItem[]>(initial.items);

  const [services, setServices] = useState<{ id: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FormValidationIssue[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, FormAnswer | undefined>>({});

  const current = { name, language, isActive, renewMonths, firstVisit, serviceIds, items };
  const dirty = JSON.stringify(current) !== JSON.stringify(initial);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    getServices(businessId, { limit: 500 })
      .then((res) => {
        const list = (res?.data ?? []) as { id: string; name: string }[];
        setServices(list.map((x) => ({ id: x.id, label: x.name })));
      })
      .catch(() => setServices([]));
  }, [businessId]);

  const issuesById = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const i of issues) {
      if (!i.itemId) continue;
      map.set(i.itemId, [...(map.get(i.itemId) ?? []), i.message]);
    }
    return map;
  }, [issues]);
  const generalIssues = issues.filter((i) => !i.itemId);

  const update = (id: string, patch: Partial<FormItem>) =>
    setItems((list) => list.map((it) => (it.id === id ? ({ ...it, ...patch } as FormItem) : it)));
  // The agreement and the signature are one block: moved and removed together, never apart.
  const move = (id: string, delta: number) =>
    setItems((list) => {
      const blocks = toBlocks(list);
      const i = blocks.findIndex((b) => b[0].id === id);
      const to = i + delta;
      if (i < 0 || to < 0 || to >= blocks.length) return list;
      const next = [...blocks];
      [next[i], next[to]] = [next[to], next[i]];
      return next.flat();
    });
  const remove = (id: string) => setItems((list) => toBlocks(list).filter((b) => b[0].id !== id).flat());
  const add = (type: FormItemType) => setItems((list) => [...toBlocks(list).flat(), blankItem(type)]);

  const hasSigned = items.some((i) => i.type === 'agree') && items.some((i) => i.type === 'signature');
  const addSigned = () =>
    setItems((list) => [...list.filter((i) => i.type !== 'agree' && i.type !== 'signature'), blankItem('agree'), blankItem('signature')]);
  const blocks = toBlocks(items);

  const handleSave = async () => {
    setError(null);
    const cleaned: FormItem[] = items.map((it) => {
      if (it.type === 'single_choice' || it.type === 'multi_choice') {
        // Blank lines (a pasted list often ends with one) are not entries.
        return { ...it, options: it.options.map((o) => o.trim()).filter((o) => o !== '') };
      }
      return it;
    });
    const found = validateFormDefinition({ items: cleaned }, templateKind);
    setIssues(found);
    if (!name.trim()) { setError(`The ${noun} needs a name.`); return; }
    if (found.length > 0) { setError('Fix the items marked below, then save again.'); return; }
    const months = renewMonths.trim() === '' ? null : Number(renewMonths);
    if (months !== null && (!Number.isInteger(months) || months < 1)) {
      setError('Renew after must be a whole number of months.'); return;
    }
    const input = {
      name: name.trim(),
      language: isChart ? null : (language || null),
      definition: { items: cleaned },
      applies: isChart ? {} : {
        ...(firstVisit ? { first_visit: true } : {}),
        ...(serviceIds.length > 0 ? { service_ids: serviceIds } : {}),
      },
      renew_after_months: isChart ? null : months,
      is_active: isActive,
    };
    setSaving(true);
    try {
      if (form) await formsApi.updateForm(businessId, form.id, input);
      else await formsApi.createForm(businessId, { ...input, kind: templateKind });
      onDirtyChange?.(false);
      onSaved();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setError(err.response?.data?.error || err.message || `Could not save the ${noun}.`);
    } finally {
      setSaving(false);
    }
  };

  const isVersion = !!form?.language;

  return (
    <div style={s.editor}>
      <h3 style={s.subTitle}>
        {form ? `Edit ${noun}${form.language ? ` (${form.language})` : ''}` : `New ${noun}`}
      </h3>
      {error && <p style={s.error} role="alert">{error}</p>}

      <div style={s.formGrid}>
        <div style={s.field}>
          <label style={s.label} htmlFor="frm-name">Name<span style={s.req}>*</span></label>
          <input id="frm-name" style={s.input} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </div>
        {!isChart && (
          <div style={s.field}>
            <label style={s.label} htmlFor="frm-lang">Language</label>
            <LanguageSelect id="frm-lang" style={s.input} value={language} onChange={setLanguage} blankLabel="Default (no language)" />
          </div>
        )}
      </div>

      <div style={s.field}>
        <label style={s.checkLabel}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span>Active (inactive {noun}s are drafts and are not offered)</span>
        </label>
      </div>

      {!isChart && (
      <div style={s.box}>
        <h4 style={s.boxTitle}>When this form is needed</h4>
        <p style={s.helper}>
          This only decides what shows as missing for staff. It never blocks a booking.
          {isVersion && ' These settings are shared by every language version of the form.'}
        </p>
        <label style={s.checkLabel}>
          <input type="checkbox" checked={firstVisit} onChange={(e) => setFirstVisit(e.target.checked)} />
          <span>Before a customer's first visit</span>
        </label>
        <div style={{ ...s.field, marginTop: 'var(--space-md)' }}>
          <MultiSelect label="Before these services" options={services} selected={serviceIds}
            onChange={setServiceIds} placeholder="No specific services"
            emptyMessage="No services found" />
        </div>
        <div style={{ ...s.field, maxWidth: '260px' }}>
          <label style={s.label} htmlFor="frm-renew">Renew after (months)</label>
          <input id="frm-renew" style={s.input} type="number" min={1} step={1} value={renewMonths}
            placeholder="Never" onChange={(e) => setRenewMonths(e.target.value)} />
          <span style={s.helper}>Leave blank if it never needs signing again.</span>
        </div>
      </div>
      )}

      <h4 style={s.boxTitle}>Items</h4>
      {generalIssues.map((i, n) => <p key={n} style={s.error} role="alert">{i.message}</p>)}
      {items.length === 0 && <p style={s.muted}>No items yet. Add some below.</p>}

      <ol style={s.itemList}>
        {blocks.map((block, index) => {
          const it = block[0];
          const sig = block[1];
          const kind = sig ? 'Agreement and signature' : ITEM_TYPE_LABELS[it.type];
          const problems = [...(issuesById.get(it.id) ?? []), ...(sig ? issuesById.get(sig.id) ?? [] : [])];
          return (
            <li key={it.id} style={{ ...s.item, borderColor: problems.length > 0 ? 'var(--color-error)' : 'var(--color-border)' }}>
              <div style={s.itemHead}>
                <span style={s.itemType}>{kind}</span>
                <div style={s.itemActions}>
                  <Button size="sm" variant="ghost" onClick={() => move(it.id, -1)} disabled={index === 0}
                    aria-label={`Move ${kind} up`}>Up</Button>
                  <Button size="sm" variant="ghost" onClick={() => move(it.id, 1)} disabled={index === blocks.length - 1}
                    aria-label={`Move ${kind} down`}>Down</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(it.id)}
                    aria-label={`Remove ${kind}`}>Remove</Button>
                </div>
              </div>

              {(it.type === 'heading' || it.type === 'text') ? (
                <textarea style={{ ...s.input, minHeight: it.type === 'text' ? '96px' : '44px' }}
                  aria-label={it.type === 'heading' ? 'Heading text' : 'Paragraph text'}
                  value={it.text} onChange={(e) => update(it.id, { text: e.target.value })} />
              ) : (
                <input style={s.input} aria-label={`${ITEM_TYPE_LABELS[it.type]} label`}
                  placeholder={it.type === 'agree' ? 'Text next to the box' : 'Question or label'}
                  value={it.label} onChange={(e) => update(it.id, { label: e.target.value })} />
              )}

              {(it.type === 'single_choice' || it.type === 'multi_choice') && (
                <div style={s.field}>
                  <label style={s.label} htmlFor={`opts-${it.id}`}>
                    {it.type === 'multi_choice' ? 'Entries (one per line)' : 'Options (one per line)'}
                  </label>
                  <textarea id={`opts-${it.id}`} style={{ ...s.input, minHeight: it.type === 'multi_choice' ? '140px' : '72px' }}
                    value={it.options.join('\n')}
                    onChange={(e) => update(it.id, { options: e.target.value.split('\n') } as Partial<FormItem>)} />
                  {it.type === 'multi_choice' && (
                    <span style={s.helper}>
                      {it.options.filter((o) => o.trim()).length} entries. The customer ticks the ones that apply.
                      Group related entries by using several tables, each with its own label.
                    </span>
                  )}
                </div>
              )}

              {it.type === 'multi_choice' && (
                <div style={{ ...s.field, maxWidth: '220px' }}>
                  <label style={s.label} htmlFor={`cols-${it.id}`}>Columns</label>
                  <select id={`cols-${it.id}`} style={s.input} value={it.columns ?? 1}
                    onChange={(e) => update(it.id, { columns: Number(e.target.value) } as Partial<FormItem>)}>
                    {Array.from({ length: MAX_FORM_COLUMNS }, (_, n) => n + 1).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <span style={s.helper}>
                    {(() => {
                      const filled = it.options.filter((o) => o.trim()).length;
                      const cols = it.columns ?? 1;
                      return `${filled} entries in ${cols} column${cols === 1 ? '' : 's'}: up to ${Math.ceil(filled / cols) || 0} rows. Entries run down each column first.`;
                    })()}
                  </span>
                </div>
              )}

              {'required' in it && (
                <label style={s.checkLabel}>
                  <input type="checkbox" checked={it.required}
                    onChange={(e) => update(it.id, { required: e.target.checked } as Partial<FormItem>)} />
                  <span>Required</span>
                </label>
              )}

              {/* The signature line that always goes with the agreement above. */}
              {sig && sig.type === 'signature' && (
                <div style={s.field}>
                  <label style={s.label} htmlFor={`sig-${sig.id}`}>Signature line label</label>
                  <input id={`sig-${sig.id}`} style={s.input} value={sig.label}
                    onChange={(e) => update(sig.id, { label: e.target.value })} />
                  <span style={s.helper}>The customer must tick the box above and sign here before submitting.</span>
                </div>
              )}

              {problems.map((m, n) => <span key={n} style={s.error} role="alert">{m}</span>)}
            </li>
          );
        })}
      </ol>

      <div style={s.addRow} role="group" aria-label="Add an item">
        {ADD_BUTTONS.map((t) => (
          <Button key={t} size="sm" variant="secondary" onClick={() => add(t)}>Add {ITEM_TYPE_LABELS[t].toLowerCase()}</Button>
        ))}
      </div>

      {!isChart && (
      <div style={s.box}>
        <h4 style={s.boxTitle}>Agreement and signature</h4>
        <p style={s.helper}>
          A signed form has an "I agree" box and a signature line. The customer must tick the box and
          sign before the form can be submitted.
        </p>
        {hasSigned
          ? <p style={s.helper}>This form is signed. The agreement and signature are one block in the list above; move or remove them together there.</p>
          : <Button size="sm" variant="secondary" onClick={addSigned}>Add agreement and signature</Button>}
      </div>
      )}

      <div style={s.actions}>
        <Button onClick={handleSave} loading={saving}>{form ? 'Save changes' : `Create ${noun}`}</Button>
        <Button variant="secondary" onClick={() => { setPreviewAnswers({}); setPreviewOpen(true); }} disabled={saving || items.length === 0}>
          Preview
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title={`Preview: ${name}`} size="lg">
        <p style={s.helper}>{isChart ? 'This is how the practitioner sees the chart.' : 'This is how the customer sees the form.'} Nothing you enter here is saved.</p>
        <FormRenderer definition={{ items }} idPrefix="preview"
          answers={previewAnswers}
          onChange={(id, v) => setPreviewAnswers((a) => ({ ...a, [id]: v }))} />
      </Modal>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  editor: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg, 12px)', padding: 'var(--space-lg)', background: 'var(--color-surface)', marginTop: 'var(--space-md)' },
  subTitle: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-h4, 1.125rem)', fontWeight: 600, color: 'var(--color-text)' },
  boxTitle: { margin: '0 0 var(--space-sm) 0', fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--color-text)' },
  box: { margin: 'var(--space-md) 0', padding: 'var(--space-md)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md, 8px)' },
  muted: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)' },
  error: { color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-sm) 0' },
  field: { marginBottom: 'var(--space-md)', flex: 1, minWidth: '240px' },
  formGrid: { display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap' },
  label: { display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', marginBottom: '4px' },
  req: { color: 'var(--color-error)', marginLeft: '2px' },
  helper: { display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-sm) 0' },
  input: { width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', fontSize: 'var(--font-size-base)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', boxSizing: 'border-box' },
  checkLabel: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', cursor: 'pointer' },
  itemList: { listStyle: 'none', margin: '0 0 var(--space-md) 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' },
  item: { display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', background: 'var(--color-surface)' },
  itemHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  itemType: { fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  itemActions: { display: 'flex', gap: '4px' },
  addRow: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: 'var(--space-md)' },
  actions: { display: 'flex', gap: '12px', marginTop: 'var(--space-lg)', flexWrap: 'wrap' },
};
