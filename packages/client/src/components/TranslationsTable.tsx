import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_DETAILS, TRANSLATABLE_FIELDS } from '@daystream/shared';
import type { TranslatableEntity, TranslatableField, TranslationFields } from '@daystream/shared';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { Modal } from '../design-system/components/feedback/Modal';
import { askConfirm, showMessage } from '../design-system/components/feedback/dialogs';
import { useContextManager } from '../context/ContextManager';
import { getTranslations, saveTranslation, machineTranslate } from '../api/translations';
import type { TranslationTable } from '../api/translations';
import './TranslationsTable.css';

/**
 * Translating offerings (Phase 44, requirement 9; design 14.5): the record's default-language text
 * (read only) and one row per other language of the business, each with an input per field, its
 * state and a Translate button that fills the row with Google's translation.
 */

type By = 'machine' | 'person' | null;
interface RowState { language: string; fields: Record<TranslatableField, string>; by: By; outOfDate: boolean; dirty: boolean; busy: boolean }

const emptyFields = (): Record<TranslatableField, string> => ({ name: '', short_description: '', description: '' });
const toFields = (f: TranslationFields): Record<TranslatableField, string> => ({ ...emptyFields(), ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v ?? ''])) });
const hasText = (r: RowState, fields: TranslatableField[]) => fields.some((f) => r.fields[f].trim() !== '');
const languageName = (code: string): string => (LANGUAGE_DETAILS as Record<string, { label: string } | undefined>)[code]?.label ?? code;
const serverError = (err: unknown): string | null => {
  const e = err as { response?: { data?: { error?: unknown } } } | null;
  const msg = e?.response?.data?.error;
  return typeof msg === 'string' && msg ? msg : null;
};

interface DialogProps {
  open: boolean;
  onClose: () => void;
  entityType: TranslatableEntity;
  entityId: string;
  /** The record's name, shown in the dialog's title. */
  title: string;
}

