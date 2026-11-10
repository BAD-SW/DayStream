import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { entriesByColumn, MAX_FORM_COLUMNS } from '@daystream/shared';
import type { FormDefinition, FormItem, FormAnswer } from '@daystream/shared';

/** True on a phone-sized screen, where a table of tick boxes folds into one column. */
function useNarrowScreen(): boolean {
  const query = '(max-width: 600px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

/**
 * Draws a form definition as the customer sees it (spec 51, gap 1). Used for the builder's
 * preview and for the public form page, so both always look the same.
 *
 * Answers are held by the caller. `renderSignature` lets the public page supply the drawing
 * pad; without it (the preview) a plain signature line is shown.
 */
export interface FormRendererProps {
  definition: FormDefinition;
  answers: Record<string, FormAnswer | undefined>;
  onChange: (itemId: string, value: FormAnswer) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
  renderSignature?: (item: Extract<FormItem, { type: 'signature' }>) => ReactNode;
  /** Prefix for element ids, so two renderers on one page don't clash. */
  idPrefix?: string;
}

export function FormRenderer({
  definition, answers, onChange, errors = {}, disabled, renderSignature, idPrefix = 'form',
}: FormRendererProps) {
  const narrow = useNarrowScreen();
  return (
    <div style={s.wrap}>
      {definition.items.map((item) => {
        const id = `${idPrefix}-${item.id}`;
        const err = errors[item.id];
        const errId = `${id}-err`;
        switch (item.type) {
          case 'heading':
            return <h2 key={item.id} style={s.heading}>{item.text}</h2>;
          case 'text':
            return <p key={item.id} style={s.paragraph}>{item.text}</p>;
          case 'write_in':
            return (
              <Field key={item.id} id={id} label={item.label} required={item.required} error={err} errId={errId}>
                <textarea id={id} rows={3} style={{ ...s.input, minHeight: '76px', resize: 'vertical' }} disabled={disabled}
                  value={typeof answers[item.id] === 'string' ? (answers[item.id] as string) : ''}
                  aria-invalid={!!err} aria-describedby={err ? errId : undefined}
                  onChange={(e) => onChange(item.id, e.target.value)} />
              </Field>
            );
          case 'date':
            return (
              <Field key={item.id} id={id} label={item.label} required={item.required} error={err} errId={errId}>
                <input id={id} style={s.input} type="date" disabled={disabled}
                  value={typeof answers[item.id] === 'string' ? (answers[item.id] as string) : ''}
                  aria-invalid={!!err} aria-describedby={err ? errId : undefined}
                  onChange={(e) => onChange(item.id, e.target.value)} />
              </Field>
            );
          case 'yes_no':
            return (
              <Choice key={item.id} legend={item.label} required={item.required} error={err} errId={errId}>
                {(['yes', 'no'] as const).map((v) => (
                  <label key={v} style={s.option}>
                    <input type="radio" name={id} disabled={disabled} checked={answers[item.id] === v}
                      onChange={() => onChange(item.id, v)} />
                    <span>{v === 'yes' ? 'Yes' : 'No'}</span>
                  </label>
                ))}
              </Choice>
            );
          case 'single_choice':
            return (
              <Choice key={item.id} legend={item.label} required={item.required} error={err} errId={errId}>
                {item.options.map((o) => (
                  <label key={o} style={s.option}>
                    <input type="radio" name={id} disabled={disabled} checked={answers[item.id] === o}
                      onChange={() => onChange(item.id, o)} />
                    <span>{o}</span>
                  </label>
                ))}
              </Choice>
            );
          case 'multi_choice': {
            const current = Array.isArray(answers[item.id]) ? (answers[item.id] as string[]) : [];
            return (
              <Choice key={item.id} legend={item.label} required={item.required} error={err} errId={errId}>
                {/* A table of tick boxes: entries run down each column, then across (one column on a phone). */}
                <div style={{ ...s.table, gridTemplateColumns: `repeat(${narrow ? 1 : Math.min(item.columns ?? 1, MAX_FORM_COLUMNS)}, minmax(0, 1fr))` }}>
                  {entriesByColumn(item.options, narrow ? 1 : item.columns ?? 1).map((col, c) => (
                    <div key={c} style={s.tableColumn}>
                      {col.map((o) => (
                        <label key={o} style={s.option}>
                          <input type="checkbox" disabled={disabled} checked={current.includes(o)}
                            onChange={() => onChange(item.id, current.includes(o) ? current.filter((v) => v !== o) : [...current, o])} />
                          <span>{o}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </Choice>
            );
          }
          case 'agree':
            return (
              <div key={item.id} style={s.field}>
                <label style={s.agree}>
                  <input id={id} type="checkbox" disabled={disabled} checked={answers[item.id] === true}
                    aria-invalid={!!err} aria-describedby={err ? errId : undefined}
                    onChange={(e) => onChange(item.id, e.target.checked)} />
                  <span>{item.label}</span>
                </label>
                {err && <span id={errId} role="alert" style={s.error}>{err}</span>}
              </div>
            );
          case 'signature':
            return (
              <div key={item.id} style={s.field}>
                <span style={s.label}>{item.label}<span style={s.req} aria-hidden="true">*</span></span>
                {renderSignature ? renderSignature(item) : <div style={s.signatureLine} aria-label="Signature line" />}
                {err && <span id={errId} role="alert" style={s.error}>{err}</span>}
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

function Field({ id, label, required, error, errId, children }: {
  id: string; label: string; required: boolean; error?: string; errId: string; children: ReactNode;
}) {
  return (
    <div style={s.field}>
      <label htmlFor={id} style={s.label}>
        {label}{required && <span style={s.req} aria-hidden="true">*</span>}
      </label>
      {children}
      {error && <span id={errId} role="alert" style={s.error}>{error}</span>}
    </div>
  );
}

function Choice({ legend, required, error, errId, children }: {
  legend: string; required: boolean; error?: string; errId: string; children: ReactNode;
}) {
  return (
    <fieldset style={s.fieldset} aria-describedby={error ? errId : undefined}>
      <legend style={s.label}>{legend}{required && <span style={s.req} aria-hidden="true">*</span>}</legend>
      <div style={s.options}>{children}</div>
      {error && <span id={errId} role="alert" style={s.error}>{error}</span>}
    </fieldset>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 'var(--space-md, 16px)' },
  heading: { margin: 'var(--space-md, 16px) 0 0 0', fontSize: 'var(--font-size-h3, 1.25rem)', fontWeight: 600, color: 'var(--color-text)' },
  paragraph: { margin: 0, fontSize: 'var(--font-size-base)', lineHeight: 1.6, color: 'var(--color-text)', whiteSpace: 'pre-wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: '4px' },
  fieldset: { border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)', padding: 0 },
  req: { color: 'var(--color-error)', marginLeft: '2px' },
  input: { width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', fontSize: 'var(--font-size-base)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', boxSizing: 'border-box' },
  options: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' },
  table: { display: 'grid', columnGap: 'var(--space-lg, 24px)', width: '100%' },
  tableColumn: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 },
  option: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-base)', color: 'var(--color-text)', cursor: 'pointer', minHeight: '32px' },
  agree: { display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: 'var(--font-size-base)', color: 'var(--color-text)', cursor: 'pointer', lineHeight: 1.5 },
  signatureLine: { height: '96px', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md, 8px)', background: 'var(--color-surface)' },
  error: { color: 'var(--color-error)', fontSize: 'var(--font-size-xs)' },
};
