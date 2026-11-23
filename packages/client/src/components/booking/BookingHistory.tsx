import { useEffect, useState } from 'react';
import { apiClient } from '../../api/client';

// ============================================================
// An appointment's history (spec 51, gap 18): everything that happened to it, newest first, in
// plain words: who (a staff member, the customer or the system and its job) and where from,
// what changed (before → after) and why. Staff only; entries cannot be changed.
// ============================================================

interface Entry {
  id: string; at: string; event: 'created' | 'status' | 'changed' | 'payment';
  who: string; actor: 'staff' | 'customer' | 'system'; source: string | null; source_label: string | null;
  text: string; lines: string[]; reason: string | null; early: boolean;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function BookingHistory({ bookingId, businessId, refreshKey }: { bookingId: string; businessId: string; refreshKey?: unknown }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let off = false;
    setFailed(false);
    apiClient.get(`/v1/bookings/${bookingId}/history`, { params: { business_id: businessId } })
      .then((r) => { if (!off) setEntries(r.data.data); })
      .catch(() => { if (!off) setFailed(true); });
    return () => { off = true; };
  }, [open, bookingId, businessId, refreshKey]);

  const hasEarly = !!entries?.some((e) => e.early);
  return (
    <div className="q-sec">
      <div className="q-sec-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>History</span>
        <button type="button" className="btn sec" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <div className="q-sec-b">
          {failed ? <p className="mk-warn">The history could not be loaded.</p>
            : !entries ? <p className="mk-hint">Loading…</p>
            : entries.length === 0 ? <p className="mk-hint">Nothing recorded yet.</p>
            : (
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={{ ...s.th, width: '170px' }}>When</th>
                    <th style={{ ...s.th, width: '220px' }}>Who</th>
                    <th style={s.th}>What</th>
                    <th style={s.th}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td style={{ ...s.td, ...s.when }}>{when(e.at)}</td>
                      <td style={s.td}>
                        {e.who}
                        {e.source_label && e.actor !== 'system' && <span style={s.muted}> · {e.source_label}</span>}
                      </td>
                      <td style={s.td}>{e.text}</td>
                      <td style={s.td}>
                        {e.lines.join('; ')}
                        {e.reason && <span style={s.muted}>{e.lines.length > 0 ? ' · ' : ''}{e.reason}</span>}
                        {e.lines.length === 0 && !e.reason && <span style={s.muted}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          {hasEarly && <p className="mk-hint">Entries before 23 Nov 2026 show status changes and moves only: other changes were not recorded then.</p>}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' },
  th: { textAlign: 'left', padding: 'var(--space-xs) var(--space-sm)', fontSize: 'var(--font-size-xs)', fontWeight: 600, textTransform: 'uppercase', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' },
  td: { padding: 'var(--space-sm)', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)', verticalAlign: 'top' },
  when: { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)' },
  muted: { color: 'var(--color-text-secondary)' },
};