export function TranslationsDialog({ open, onClose, entityType, entityId, title }: DialogProps) {
  const { t } = useTranslation('translations');
  const { activeContext } = useContextManager();
  const businessId = activeContext.businessId ?? '';
  const [data, setData] = useState<TranslationTable | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const fields: TranslatableField[] = [...TRANSLATABLE_FIELDS[entityType]];

  const load = useCallback(async () => {
    if (!businessId || !entityId) return;
    setLoading(true);
    setLoadError('');
    try {
      const table = await getTranslations(businessId, entityType, entityId);
      setData(table);
      setRows(table.rows.map((r) => ({
        language: r.language, fields: toFields(r.fields), by: r.translatedBy, outOfDate: r.outOfDate, dirty: false, busy: false,
      })));
    } catch (err) {
      setLoadError(serverError(err) ?? t('error.load'));
    } finally {
      setLoading(false);
    }
  }, [businessId, entityType, entityId, t]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const anyDirty = rows.some((r) => r.dirty);
  const patch = (language: string, change: Partial<RowState>) =>
    setRows((list) => list.map((r) => (r.language === language ? { ...r, ...change } : r)));

  const edit = (language: string, field: TranslatableField, value: string) =>
    setRows((list) => list.map((r) => (r.language === language ? { ...r, fields: { ...r.fields, [field]: value }, by: 'person', dirty: true } : r)));

  const translate = async (row: RowState) => {
    if (hasText(row, fields)) {
      const ok = await askConfirm({ message: t('replace.message', { language: languageName(row.language) }), confirmLabel: t('common:action.replace') });
      if (!ok) return;
    }
    patch(row.language, { busy: true });
    try {
      const result = await machineTranslate(businessId, entityType, entityId, row.language);
      patch(row.language, { fields: toFields(result), by: 'machine', outOfDate: false, dirty: true, busy: false });
    } catch (err) {
      patch(row.language, { busy: false });
      await showMessage({ message: serverError(err) ?? t('error.translate'), tone: 'error' });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      for (const row of rows.filter((r) => r.dirty)) {
        const send: TranslationFields = {};
        for (const f of fields) send[f] = row.fields[f];
        await saveTranslation(businessId, entityType, entityId, row.language, send, row.by === 'machine' ? 'machine' : 'person');
      }
      await load();
    } catch (err) {
      await showMessage({ message: serverError(err) ?? t('error.save'), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const close = async () => {
    if (anyDirty && !(await askConfirm({ message: t('discard.message'), confirmLabel: t('common:action.discard'), destructive: true }))) return;
    onClose();
  };

  // Only "Out of date" is shown: whether a row is empty, from Google or edited is plain to see (owner, 24 Nov 2026).
  const stateBadge = (r: RowState) => (r.outOfDate && hasText(r, fields) ? <Badge variant="warning">{t('state.outOfDate')}</Badge> : null);

  const saveButton = (
    <Button onClick={() => void save()} loading={saving} disabled={!anyDirty || saving}>{t('common:save')}</Button>
  );

  return (
    <Modal
      open={open}
      onClose={() => void close()}
      title={t('dialog.title', { name: title })}
      size="full"
      footer={<>
        <Button variant="ghost" onClick={() => void close()}>{t('common:cancel')}</Button>
        {saveButton}
      </>}
    >
      {loading && !data && <p className="tr-muted">{t('common:loading')}</p>}
      {loadError && <p className="tr-error" role="alert">{loadError}</p>}
      {data && (
        <>
          <div className="tr-save-bar">{saveButton}</div>
          {rows.length === 0 && <p className="tr-muted">{t('empty')}</p>}
          <table className="tr-table">
            <thead>
              <tr>
                <th scope="col">{t('column.language')}</th>
                {fields.map((f) => <th scope="col" key={f}>{t(`field.${f}`)}</th>)}
                <th scope="col">{t('column.translation')}</th>
              </tr>
            </thead>
            <tbody>
              <tr data-testid="row-default">
                <td className="tr-lang">
                  {languageName(data.defaultLanguage)}
                  <span className="tr-default-tag">{t('defaultLanguage')}</span>
                </td>
                {fields.map((f) => (
                  <td key={f}>
                    <span className="tr-field-label">{t(`field.${f}`)}</span>
                    <div className="tr-original">{data.original[f] ?? ''}</div>
                  </td>
                ))}
                <td />
              </tr>
              {rows.map((r) => {
                const name = languageName(r.language);
                return (
                  <tr key={r.language} data-testid={`row-${r.language}`}>
                    <td className="tr-lang">{name}</td>
                    {fields.map((f) => {
                      const id = `tr-${r.language}-${f}`;
                      return (
                        <td key={f}>
                          <label className="tr-field-label" htmlFor={id}>{t(`field.${f}`)}{' '}({name})</label>
                          {f === 'description'
                            ? <textarea id={id} className="tr-input" rows={4} value={r.fields[f]} onChange={(e) => edit(r.language, f, e.target.value)} />
                            : <input id={id} className="tr-input" type="text" value={r.fields[f]} onChange={(e) => edit(r.language, f, e.target.value)} />}
                        </td>
                      );
                    })}
                    <td>
                      <div className="tr-action">
                        {stateBadge(r)}
                        <Button size="sm" variant="secondary" loading={r.busy} disabled={r.busy || saving} aria-label={t('translate.into', { language: name })} onClick={() => void translate(r)}>
                          {t('translate.button')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}

/** The record's Translate button with its dialog; disabled until the record is saved. */
export function TranslateButton({ entityType, entityId, title, label }: { entityType: TranslatableEntity; entityId: string | null | undefined; title: string; label: string }) {
  const { t } = useTranslation('translations');
  const [open, setOpen] = useState(false);
  return (
    <>
      <span className="tr-trigger"><Button size="sm" variant="secondary" disabled={!entityId} title={entityId ? undefined : t('needsSave')} onClick={() => setOpen(true)}>{label}</Button></span>
      {entityId && open && <TranslationsDialog open onClose={() => setOpen(false)} entityType={entityType} entityId={entityId} title={title} />}
    </>
  );
}

