import { useState } from 'react';
import { Button } from '../design-system/components/actions/Button';
import * as payApi from '../api/payments';

/**
 * Print or email the branded receipt of a payment, right after it is taken or any time later.
 * An order's receipt (a sale, a booking paid at reservation) or a single payment's receipt (a
 * payment recorded on a customer, a membership renewal, an invoice payment...). The receipt is
 * the business's own Receipt template, the same document everywhere.
 */
export function ReceiptActions({ kind, id, businessId, label = 'Receipt' }: {
  kind: 'order' | 'transaction'; id: string; businessId: string; label?: string;
}) {
  const [busy, setBusy] = useState<null | 'print' | 'email'>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const print = async () => {
    setBusy('print'); setNote(null);
    try {
      const blob = kind === 'order' ? await payApi.fetchOrderReceiptPdf(id, businessId) : await payApi.fetchReceiptPdf(id, businessId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setNote({ ok: false, text: 'The receipt could not be produced.' });
    } finally { setBusy(null); }
  };

  const email = async () => {
    setBusy('email'); setNote(null);
    try {
      if (kind === 'order') {
        const r = await payApi.emailOrderReceipt(id, businessId);
        setNote({ ok: true, text: `Receipt emailed to ${r.recipient}.` });
      } else {
        const r = await payApi.emailTransaction(id, businessId);
        setNote({ ok: true, text: `Receipt emailed to ${r.recipient}.` });
      }
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } }).response?.data?.code;
      setNote({ ok: false, text: code === 'NO_RECIPIENT' ? 'The customer has no email address on file.' : 'The receipt could not be emailed.' });
    } finally { setBusy(null); }
  };

  return (
    <div style={s.wrap}>
      <span style={s.label}>{label}</span>
      <div style={s.row}>
        <Button variant="secondary" size="sm" onClick={print} loading={busy === 'print'} disabled={!!busy}>Print</Button>
        <Button variant="secondary" size="sm" onClick={email} loading={busy === 'email'} disabled={!!busy}>Email</Button>
      </div>
      {note && <span role={note.ok ? 'status' : 'alert'} style={{ ...s.note, color: note.ok ? 'var(--color-success)' : 'var(--color-error)' }}>{note.text}</span>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' },
  label: { fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)' },
  row: { display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' },
  note: { fontSize: 'var(--font-size-sm)' },
};
