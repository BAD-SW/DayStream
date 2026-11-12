import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../design-system/components/actions/Button';
import { LanguageSelect } from '../../components/LanguageSelect';
import { CHECK_IN_TEXT_FIELDS, CHECK_IN_TEXT_PLACEHOLDERS, CHECK_IN_TEXT_DEFAULTS, DEFAULT_LANGUAGE, isSupportedLanguage } from '@daystream/shared';
import type { CheckInTextField } from '@daystream/shared';
import * as api from '../../api/checkinTexts';

/**
 * The "Check-In" type on the Templates tab (spec 51, gap 3): the words on the customer's check-in
 * screens (phone page, kiosk, forms list), per language. Every piece shows the built-in wording as a
 * hint; type something to replace it, clear the box to go back to the built-in wording.
 */
const GROUPS: CheckInTextField['group'][] = ['Phone page', 'Forms list', 'Kiosk'];

export function CheckInTextTemplates({ businessId, onDirtyChange }: {
  businessId: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [language, setLanguage] = useState<string>(DEFAULT_LANGUAGE);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});

  const defaults = isSupportedLanguage(language) ? CHECK_IN_TEXT_DEFAULTS[language] : CHECK_IN_TEXT_DEFAULTS[DEFAULT_LANGUAGE];

  const load = useCallback(() => {
    setLoading(true); setError(null); setNote(null);
    api.getCheckInTexts(businessId, language)
      .then((r) => { setSaved(r.overrides); setValues(r.overrides); })
      .catch(() => setError('Could not load the wording.'))
      .finally(() => setLoading(false));
  }, [businessId, language]);
  useEffect(() => { load(); }, [load]);

  const clean = (v: Record<string, string>) => Object.fromEntries(Object.entries(v).filter(([, x]) => x.trim() !== ''));
  const dirty = useMemo(() => JSON.stringify(clean(values)) !== JSON.stringify(clean(saved)), [values, saved]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const save = async () => {
    setSaving(true); setError(null); setNote(null);
    try {
      const r = await api.saveCheckInTexts(businessId, language, clean(values));
      setSaved(r.overrides); setValues(r.overrides);
      setNote('Saved.');
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || 'Could not save the wording.');
    } finally { setSaving(false); }
  };

  const focusedField = CHECK_IN_TEXT_FIELDS.find((f) => f.key === focusedKey);
  const insertPlaceholder = (token: string) => {
    if (!focusedKey) return;
    const el = inputs.current[focusedKey];
    const text = '{{' + token + '}}';
    const current = values[focusedKey] ?? '';
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    setValues((v) => ({ ...v, [focusedKey]: current.slice(0, start) + text + current.slice(end) }));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + text.length, start + text.length); });
  };

  return (
    <div>
      <p style={s.description}>
        These are the words customers see when they check in from their phone or at the kiosk, and in the list of
        forms. Leave a box empty to use the built-in wording. Where a piece of wording can include the customer's
        details, the box lists them: write them as {'{{first_name}}'}.
      </p>
      {error && <p style={s.error} role="alert">{error}</p>}
      {note && <p style={s.note} role="status">{note}</p>}

      <div style={s.chipArea}>
        <span style={s.chipTitle}>Insert details</span>
        <span style={s.helper}>
          {focusedField ? `Click a detail to add it where your cursor is in "${focusedField.label}".` : 'Click into a box below, then click a detail to add it.'}
        </span>
        <div style={s.chips}>
          {CHECK_IN_TEXT_PLACEHOLDERS.map((p) => {
            const allowed = !!focusedField && !!focusedField.placeholders?.includes(p.token);
            return (
              <button key={p.token} type="button" style={{ ...s.chip, ...(allowed ? {} : s.chipOff) }}
                disabled={!allowed} onMouseDown={(e) => e.preventDefault()} onClick={() => insertPlaceholder(p.token)}
                title={allowed ? `${p.description} Example: ${p.sample}` : focusedField ? 'This wording cannot include that detail.' : 'Click into a box first.'}>
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={s.field}>
        <label style={s.label} htmlFor="cit-lang">Language</label>
        <LanguageSelect id="cit-lang" style={s.input} value={language} onChange={setLanguage} disabled={dirty || saving} />
        {dirty && <span style={s.helper}>Save or discard your changes before choosing another language.</span>}
      </div>

      {loading ? <p style={s.muted}>Loading…</p> : GROUPS.map((group) => (
        <fieldset key={group} style={s.group}>
          <legend style={s.legend}>{group}</legend>
          {CHECK_IN_TEXT_FIELDS.filter((f) => f.group === group).map((f) => {
            const def = defaults[f.key];
            const id = `cit-${f.key}`;
            return (
              <div key={f.key} style={s.field}>
                <label style={s.label} htmlFor={id}>{f.label}</label>
                {def.length > 60 ? (
                  <textarea id={id} ref={(el) => { inputs.current[f.key] = el; }} onFocus={() => setFocusedKey(f.key)} style={{ ...s.input, minHeight: '64px' }} rows={2} maxLength={400}
                    value={values[f.key] ?? ''} placeholder={def}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                ) : (
                  <input id={id} ref={(el) => { inputs.current[f.key] = el; }} onFocus={() => setFocusedKey(f.key)} style={s.input} maxLength={400} value={values[f.key] ?? ''} placeholder={def}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                )}
                {f.placeholders && (
                  <span style={s.helper}>You can include: {f.placeholders.map((p) => `{{${p}}}`).join(', ')}</span>
                )}
              </div>
            );
          })}
        </fieldset>
      ))}

      <div style={s.actions}>
        <Button onClick={save} loading={saving} disabled={!dirty}>Save wording</Button>
        <Button variant="ghost" onClick={() => setValues(saved)} disabled={!dirty || saving}>Discard changes</Button>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  description: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-lg) 0', lineHeight: 1.5, maxWidth: '640px' },
  muted: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-base)' },
  error: { color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-md) 0' },
  note: { color: 'var(--color-success)', fontSize: 'var(--font-size-sm)', margin: '0 0 var(--space-md) 0' },
  group: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', padding: 'var(--space-md)', margin: '0 0 var(--space-lg) 0' },
  legend: { padding: '0 var(--space-xs)', fontWeight: 600, color: 'var(--color-text)', fontSize: 'var(--font-size-base)' },
  field: { marginBottom: 'var(--space-md)', maxWidth: '640px' },
  label: { display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', marginBottom: '4px' },
  helper: { display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: '4px' },
  input: { width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', fontSize: 'var(--font-size-base)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', boxSizing: 'border-box' },
  chipArea: { position: 'sticky', top: 'calc(var(--app-topbar-height, 76px) + var(--page-top-h, 0px))', zIndex: 5, background: 'var(--color-background)', margin: '0 0 var(--space-md) 0', padding: 'var(--space-sm) var(--space-md)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md, 8px)', maxWidth: '640px' },
  chipTitle: { display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' },
  chip: { padding: '4px 10px', fontSize: 'var(--font-size-xs)', borderRadius: 'var(--radius-full, 9999px)', border: '1px solid var(--color-accent)', background: 'transparent', color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  chipOff: { opacity: 0.4, cursor: 'not-allowed' },
  actions: { display: 'flex', gap: '12px', marginTop: 'var(--space-md)', flexWrap: 'wrap' },
};
