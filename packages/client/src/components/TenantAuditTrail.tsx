import { useState, useEffect, useCallback } from 'react';
import { Table } from '../design-system/components/data/Table';
import * as payApi from '../api/payments';
import type { TenantAuditEntry, AuditChange } from '../api/payments';

/**
 * TenantAuditTrail — the audit trail for a single tenant: every change made to
 * the tenant (billing plan, credits, status, settings), with timestamp, who made
 * it, and the from → to detail. Server-paged (reuses usr_audit_log via the audit
 * service), so it stays bounded as history grows.
 */

interface Props {
  tenantId: string;
}

// Human-readable labels for the action codes we log.
const ACTION_LABEL: Record<string, string> = {
  'billing_plan.created': 'Billing plan created',
  'billing_plan.updated': 'Billing plan updated',
  'billing_credit.issued': 'Credit issued',
  'tenant.suspended': 'Tenant suspended',
  'tenant.activated': 'Tenant activated',
  'tenant.archived': 'Tenant archived',
  'tenant.updated': 'Tenant settings updated',
};

// Fields stored as integer cents, so the audit renders them as currency.
const CENTS_FIELDS = new Set([
  'flat_amount_cents', 'cap_amount_cents', 'intro_flat_amount_cents', 'amount_cents', 'billing_amount',
]);

function fmtValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (CENTS_FIELDS.has(field) && typeof v === 'number') {
    return `$${(v / 100).toFixed(2)}`;
  }
  if (CENTS_FIELDS.has(field) && typeof v === 'string' && /^\d+$/.test(v)) {
    return `$${(parseInt(v, 10) / 100).toFixed(2)}`;
  }
  return String(v);
}

function fieldLabel(field: string): string {
  return field
    .replace(/_cents$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TenantAuditTrail({ tenantId }: Props) {
  const [entries, setEntries] = useState<TenantAuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Every entry (100 per call until all are in): the shared table's column filters work
      // on all of them, and it scrolls instead of paging (David, 2026-11-02).
      const rows: TenantAuditEntry[] = [];
      let all = 0;
      for (let p = 1; ; p++) {
        const res = await payApi.getTenantAudit(tenantId, p, 100);
        rows.push(...res.entries);
        all = res.total;
        if (res.entries.length < 100 || rows.length >= res.total) break;
      }
      setEntries(rows);
      setTotal(all);
    } catch {
      setEntries([]); setTotal(0);
    } finally { setLoading(false); }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  function who(e: TenantAuditEntry): string {
    const name = [e.user_first_name, e.user_last_name].filter(Boolean).join(' ').trim();
    return name || e.user_email || 'System';
  }

  function renderChanges(e: TenantAuditEntry): React.ReactNode {
    const d = e.details;
    if (!d) return '—';
    if (Array.isArray(d.changes) && d.changes.length > 0) {
      return (
        <ul style={styles.changeList}>
          {d.changes.map((c: AuditChange, i: number) => (
            <li key={i}>
              <span style={styles.field}>{fieldLabel(c.field)}:</span>{' '}
              <span style={styles.from}>{fmtValue(c.field, c.from)}</span>
              {' → '}
              <span style={styles.to}>{fmtValue(c.field, c.to)}</span>
            </li>
          ))}
        </ul>
      );
    }
    // Non-diff details (e.g. credit issued): show amount/reason compactly.
    if (d.amount_cents !== undefined) {
      return <span>{fmtValue('amount_cents', d.amount_cents)}{d.reason ? ` — ${String(d.reason)}` : ''}</span>;
    }
    return <span style={styles.muted}>{JSON.stringify(d)}</span>;
  }

  if (loading && entries.length === 0) return <p style={styles.muted}>Loading audit trail…</p>;
  if (!loading && entries.length === 0) return <p style={styles.muted}>No changes recorded for this tenant yet.</p>;

  return (
    <div>
      <p style={styles.muted}>{total} change{total === 1 ? '' : 's'} recorded</p>
      <Table
        rowId={(e: TenantAuditEntry) => e.id}
        data={entries}
        loading={loading}
        clientSort
        columns={[
          { key: 'created_at', header: 'When', sortable: true, filter: 'date' as const, render: (v: string) => new Date(v).toLocaleString() },
          { key: 'who', header: 'Who', sortable: true, filterValue: (e: TenantAuditEntry) => who(e), render: (_: any, e: TenantAuditEntry) => who(e) },
          { key: 'action', header: 'Action', sortable: true, filterLabel: (v: string) => ACTION_LABEL[v] || v, render: (v: string) => ACTION_LABEL[v] || v },
          { key: 'details', header: 'Details', filter: false as const, render: (_: any, e: TenantAuditEntry) => renderChanges(e) },
        ]}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  muted: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  changeList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '2px' },
  field: { color: 'var(--color-text-secondary)' },
  from: { color: 'var(--color-text-secondary)' },
  to: { color: 'var(--color-text)', fontWeight: 'var(--font-weight-medium)' as any },
};
