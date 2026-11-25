import { askConfirm } from '../../design-system/components/feedback/dialogs';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Badge } from '../../design-system/components/data/Badge';
import { Button } from '../../design-system/components/actions/Button';
import { Modal } from '../../design-system/components/feedback/Modal';
import { LeaveGuard, useGuardedNavigate } from '../../components/unsaved/LeaveGuard';
import { CurrencyInput } from '../../components/CurrencyInput';
import { apiClient } from '../../api/client';
import { getVendors } from '../../api/accounts-payable';
import { getLocations } from '../../api/locations';
import type { Location } from '../../api/locations';
import * as poApi from '../../api/purchase-orders';
import * as inventoryApi from '../../api/inventory';
import type { PurchaseOrder, PoInput, PoLine } from '../../api/purchase-orders';
import { formatCurrency } from '../../utils/currency';
import { formatDateOnly } from '../../utils/date';
import { useTranslation } from 'react-i18next';

/**
 * One purchase order (spec 51, gap 7; design 7.7). A draft is edited here (vendor, where it is
 * delivered, expected date, products, quantities and costs), then emailed to the vendor or marked
 * as sent. What arrives is received into stock at the delivery location, and what was received is
 * turned into a vendor bill (Inventory 1300 / Accounts Payable).
 */
interface Vendor { id: string; name: string; email: string | null; status?: string }
interface Product { id: string; name: string; track_stock?: boolean; status: string; cost_cents?: number | null; supplier_id?: string | null }
interface Variant { id: string; name: string; status: string; cost_cents?: number | null }
interface DraftLine { key: string; merchandise_id: string; variant_id: string | null; product_name: string; variant_name: string | null; qty_ordered: number; unit_cost_cents: number }
interface Draft { vendor_id: string; location_id: string; expected_on: string; note: string; lines: DraftLine[] }

const errorText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
const lineName = (l: { product_name: string; variant_name: string | null }) => (l.variant_name ? `${l.product_name} · ${l.variant_name}` : l.product_name);
const lineKey = (merchandiseId: string, variantId: string | null) => `${merchandiseId}:${variantId || ''}`;
const toInput = (d: Draft): PoInput => ({
  vendor_id: d.vendor_id, location_id: d.location_id, expected_on: d.expected_on || null, note: d.note || null,
  lines: d.lines.filter((l) => l.merchandise_id)
    .map((l) => ({ merchandise_id: l.merchandise_id, variant_id: l.variant_id, qty_ordered: l.qty_ordered, unit_cost_cents: l.unit_cost_cents })),
});
const fromPo = (po: PurchaseOrder): Draft => ({
  vendor_id: po.vendor_id, location_id: po.location_id, expected_on: po.expected_on ? String(po.expected_on).slice(0, 10) : '', note: po.note || '',
  lines: padRows(po.lines.map((l) => ({ key: lineKey(l.merchandise_id, l.variant_id), merchandise_id: l.merchandise_id, variant_id: l.variant_id,
    product_name: l.product_name, variant_name: l.variant_name, qty_ordered: l.qty_ordered, unit_cost_cents: l.unit_cost_cents }))),
});

