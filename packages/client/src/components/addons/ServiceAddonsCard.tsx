import { useEffect, useState } from 'react';
import { Button } from '../../design-system/components/actions/Button';
import { Modal } from '../../design-system/components/feedback/Modal';
import { Input } from '../../design-system/components/forms/Input';
import { Textarea } from '../../design-system/components/forms/Textarea';
import { FormField } from '../../design-system/components/forms/FormField';
import { CurrencyInput } from '../CurrencyInput';
import { useDraft, draftBox, fieldMark, UnsavedTag, RowTag } from '../unsaved/DraftSections';
import * as addonsApi from '../../api/addons';
import type { ServiceAddon } from '../../api/addons';
import { formatCurrency } from '../../utils/currency';

/** One add-on of the service as shown and saved; `addon_id` is empty for one added and not saved yet. */
interface Row { key: string; addon_id: string | null; name: string; description: string | null; price: number }

let nextKey = 0;
const toRow = (a: ServiceAddon): Row => ({ key: a.id, addon_id: a.id, name: a.name, description: a.description, price: a.price });

/**
 * Service Details → Add-ons (spec 51, gap 15; owner, 24 Nov 2026): like the options, each add-on is
 * a row with a name, a description and a price, added with Add Add-on. They add no time. Saved with
 * the page's Save changes.
 */
export function ServiceAddonsCard({ serviceId, businessId }: { serviceId: string; businessId: string }) {
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const draft = useDraft<Row[]>('service-addons', 'Add-ons', [], async (rows) => {
    const saved = await addonsApi.setServiceAddons(serviceId, businessId,
      rows.map((r) => ({ addon_id: r.addon_id, name: r.name, description: r.description, price: r.price })));
    return saved.map(toRow);
  });
  const { load } = draft;

  useEffect(() => {
    if (!businessId) return;
    addonsApi.getServiceAddons(serviceId, businessId).then((list) => load(list.map(toRow))).catch(() => load([]));
  }, [serviceId, businessId, load]);

  const rows = draft.value;
  const savedRow = (key: string) => draft.saved.find((s) => s.key === key);
  const removedRows = draft.saved.filter((s) => !rows.some((r) => r.key === s.key));

  return (
    <div style={{ ...styles.card, ...draftBox(draft.dirty) }}>
      <div style={styles.head}>
        <h3 style={styles.title}>Add-ons<UnsavedTag dirty={draft.dirty} /></h3>
        <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>Add add-on</Button>
      </div>
      {rows.length === 0 && removedRows.length === 0 && <p style={styles.muted}>No add-ons. Add extras that enhance this service, such as hot stones with a massage. They add no time.</p>}
      <div style={styles.list}>
        {rows.map((r) => {
          const before = savedRow(r.key);
          const isNew = !before;
          const changed = !!before && (before.name !== r.name || before.description !== r.description || before.price !== r.price);
          return (
            <div key={r.key} style={{ ...styles.row, ...(changed ? fieldMark(true) : {}) }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{r.name}</strong> — {formatCurrency(r.price)}
                {isNew && <> <RowTag>New</RowTag></>}
                {changed && <> <RowTag>Changed</RowTag></>}
                {r.description && <div style={styles.desc}>{r.description}</div>}
              </div>
              <button type="button" style={styles.iconBtn} onClick={() => setEditing(r)} title="Edit" aria-label={`Edit ${r.name}`}>✏️</button>
              <button type="button" style={styles.iconBtn} onClick={() => draft.setValue(rows.filter((x) => x.key !== r.key))} title="Delete" aria-label={`Delete ${r.name}`}>×</button>
            </div>
          );
        })}
        {removedRows.map((r) => (
          <div key={r.key} style={{ ...styles.row, opacity: 0.6 }}>
            <div style={{ flex: 1 }}><s><strong>{r.name}</strong> — {formatCurrency(r.price)}</s> <RowTag>Deleted when you save</RowTag></div>
            <Button size="sm" variant="ghost" onClick={() => {
              // put it back where it was
              const order = draft.saved.map((s) => s.key);
              draft.setValue([...rows, r].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)));
            }}>Undo</Button>
          </div>
        ))}
      </div>
      {editing && (
        <AddonModal row={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onDone={(data) => {
            if (editing === 'new') draft.setValue([...rows, { key: `new-${nextKey++}`, addon_id: null, ...data }]);
            else draft.setValue(rows.map((x) => (x.key === editing.key ? { ...x, ...data } : x)));
            setEditing(null);
          }} />
      )}
    </div>
  );
}

function AddonModal({ row, onClose, onDone }: { row: Row | null; onClose: () => void; onDone: (data: { name: string; description: string | null; price: number }) => void }) {
  const [name, setName] = useState(row?.name || '');
  const [description, setDescription] = useState(row?.description || '');
  const [price, setPrice] = useState(row?.price ?? 0);
  const [err, setErr] = useState('');
  const done = () => {
    if (!name.trim()) { setErr('Enter a name.'); return; }
    onDone({ name: name.trim(), description: description.trim() || null, price });
  };
  return (
    <Modal open onClose={onClose} title={row ? 'Edit add-on' : 'Add add-on'} size="sm"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={done}>{row ? 'Done' : 'Add add-on'}</Button>
      </>}>
      <div style={styles.form}>
        <Input label="Name" name="addon-name" required value={name} onChange={(v) => { setName(v); if (err) setErr(''); }} maxLength={200} error={err || undefined} />
        <Textarea label="Description" name="addon-description" value={description} onChange={setDescription} rows={3} />
        <FormField label="Price" name="addon-price" required>
          <CurrencyInput id="addon-price" value={price} onChange={setPrice} style={styles.input} />
        </FormField>
        <p style={styles.desc}>Saved with the page's Save changes.</p>
      </div>
    </Modal>
  );
}

const styles: Record<string, React.CSSProperties> = {
  // the same card and title as the other sections of Service Details
  card: { padding: 'var(--space-lg)', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-md)' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' },
  title: { margin: 0, fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  muted: { fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)', margin: 0 },
  list: { display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' },
  row: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm) var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' },
  desc: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 },
  // square, at least 44 by 44 (style guide: touch targets and icon buttons)
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)', minWidth: '44px', minHeight: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)' },
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' },
  // the design system's input style (forms/Input), for the price field
  input: {
    background: 'var(--control-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--control-radius)',
    padding: '10px var(--control-padding-x)', fontSize: 'var(--control-font-size)', minHeight: 'var(--control-height)',
    color: 'var(--color-text)', fontFamily: 'var(--font-family)', outline: 'none', width: '100%', boxSizing: 'border-box',
  },
};
