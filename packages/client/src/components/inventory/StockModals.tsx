import { useState } from 'react';
import { Modal } from '../../design-system/components/feedback/Modal';
import { Button } from '../../design-system/components/actions/Button';
import * as inventoryApi from '../../api/inventory';
import type { AdjustReason } from '../../api/inventory';
import { formatCurrency } from '../../utils/currency';
import { formatNumber } from '../../utils/format';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

/**
 * Change stock (Set count / Add / Remove) and reorder level windows for one stock item at one
 * location (spec 51, gap 7). Used on the product page and on Offerings > Inventory. Each change is
 * recorded straight away as a movement in the item's history.
 */
export interface StockItemLine {
  location_id: string; location_name: string; variant_id: string | null; variant_name: string | null;
  on_hand: number; reorder_level?: number | null; reorder_qty?: number | null;
}

const toCents = (s: string): number | null => (s.trim() === '' ? null : Math.max(0, Math.round(parseFloat(s) * 100) || 0));
const title = (t: TFunction, productName: string | undefined, l: StockItemLine) => {
  const what = [productName, l.variant_name].filter(Boolean).join(' · ');
  return what && l.location_name ? t('stock.titleAt', { what, location: l.location_name }) : what || l.location_name || '';
};
const errorText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

const s: Record<string, React.CSSProperties> = {
  group: { display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)' },
  input: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-sm) var(--space-md)', fontSize: 'var(--font-size-base)', width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)' },
  hint: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  muted: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 },
  error: { color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: 0 },
};

export function ChangeStockModal({ line, productId, productName, businessId, defaultCost, onClose, onDone }: {
  line: StockItemLine; productId: string; productName?: string; businessId: string; defaultCost: number | null;
  onClose: () => void; onDone: () => void;
}) {
  const { t } = useTranslation('inventory');
  const [mode, setMode] = useState<'set' | 'add' | 'remove'>('set');
  const [qty, setQty] = useState(String(line.on_hand));
  const [reason, setReason] = useState<AdjustReason | ''>('');
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const n = Number(qty);
  const valid = qty.trim() !== '' && Number.isInteger(n) && n >= 0 && (mode === 'set' || (n > 0 && !!reason)) && !(mode === 'remove' && n > line.on_hand);
  const after = mode === 'set' ? n : mode === 'add' ? line.on_hand + n : line.on_hand - n;
  const incoming = valid && after > line.on_hand;

  const pickMode = (m: 'set' | 'add' | 'remove') => { setMode(m); setQty(m === 'set' ? String(line.on_hand) : ''); setReason(''); setErr(''); };
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!valid) return;
    setSaving(true); setErr('');
    try {
      await inventoryApi.changeStock(productId, {
        business_id: businessId, location_id: line.location_id, variant_id: line.variant_id, mode, qty: n,
        reason: mode === 'set' ? undefined : (reason as AdjustReason), unit_cost_cents: incoming ? toCents(cost) : null, note: note || null,
      });
      onDone();
    } catch (e2) { setErr(errorText(e2, t('stock.changeFailed'))); }
    finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={t('stock.changeTitle', { title: title(t, productName, line) })} size="sm"
      footer={<>
        <Button variant="secondary" type="button" onClick={onClose}>{t('common:cancel')}</Button>
        <Button onClick={() => submit()} disabled={!valid} loading={saving}>{t('common:save')}</Button>
      </>}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <p style={s.muted}>{t('stock.onHandNow')} <strong>{line.on_hand}</strong></p>
        <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
          <Button type="button" size="sm" variant={mode === 'set' ? 'primary' : 'secondary'} onClick={() => pickMode('set')}>{t('stock.setCount')}</Button>
          <Button type="button" size="sm" variant={mode === 'add' ? 'primary' : 'secondary'} onClick={() => pickMode('add')}>{t('stock.add')}</Button>
          <Button type="button" size="sm" variant={mode === 'remove' ? 'primary' : 'secondary'} onClick={() => pickMode('remove')}>{t('stock.remove')}</Button>
        </div>
        <div style={s.group}>
          <label style={s.label}>{mode === 'set' ? t('stock.countedOnHand') : mode === 'add' ? t('stock.quantityToAdd') : t('stock.quantityToRemove')}</label>
          <input style={s.input} type="number" min={0} step={1} max={mode === 'remove' ? line.on_hand : undefined} value={qty}
            onChange={(e) => setQty(mode === 'remove' && Number(e.target.value) > line.on_hand ? String(line.on_hand) : e.target.value)} autoFocus />
        </div>
        {mode !== 'set' && (
          <div style={s.group}>
            <label style={s.label}>{t('stock.reasonRequired')}</label>
            <select style={s.input} value={reason} onChange={(e) => setReason(e.target.value as AdjustReason | '')}>
              <option value="">{t('stock.choose')}</option>
              {inventoryApi.ADJUST_REASONS
                .filter((r) => (mode === 'add' ? ['found', 'correction'] : ['damaged', 'lost', 'used_in_service', 'correction']).includes(r.value))
                .map((r) => <option key={r.value} value={r.value}>{t(r.label)}</option>)}
            </select>
          </div>
        )}
        {incoming && (
          <div style={s.group}>
            <label style={s.label}>{t('stock.costOfEach')}</label>
            <input style={s.input} type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)}
              placeholder={defaultCost != null ? t('stock.costIfEmpty', { amount: formatCurrency(defaultCost) }) : t('stock.optional')} />
          </div>
        )}
        <div style={s.group}>
          <label style={s.label}>{t('stock.note')}</label>
          <input style={s.input} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t('stock.optional')} />
        </div>
        {valid && <p style={s.muted}>{t('stock.onHandAfter')} <strong>{after}</strong></p>}
        {err && <p style={s.error}>{err}</p>}
      </form>
    </Modal>
  );
}

