import type { CheckInText } from '@daystream/shared';
import type { SelfForm } from '../../api/selfCheckIn';

/**
 * The forms for a customer's visit, shown on the kiosk and the phone page (spec 51, design 1.11a):
 * every form that applies, with a tick beside each completed one and a button beside each one still
 * to complete. Large touch targets, since customers use it on a tablet or a phone.
 */
export function SelfFormsList({ forms, busyGroupId, onFillIn, texts }: {
  forms: SelfForm[];
  /** The screen's wording, in the customer's language. */
  texts: CheckInText;
  busyGroupId?: string | null;
  onFillIn: (groupId: string) => void;
}) {
  if (forms.length === 0) return null;
  const todo = forms.filter((f) => f.status !== 'done').length;
  return (
    <section aria-label={texts.formsLabel} style={s.section}>
      <h2 style={s.heading}>
        {todo === 0
          ? texts.formsAllDone
          : todo === 1 ? texts.formsOne : texts.formsMany}
      </h2>
      <ul style={s.list}>
        {forms.map((f) => {
          const done = f.status === 'done';
          return (
            <li key={f.groupId} style={{ ...s.row, ...(done ? s.rowDone : s.rowTodo) }}>
              <span style={s.name}>
                <span aria-hidden="true" style={{ ...s.mark, ...(done ? s.markDone : s.markTodo) }}>{done ? '✓' : '!'}</span>
                <span>
                  {f.name}
                  <span style={s.state}>{done ? texts.formDone : f.status === 'out_of_date' ? texts.formRedo : texts.formTodo}</span>
                </span>
              </span>
              {!done && (
                <button type="button" style={s.button} disabled={busyGroupId === f.groupId} onClick={() => onFillIn(f.groupId)}>
                  {busyGroupId === f.groupId ? texts.formOpening : texts.formFill}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const s: Record<string, React.CSSProperties> = {
  section: { marginTop: 'var(--space-lg)', textAlign: 'left' },
  heading: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-h3, 1.25rem)', fontWeight: 600, color: 'var(--color-text)' },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-md)', padding: 'var(--space-md)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', flexWrap: 'wrap' },
  rowTodo: { background: 'var(--color-warning-bg)', borderColor: 'var(--color-warning)' },
  rowDone: { background: 'var(--color-success-bg)', borderColor: 'var(--color-success)' },
  name: { display: 'flex', alignItems: 'center', gap: 'var(--space-md)', fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--color-text)' },
  state: { display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 400, color: 'var(--color-text-secondary)' },
  mark: { flexShrink: 0, width: '32px', height: '32px', borderRadius: 'var(--radius-full)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 },
  markDone: { background: 'var(--color-success)', color: 'var(--color-surface)' },
  markTodo: { background: 'var(--color-warning)', color: 'var(--color-surface)' },
  button: { minHeight: '52px', minWidth: '120px', padding: '12px 24px', fontSize: 'var(--font-size-base)', fontWeight: 600, fontFamily: 'var(--font-family)', background: 'var(--color-primary)', color: 'var(--color-primary-contrast)', border: 'none', borderRadius: 'var(--button-radius)', cursor: 'pointer' },
};