export function PurchaseOrderPage() {
  const { t } = useTranslation('inventory');
  const { id } = useParams<{ id: string }>();
  const routeIsNew = !id || id === 'new';
  const navigate = useGuardedNavigate();
  const go = useNavigate();
  const businessId = localStorage.getItem('business_id') || '';
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(!routeIsNew);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [draft, setDraft] = useState<Draft>(() => ({ vendor_id: '', location_id: '', expected_on: '', note: '', lines: padRows([]) }));
  const [saved, setSaved] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [billing, setBilling] = useState(false);

  // New until the first save; after that, Save draft updates the same order.
  const isNew = routeIsNew && !po;
  const editable = isNew || po?.status === 'draft';
  const dirty = editable && JSON.stringify(toInput(draft)) !== saved;

  const fill = useCallback((p: PurchaseOrder) => {
    setPo(p);
    const d = fromPo(p);
    setDraft(d);
    setSaved(JSON.stringify(toInput(d)));
  }, []);

  useEffect(() => {
    if (!businessId) return;
    getVendors(businessId).then((v: Vendor[]) => setVendors((v || []).filter((x) => x.status !== 'inactive'))).catch(() => setVendors([]));
    getLocations(businessId, { status: 'active' }).then((l) => {
      setLocations(l || []);
      // a new order is delivered to the primary location unless changed
      if (routeIsNew) setDraft((d) => (d.location_id ? d : { ...d, location_id: (l || []).find((x) => x.is_primary)?.id || l?.[0]?.id || '' }));
    }).catch(() => setLocations([]));
    (async () => {
      const all: Product[] = [];
      for (let page = 1; page < 50; page++) {
        const res = await apiClient.get('/v1/merchandise', { params: { business_id: businessId, page, limit: 100 } });
        const data: Product[] = res.data.data || [];
        all.push(...data);
        if (data.length < 100) break;
      }
      setProducts(all.filter((p) => p.track_stock && p.status !== 'archived'));
    })().catch(() => setProducts([]));
  }, [businessId, routeIsNew]);

  useEffect(() => {
    if (routeIsNew) { setSaved(JSON.stringify(toInput({ vendor_id: '', location_id: '', expected_on: '', note: '', lines: [] }))); return; }
    if (!businessId || !id) return;
    if (po?.id === id) return; // just created here: already loaded
    setLoading(true);
    poApi.getPurchaseOrder(businessId, id).then(fill).catch(() => setPo(null)).finally(() => setLoading(false));
  }, [businessId, id, routeIsNew, fill]); // eslint-disable-line react-hooks/exhaustive-deps

  // Saved: a new order is created and opened; a draft is updated.
  const saveDraft = async (): Promise<PurchaseOrder | null> => {
    if (!draft.vendor_id) { setMessage({ text: t('po.chooseVendor'), error: true }); return null; }
    if (!draft.location_id) { setMessage({ text: t('po.chooseLocation'), error: true }); return null; }
    if (!draft.lines.some((l) => l.merchandise_id)) { setMessage({ text: t('po.addProduct'), error: true }); return null; }
    if (isNew) {
      const created = await poApi.createPurchaseOrder(businessId, toInput(draft));
      setSaved(JSON.stringify(toInput(draft)));
      const full = await poApi.getPurchaseOrder(businessId, created.id);
      fill(full);
      go(`/accounting/purchase-orders/${created.id}`, { replace: true });
      return full;
    }
    if (!dirty && po) return po;
    const updated = await poApi.updatePurchaseOrder(businessId, po!.id, toInput(draft));
    fill(updated);
    return updated;
  };

  const run = async (key: string, fn: () => Promise<string | null>) => {
    setBusy(key); setMessage(null);
    try { const text = await fn(); if (text) setMessage({ text }); }
    catch (e) { setMessage({ text: errorText(e, t('po.wentWrong')), error: true }); }
    finally { setBusy(null); }
  };

  const handleSave = () => run('save', async () => ((await saveDraft()) ? t('po.saved') : null));
  const handleSend = (email: boolean) => run(email ? 'email' : 'mark', async () => {
    const p = await saveDraft();
    if (!p) return null;
    const out = await poApi.sendPurchaseOrder(businessId, p.id, email);
    fill(await poApi.getPurchaseOrder(businessId, p.id));
    return out.emailedTo ? t('po.emailedTo', { email: out.emailedTo }) : t('po.markedSent');
  });
  const handleClose = async () => {
    if (!po) return;
    const cancel = po.status === 'draft' || po.status === 'sent';
    if (!(await askConfirm({ message: cancel ? t('po.cancelConfirm') : t('po.closeConfirm'), confirmLabel: cancel ? t('common:action.cancelOrder') : t('common:action.continue'), destructive: cancel }))) return;
    run('close', async () => {
      await poApi.closePurchaseOrder(businessId, po.id);
      fill(await poApi.getPurchaseOrder(businessId, po.id));
      return cancel ? t('po.cancelled') : t('po.closed');
    });
  };

  const vendor = vendors.find((v) => v.id === draft.vendor_id);
  const total = draft.lines.reduce((t, l) => t + l.qty_ordered * l.unit_cost_cents, 0);
  const toBill = po ? po.lines.reduce((t, l) => t + (l.qty_received - l.qty_billed) * l.unit_cost_cents, 0) : 0;
  const canReceive = po && (po.status === 'sent' || po.status === 'partly_received');

  if (loading) return <div style={styles.page}><p style={styles.muted}>{t('po.loading')}</p></div>;
  if (!isNew && !po) return <div style={styles.page}><p style={styles.muted}>{t('po.notFound')}</p></div>;

  return (
    <div style={styles.page}>
      <LeaveGuard when={dirty} />
      <button style={styles.back} onClick={() => navigate('/accounting?tab=purchase_orders')}>{t('po.back')}</button>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>{po ? t('po.title', { number: po.po_number }) : t('po.list.new')}</h1>
          {po && (
            <span style={styles.muted}>
              {po.created_by_name ? t('po.createdBy', { date: formatDateOnly(po.created_at), name: po.created_by_name }) : t('po.created', { date: formatDateOnly(po.created_at) })}
              {po.sent_at && ` · ${t('po.sentOn', { date: formatDateOnly(po.sent_at) })}`}
            </span>
          )}
        </div>
        {po && <Badge variant={poApi.PO_STATUS[po.status].variant}>{t(poApi.PO_STATUS[po.status].label)}</Badge>}
      </div>

      {/* Order details */}
      <div style={styles.card}>
        <div style={styles.grid}>
          <div style={styles.group}>
            <label style={styles.label}>{t('po.list.vendor')} {editable && <span style={styles.req}>*</span>}</label>
            {editable ? (
              <select style={styles.input} value={draft.vendor_id} onChange={(e) => setDraft({ ...draft, vendor_id: e.target.value })}>
                <option value="">{t('stock.choose')}</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            ) : <span style={styles.value}>{po?.vendor_name}{po?.vendor_email ? ` · ${po.vendor_email}` : ''}</span>}
            {editable && vendors.length === 0 && <span style={styles.hint}>{t('po.addVendorFirst')}</span>}
          </div>
          <div style={styles.group}>
            <label style={styles.label}>{t('po.list.deliverTo')} {editable && <span style={styles.req}>*</span>}</label>
            {editable && locations.length > 1 ? (
              <select style={styles.input} value={draft.location_id} onChange={(e) => setDraft({ ...draft, location_id: e.target.value })}>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            ) : <span style={styles.value}>{po?.location_name || locations.find((l) => l.id === draft.location_id)?.name || '—'}</span>}
          </div>
          <div style={styles.group}>
            <label style={styles.label}>{t('po.list.expected')}</label>
            {editable
              ? <input style={styles.input} type="date" value={draft.expected_on} onChange={(e) => setDraft({ ...draft, expected_on: e.target.value })} />
              : <span style={styles.value}>{po?.expected_on ? formatDateOnly(po.expected_on) : '—'}</span>}
          </div>
          <div style={{ ...styles.group, gridColumn: '1 / -1' }}>
            <label style={styles.label}>{t('po.vendorNote')}</label>
            {editable
              ? <input style={styles.input} value={draft.note} maxLength={1000} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder={t('stock.optional')} />
              : <span style={styles.value}>{po?.note || '—'}</span>}
          </div>
        </div>
      </div>

      {/* Products */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>{t('po.products')}</h3>
        {editable ? (
          <DraftLines draft={draft} setDraft={setDraft} products={products} vendorId={draft.vendor_id} businessId={businessId} />
        ) : (
          <LinesTable lines={po!.lines} />
        )}
        <div style={styles.totalRow}><span>{t('po.total')}</span><strong>{formatCurrency(editable ? total : po!.lines.reduce((t, l) => t + l.qty_ordered * l.unit_cost_cents, 0))}</strong></div>
      </div>

      {/* Bills */}
      {po && po.bills.length > 0 && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>{t('po.bills')}</h3>
          {po.bills.map((b) => (
            <div key={b.id} style={styles.billRow}>
              <span>{b.invoice_number ? t('po.invoiceNumber', { number: b.invoice_number }) : t('po.bill')} · {formatDateOnly(b.created_at)}</span>
              <span style={styles.muted}>{t('po.dueOn', { date: formatDateOnly(b.due_date) })} · {t(`po.billStatus.${b.status}`, { defaultValue: b.status })}</span>
              <strong>{formatCurrency(b.amount)}</strong>
            </div>
          ))}
          <button style={styles.link} onClick={() => navigate('/accounting?tab=bills')}>{t('po.openBills')}</button>
        </div>
      )}

      {message && <p role="status" style={{ ...styles.muted, color: message.error ? 'var(--color-error)' : 'var(--color-text)', marginBottom: 'var(--space-md)' }}>{message.text}</p>}

      <div style={styles.actions}>
        {po && ['draft', 'sent', 'partly_received'].includes(po.status) && (
          <Button variant="destructive" onClick={handleClose} loading={busy === 'close'} disabled={!!busy}>
            {po.status === 'partly_received' ? t('po.closeOrder') : t('po.cancelOrder')}
          </Button>
        )}
        <div style={{ flex: 1 }} />
        {editable && <Button variant="secondary" onClick={handleSave} loading={busy === 'save'} disabled={!!busy || (!dirty && !isNew)}>{t('po.saveDraft')}</Button>}
        {editable && <Button variant="secondary" onClick={() => handleSend(false)} loading={busy === 'mark'} disabled={!!busy}>{t('po.markAsSent')}</Button>}
        {editable && (
          <Button onClick={() => handleSend(true)} loading={busy === 'email'} disabled={!!busy || !vendor?.email}
            title={vendor && !vendor.email ? t('po.noVendorEmail') : undefined}>
            {t('po.emailVendor')}
          </Button>
        )}
        {po?.status === 'sent' && <Button variant="secondary" onClick={() => handleSend(true)} loading={busy === 'email'} disabled={!!busy || !po.vendor_email}>{t('po.emailAgain')}</Button>}
        {canReceive && <Button onClick={() => setReceiving(true)} disabled={!!busy}>{t('po.receive')}</Button>}
        {po && toBill > 0 && <Button variant="secondary" onClick={() => setBilling(true)} disabled={!!busy}>{t('po.createBill', { amount: formatCurrency(toBill) })}</Button>}
      </div>

      {receiving && po && (
        <ReceiveModal po={po} businessId={businessId} onClose={() => setReceiving(false)}
          onDone={async (text) => { setReceiving(false); fill(await poApi.getPurchaseOrder(businessId, po.id)); setMessage({ text }); }} />
      )}
      {billing && po && (
        <BillModal po={po} amount={toBill} businessId={businessId} onClose={() => setBilling(false)}
          onDone={async (text) => { setBilling(false); fill(await poApi.getPurchaseOrder(businessId, po.id)); setMessage({ text }); }} />
      )}
    </div>
  );
}