export function ReorderModal({ line, productId, productName, businessId, onClose, onDone }: {
  line: StockItemLine; productId: string; productName?: string; businessId: string; onClose: () => void; onDone: () => void;
}) {
  const { t } = useTranslation('inventory');
  const [level, setLevel] = useState(line.reorder_level == null ? '' : String(line.reorder_level));
  const [qty, setQty] = useState(line.reorder_qty == null ? '' : String(line.reorder_qty));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const whole = (v: string, min: number) => v.trim() === '' || (Number.isInteger(Number(v)) && Number(v) >= min);
  const valid = whole(level, 0) && whole(qty, 1);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!valid) return;
    setSaving(true); setErr('');
    try {
      await inventoryApi.setReorder(productId, {
        business_id: businessId, location_id: line.location_id, variant_id: line.variant_id,
        reorder_level: level.trim() === '' ? null : Number(level), reorder_qty: qty.trim() === '' ? null : Number(qty),
      });
      onDone();
    } catch (e2) { setErr(errorText(e2, t('stock.reorderSaveFailed'))); }
    finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={t('stock.reorderTitle', { title: title(t, productName, line) })} size="sm"
      footer={<>
        <Button variant="secondary" type="button" onClick={onClose}>{t('common:cancel')}</Button>
        <Button onClick={() => submit()} disabled={!valid} loading={saving}>{t('common:save')}</Button>
      </>}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <div style={s.group}>
          <label style={s.label}>{t('stock.reorderAt')}</label>
          <input style={s.input} type="number" min={0} step={1} value={level} onChange={(e) => setLevel(e.target.value)} placeholder={t('stock.noReorderLevel')} autoFocus />
          <span style={s.hint}>{t('stock.reorderHelp')}</span>
        </div>
        <div style={s.group}>
          <label style={s.label}>{t('stock.reorderQuantity')}</label>
          <input style={s.input} type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} placeholder={t('stock.optional')} />
          <span style={s.hint}>{t('stock.reorderQuantityHelp')}</span>
        </div>
        {err && <p style={s.error}>{err}</p>}
      </form>
    </Modal>
  );
}