// --- Editing the products of a draft: a table of rows (owner, 18 Nov 2026), 1 to start, more with Add row ---

const MIN_ROWS = 1;
let rowSeq = 0;
const emptyRow = (): DraftLine => ({ key: `row-${++rowSeq}`, merchandise_id: '', variant_id: null, product_name: '', variant_name: null, qty_ordered: 1, unit_cost_cents: 0 });
/** Rows to show: the order's lines, then empty rows up to MIN_ROWS. */
const padRows = (lines: DraftLine[]) => [...lines, ...Array.from({ length: Math.max(0, MIN_ROWS - lines.length) }, emptyRow)];

function DraftLines({ draft, setDraft, products, vendorId, businessId }: {
  draft: Draft; setDraft: React.Dispatch<React.SetStateAction<Draft>>; products: Product[]; vendorId: string; businessId: string;
}) {
  const { t } = useTranslation('inventory');
  const [variantsOf, setVariantsOf] = useState<Record<string, Variant[]>>({});
  // The quantity starts at the reorder quantity set for the product (or variant) at the delivery
  // location (owner, 19 Nov 2026); 1 when none is set. Staff can change it.
  const reorderQty = async (productId: string, variantId: string | null): Promise<number> => {
    try {
      const s = await inventoryApi.getProductStock(productId, businessId);
      const line = s.lines.find((l) => l.location_id === draft.location_id && (l.variant_id ?? null) === variantId);
      return line?.reorder_qty && line.reorder_qty > 0 ? line.reorder_qty : 1;
    } catch { return 1; }
  };
  const fromVendor = useMemo(() => products.filter((p) => vendorId && p.supplier_id === vendorId), [products, vendorId]);
  const others = useMemo(() => products.filter((p) => !(vendorId && p.supplier_id === vendorId)), [products, vendorId]);

  // The options of every product on the order (loaded once per product).
  useEffect(() => {
    const missing = [...new Set(draft.lines.map((l) => l.merchandise_id).filter((id) => id && !variantsOf[id]))];
    missing.forEach((id) => {
      apiClient.get(`/v1/merchandise/${id}/variants`)
        .then((r) => setVariantsOf((m) => ({ ...m, [id]: ((r.data.data || []) as Variant[]).filter((v) => v.status !== 'inactive') })))
        .catch(() => setVariantsOf((m) => ({ ...m, [id]: [] })));
    });
  }, [draft.lines, variantsOf]);

  const setRow = (key: string, patch: Partial<DraftLine>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  const pickProduct = (row: DraftLine, productId: string) => {
    const p = products.find((x) => x.id === productId);
    setRow(row.key, p
      ? { merchandise_id: p.id, product_name: p.name, variant_id: null, variant_name: null, unit_cost_cents: p.cost_cents ?? 0, qty_ordered: 1 }
      : { merchandise_id: '', product_name: '', variant_id: null, variant_name: null, unit_cost_cents: 0, qty_ordered: 1 });
    // A product without variants is ordered as it is: its reorder quantity applies now.
    if (p) reorderQty(p.id, null).then((q) => setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === row.key && l.merchandise_id === p.id && !l.variant_id ? { ...l, qty_ordered: q } : l)) })));
  };
  const pickVariant = (row: DraftLine, variantId: string) => {
    const v = (variantsOf[row.merchandise_id] || []).find((x) => x.id === variantId);
    const p = products.find((x) => x.id === row.merchandise_id);
    setRow(row.key, { variant_id: v?.id ?? null, variant_name: v?.name ?? null, unit_cost_cents: v?.cost_cents ?? p?.cost_cents ?? row.unit_cost_cents });
    if (v) reorderQty(row.merchandise_id, v.id).then((q) => setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === row.key && l.variant_id === v.id ? { ...l, qty_ordered: q } : l)) })));
  };
  const clearRow = (row: DraftLine) => {
    const rest = draft.lines.filter((l) => l.key !== row.key);
    setDraft({ ...draft, lines: rest.length < MIN_ROWS ? padRows(rest) : rest });
  };
  const used = (row: DraftLine) => new Set(draft.lines.filter((l) => l.key !== row.key && l.merchandise_id).map((l) => lineKey(l.merchandise_id, l.variant_id)));

  return (
    <>
      <table style={{ ...styles.table, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '34%' }} /><col style={{ width: '24%' }} /><col style={{ width: '12%' }} />
          <col style={{ width: '14%' }} /><col style={{ width: '12%' }} /><col style={{ width: '4%' }} />
        </colgroup>
        <thead>
          <tr>
            <th style={styles.th}>{t('po.product')}</th>
            <th style={styles.th}>{t('po.variant')}</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>{t('po.quantity')}</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>{t('po.unitCost')}</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>{t('po.total')}</th>
            <th style={styles.th} />
          </tr>
        </thead>
        <tbody>
          {draft.lines.map((row, i) => {
            const options = row.merchandise_id ? variantsOf[row.merchandise_id] : undefined;
            const hasOptions = !!options && options.length > 0;
            const taken = used(row);
            const missingOption = hasOptions && !row.variant_id;
            return (
              <tr key={row.key}>
                <td style={styles.td}>
                  <select style={styles.cell} value={row.merchandise_id} onChange={(e) => pickProduct(row, e.target.value)} aria-label={t('po.productRow', { row: i + 1 })}>
                    {/* the prompt shows in the box but is not one of the choices */}
                    <option value="" disabled hidden>{products.length ? t('po.chooseProduct') : t('po.noTrackedProducts')}</option>
                    {[...fromVendor, ...others].map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </td>
                <td style={styles.td}>
                  <select style={{ ...styles.cell, ...(missingOption ? styles.cellMissing : {}) }} value={row.variant_id || ''} disabled={!hasOptions}
                    onChange={(e) => pickVariant(row, e.target.value)} aria-label={t('po.variantRow', { row: i + 1 })}>
                    <option value="">{!row.merchandise_id ? '' : hasOptions ? t('stock.choose') : t('po.noVariants')}</option>
                    {(options || []).map((v) => (
                      <option key={v.id} value={v.id} disabled={taken.has(lineKey(row.merchandise_id, v.id))}>{v.name}</option>
                    ))}
                  </select>
                </td>
                <td style={styles.td}>
                  <input style={{ ...styles.cell, textAlign: 'right' }} type="number" min={1} step={1} value={row.qty_ordered} disabled={!row.merchandise_id}
                    aria-label={t('po.quantityRow', { row: i + 1 })} onChange={(e) => setRow(row.key, { qty_ordered: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
                </td>
                <td style={styles.td}>
                  <CurrencyInput value={row.unit_cost_cents} onChange={(v) => setRow(row.key, { unit_cost_cents: Math.max(0, v) })} disabled={!row.merchandise_id}
                    style={{ ...styles.cell, textAlign: 'right' }} />
                </td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{row.merchandise_id ? formatCurrency(row.qty_ordered * row.unit_cost_cents) : ''}</td>
                <td style={{ ...styles.td, textAlign: 'center' }}>
                  {row.merchandise_id && <button style={styles.remove} aria-label={t('po.clearRow', { row: i + 1 })} onClick={() => clearRow(row)}>✕</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
        <Button size="sm" variant="secondary" onClick={() => setDraft({ ...draft, lines: [...draft.lines, emptyRow()] })}>{t('po.addRow')}</Button>
        <p style={{ ...styles.hint, margin: 0 }}>{t('po.addRowHelp')}</p>
      </div>
    </>
  );
}
function LinesTable({ lines }: { lines: PoLine[] }) {
  const { t } = useTranslation('inventory');
  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>{t('po.product')}</th>
          <th style={{ ...styles.th, textAlign: 'right' }}>{t('po.ordered')}</th>
          <th style={{ ...styles.th, textAlign: 'right' }}>{t('po.receivedCol')}</th>
          <th style={{ ...styles.th, textAlign: 'right' }}>{t('po.stillToCome')}</th>
          <th style={{ ...styles.th, textAlign: 'right' }}>{t('po.unitCost')}</th>
          <th style={{ ...styles.th, textAlign: 'right' }}>{t('po.billed')}</th>
          <th style={{ ...styles.th, textAlign: 'right' }}>{t('stock.onHand')}</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id}>
            <td style={styles.td}>{lineName(l)}{l.sku && <span style={styles.muted}> · {l.sku}</span>}</td>
            <td style={{ ...styles.td, textAlign: 'right' }}>{l.qty_ordered}</td>
            <td style={{ ...styles.td, textAlign: 'right' }}>{l.qty_received}</td>
            <td style={{ ...styles.td, textAlign: 'right' }}>{Math.max(0, l.qty_ordered - l.qty_received) || '—'}</td>
            <td style={{ ...styles.td, textAlign: 'right' }}>{formatCurrency(l.unit_cost_cents)}</td>
            <td style={{ ...styles.td, textAlign: 'right' }}>{l.qty_billed || '—'}</td>
            <td style={{ ...styles.td, textAlign: 'right' }}>{l.on_hand}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// --- Receiving and billing ---

function ReceiveModal({ po, businessId, onClose, onDone }: { po: PurchaseOrder; businessId: string; onClose: () => void; onDone: (text: string) => void }) {
  const { t } = useTranslation('inventory');
  const open = po.lines.filter((l) => l.qty_received < l.qty_ordered);
  const [qty, setQty] = useState<Record<string, number>>(Object.fromEntries(open.map((l) => [l.id, l.qty_ordered - l.qty_received])));
  const [cost, setCost] = useState<Record<string, number>>(Object.fromEntries(open.map((l) => [l.id, l.unit_cost_cents])));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const units = open.reduce((n, l) => n + (qty[l.id] || 0), 0);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const out = await poApi.receivePurchaseOrder(businessId, po.id,
        open.filter((l) => (qty[l.id] || 0) > 0).map((l) => ({ line_id: l.id, qty: qty[l.id], unit_cost_cents: cost[l.id] ?? null })), note || null);
      onDone(out.status === 'received' ? t('po.receivedAll', { units }) : t('po.receivedPart', { units }));
    } catch (e) { setErr(errorText(e, t('po.receiveFailed'))); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={t('po.receiveTitle', { number: po.po_number, location: po.location_name })} size="lg"
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t('common:cancel')}</Button>
        <Button onClick={submit} loading={busy} disabled={units === 0}>{t('po.receive')} {units || ''}</Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <p style={styles.muted}>{t('po.receiveHelp')}</p>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>{t('po.product')}</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>{t('po.stillToCome')}</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>{t('po.arrived')}</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>{t('po.unitCost')}</th>
            </tr>
          </thead>
          <tbody>
            {open.map((l) => {
              const left = l.qty_ordered - l.qty_received;
              return (
                <tr key={l.id}>
                  <td style={styles.td}>{lineName(l)}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{left}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    <input style={styles.num} type="number" min={0} max={left} step={1} value={qty[l.id] ?? 0} aria-label={t('po.arrivedAria', { name: lineName(l) })}
                      onChange={(e) => setQty((p) => ({ ...p, [l.id]: Math.min(left, Math.max(0, parseInt(e.target.value, 10) || 0)) }))} />
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    <span style={{ display: 'inline-block' }}><CurrencyInput value={cost[l.id] ?? 0} onChange={(v) => setCost((p) => ({ ...p, [l.id]: Math.max(0, v) }))} /></span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={styles.group}>
          <label style={styles.label}>{t('stock.note')}</label>
          <input style={styles.input} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t('stock.optionalDelivery')} />
        </div>
        {err && <p style={styles.error}>{err}</p>}
      </div>
    </Modal>
  );
}

function BillModal({ po, amount, businessId, onClose, onDone }: { po: PurchaseOrder; amount: number; businessId: string; onClose: () => void; onDone: (text: string) => void }) {
  const { t } = useTranslation('inventory');
  const terms = Number(po.vendor_payment_terms) || 0;
  const [invoice, setInvoice] = useState('');
  const [due, setDue] = useState(new Date(Date.now() + terms * 86400000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const lines = po.lines.filter((l) => l.qty_received > l.qty_billed);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const out = await poApi.billPurchaseOrder(businessId, po.id, { invoice_number: invoice || null, due_date: due || null });
      onDone(t('po.billCreated', { amount: formatCurrency(out.amount) }));
    } catch (e) { setErr(errorText(e, t('po.billFailed'))); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={t('po.billTitle', { number: po.po_number, vendor: po.vendor_name })} size="md"
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t('common:cancel')}</Button>
        <Button onClick={submit} loading={busy}>{t('po.createBillFor', { amount: formatCurrency(amount) })}</Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <p style={styles.muted}>{t('po.billHelp')}</p>
        <table style={styles.table}>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td style={styles.td}>{lineName(l)}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{l.qty_received - l.qty_billed} × {formatCurrency(l.unit_cost_cents)}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{formatCurrency((l.qty_received - l.qty_billed) * l.unit_cost_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={styles.grid}>
          <div style={styles.group}>
            <label style={styles.label}>{t('po.vendorInvoiceNumber')}</label>
            <input style={styles.input} value={invoice} maxLength={100} onChange={(e) => setInvoice(e.target.value)} placeholder={t('stock.optional')} />
          </div>
          <div style={styles.group}>
            <label style={styles.label}>{t('po.due')}</label>
            <input style={styles.input} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            {terms > 0 && <span style={styles.hint}>{t('po.terms', { count: terms })}</span>}
          </div>
        </div>
        {err && <p style={styles.error}>{err}</p>}
      </div>
    </Modal>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1000px', margin: '0 auto' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-md)', fontFamily: 'var(--font-family)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' },
  title: { margin: 0, fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as React.CSSProperties['fontWeight'], color: 'var(--color-text)' },
  card: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)', marginBottom: 'var(--space-md)', overflowX: 'auto' },
  cardTitle: { margin: '0 0 var(--space-md) 0', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-md)' },
  group: { display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text)' },
  req: { color: 'var(--color-text-secondary)' },
  value: { fontSize: 'var(--font-size-base)', color: 'var(--color-text)' },
  input: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-sm) var(--space-md)', fontSize: 'var(--font-size-base)', width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)' },
  num: { width: '80px', textAlign: 'right', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-xs) var(--space-sm)', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)' },
  hint: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', margin: 'var(--space-xs) 0 0' },
  muted: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 },
  error: { color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: 0 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-md)' },
  th: { textAlign: 'left', padding: 'var(--space-xs) var(--space-sm)', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontWeight: 600 },
  td: { padding: 'var(--space-xs) var(--space-sm)', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)', verticalAlign: 'middle' },
  cell: { width: '100%', boxSizing: 'border-box', height: 'var(--button-height-sm)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '0 var(--space-sm)', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)', background: 'var(--color-background)', color: 'var(--color-text)' },
  cellMissing: { borderColor: 'var(--color-warning)' },
  remove: { background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontSize: 'var(--font-size-base)', padding: 0, lineHeight: 1, minHeight: 'var(--button-height-sm)' },
  totalRow: { display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-md)', marginTop: 'var(--space-md)', fontSize: 'var(--font-size-base)', color: 'var(--color-text)' },
  billRow: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-md)', padding: 'var(--space-xs) 0', borderBottom: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  link: { background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', padding: 0, marginTop: 'var(--space-sm)', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)', textDecoration: 'underline' },
  actions: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', flexWrap: 'wrap', marginBottom: 'var(--space-xl)' },
};