/** Locations that appear in a product's stock lines, primary first (the order the server gives). */
function locationsOf(lines: StockItemLine[]) {
  const seen = new Map<string, string>();
  for (const l of lines) if (!seen.has(l.location_id)) seen.set(l.location_id, l.location_name);
  return [...seen].map(([id, name]) => ({ id, name }));
}
const optionName = (t: TFunction, l: StockItemLine, productName?: string) => l.variant_name || productName || t('stock.thisProduct');
const tableStyles: Record<string, React.CSSProperties> = {
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' },
  th: { textAlign: 'left', padding: 'var(--space-xs) var(--space-sm)', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontWeight: 600 },
  td: { padding: 'var(--space-xs) var(--space-sm)', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)', verticalAlign: 'middle' },
  num: { width: '80px', textAlign: 'right', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-xs) var(--space-sm)', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)' },
};

/**
 * Count: enter what is on the shelf for each option of the product at one location. Each count that
 * differs from on hand sets it (a count movement; the first one is the opening stock). Empty: not changed.
 */
export function CountModal({ lines, productId, productName, businessId, onClose, onDone }: {
  lines: StockItemLine[]; productId: string; productName?: string; businessId: string; onClose: () => void; onDone: () => void;
}) {
  const { t } = useTranslation('inventory');
  const locations = locationsOf(lines);
  const [locationId, setLocationId] = useState(locations[0]?.id || '');
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const here = lines.filter((l) => l.location_id === locationId);
  const keyOf = (l: StockItemLine) => `${l.location_id}:${l.variant_id || ''}`;
  const changes = here
    .map((l) => ({ l, v: (counted[keyOf(l)] ?? '').trim() }))
    .filter((x) => x.v !== '' && Number(x.v) !== x.l.on_hand);

  const submit = async () => {
    setSaving(true); setErr('');
    try {
      for (const { l, v } of changes) {
        await inventoryApi.changeStock(productId, {
          business_id: businessId, location_id: l.location_id, variant_id: l.variant_id, mode: 'set', qty: Number(v), note: note || null,
        });
      }
      onDone();
    } catch (e) { setErr(errorText(e, t('stock.countFailed'))); }
    finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={productName ? t('stock.countTitleNamed', { name: productName }) : t('stock.countTitle')} size="md"
      footer={<>
        <Button variant="secondary" type="button" onClick={onClose}>{t('common:cancel')}</Button>
        <Button onClick={submit} loading={saving} disabled={changes.length === 0}>{t('stock.saveCount')}</Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {locations.length > 1 && (
          <div style={s.group}>
            <label style={s.label}>{t('stock.location')}</label>
            <select style={s.input} value={locationId} onChange={(e) => { setLocationId(e.target.value); setCounted({}); }}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        )}
        <p style={s.muted}>{t('stock.countHelp')}</p>
        <table style={tableStyles.table}>
          <thead>
            <tr>
              <th style={tableStyles.th}>{t('stock.option')}</th>
              <th style={{ ...tableStyles.th, textAlign: 'right' }}>{t('stock.onHand')}</th>
              <th style={{ ...tableStyles.th, textAlign: 'right' }}>{t('stock.counted')}</th>
              <th style={{ ...tableStyles.th, textAlign: 'right' }}>{t('stock.difference')}</th>
            </tr>
          </thead>
          <tbody>
            {here.map((l, i) => {
              const v = (counted[keyOf(l)] ?? '').trim();
              const diff = v === '' ? null : Number(v) - l.on_hand;
              return (
                <tr key={keyOf(l)}>
                  <td style={tableStyles.td}>{optionName(t, l, productName)}</td>
                  <td style={{ ...tableStyles.td, textAlign: 'right' }}>{l.on_hand}</td>
                  <td style={{ ...tableStyles.td, textAlign: 'right' }}>
                    <input style={tableStyles.num} type="number" min={0} step={1} inputMode="numeric" autoFocus={i === 0}
                      aria-label={t('stock.countedAria', { option: optionName(t, l, productName) })} value={counted[keyOf(l)] ?? ''}
                      onChange={(e) => setCounted((p) => ({ ...p, [keyOf(l)]: e.target.value.replace(/[^0-9]/g, '') }))} />
                  </td>
                  <td style={{ ...tableStyles.td, textAlign: 'right', fontWeight: 600, color: !diff ? 'var(--color-text-secondary)' : diff < 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
                    {diff == null ? '' : formatNumber(diff, { signDisplay: 'exceptZero' })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={s.group}>
          <label style={s.label}>{t('stock.note')}</label>
          <input style={s.input} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t('stock.optionalExample')} />
        </div>
        {err && <p style={s.error}>{err}</p>}
      </div>
    </Modal>
  );
}

/** Move: take some of each option from one location to another; it arrives at once, at its cost. */
export function TransferModal({ lines, productId, productName, businessId, onClose, onDone }: {
  lines: StockItemLine[]; productId: string; productName?: string; businessId: string; onClose: () => void; onDone: () => void;
}) {
  const { t } = useTranslation('inventory');
  const locations = locationsOf(lines);
  const firstWithStock = lines.find((l) => l.on_hand > 0)?.location_id || locations[0]?.id || '';
  const [fromId, setFromId] = useState(firstWithStock);
  const [toId, setToId] = useState(locations.find((l) => l.id !== firstWithStock)?.id || '');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const from = lines.filter((l) => l.location_id === fromId);
  const onHandAt = (locId: string, variantId: string | null) => lines.find((l) => l.location_id === locId && l.variant_id === variantId)?.on_hand ?? 0;
  const keyOf = (l: StockItemLine) => l.variant_id || '';
  const moving = from.filter((l) => (qty[keyOf(l)] || 0) > 0);
  const units = moving.reduce((n, l) => n + (qty[keyOf(l)] || 0), 0);

  const submit = async () => {
    setSaving(true); setErr('');
    try {
      await inventoryApi.createTransfer({
        business_id: businessId, from_location_id: fromId, to_location_id: toId, note: note || null,
        lines: moving.map((l) => ({ merchandise_id: productId, variant_id: l.variant_id, qty: qty[keyOf(l)] })),
      });
      onDone();
    } catch (e) { setErr(errorText(e, t('stock.moveFailed'))); }
    finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={productName ? t('stock.moveTitleNamed', { name: productName }) : t('stock.moveTitle')} size="md"
      footer={<>
        <Button variant="secondary" type="button" onClick={onClose}>{t('common:cancel')}</Button>
        <Button onClick={submit} loading={saving} disabled={!toId || toId === fromId || units === 0}>{t('stock.move')} {units || ''}</Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
          <div style={s.group}>
            <label style={s.label}>{t('stock.from')}</label>
            <select style={s.input} value={fromId} onChange={(e) => { setFromId(e.target.value); setQty({}); if (e.target.value === toId) setToId(''); }}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div style={s.group}>
            <label style={s.label}>{t('stock.to')}</label>
            <select style={s.input} value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">{t('stock.choose')}</option>
              {locations.filter((l) => l.id !== fromId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </div>
        <table style={tableStyles.table}>
          <thead>
            <tr>
              <th style={tableStyles.th}>{t('stock.option')}</th>
              <th style={{ ...tableStyles.th, textAlign: 'right' }}>{t('stock.onHandHere')}</th>
              {toId && <th style={{ ...tableStyles.th, textAlign: 'right' }}>{t('stock.atDestination')}</th>}
              <th style={{ ...tableStyles.th, textAlign: 'right' }}>{t('stock.move')}</th>
            </tr>
          </thead>
          <tbody>
            {from.map((l) => (
              <tr key={keyOf(l)}>
                <td style={tableStyles.td}>{optionName(t, l, productName)}</td>
                <td style={{ ...tableStyles.td, textAlign: 'right' }}>{l.on_hand}</td>
                {toId && <td style={{ ...tableStyles.td, textAlign: 'right' }}>{onHandAt(toId, l.variant_id)}</td>}
                <td style={{ ...tableStyles.td, textAlign: 'right' }}>
                  <input style={tableStyles.num} type="number" min={0} max={l.on_hand} step={1} disabled={l.on_hand === 0}
                    aria-label={t('stock.moveAria', { option: optionName(t, l, productName) })} value={qty[keyOf(l)] ? String(qty[keyOf(l)]) : ''}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10) || 0;
                      setQty((p) => ({ ...p, [keyOf(l)]: Math.min(Math.max(0, n), l.on_hand) }));
                    }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={s.group}>
          <label style={s.label}>{t('stock.note')}</label>
          <input style={s.input} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t('stock.optional')} />
        </div>
        {err && <p style={s.error}>{err}</p>}
      </div>
    </Modal>
  );
}