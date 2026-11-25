import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Table } from '../design-system/components/data/Table';
import * as payApi from '../api/payments';
import type { TenantAuditEntry, AuditChange } from '../api/payments';
import { formatCurrency } from '../utils/currency';
import { formatDateTime } from '../utils/format';

/**
 * BusinessAuditTrail — the audit trail for a single business (Section B): every
 * change made to the business's billing (plan, credits, settings), with timestamp,
 * who made it, and the from → to detail. The direct mirror of TenantAuditTrail one
 * level down. Server-paged (reuses usr_audit_log via the audit service).
 */

interface Props {
  businessId: string;
}

// The action codes we log at the business level; each is shown through payments:audit.action.<code>.
const ACTION_CODES = [
  'billing_plan.created', 'billing_plan.updated', 'billing_credit.issued',
  'business.suspended', 'business.activated', 'business.archived', 'business.updated',
];

// Fields stored as integer cents, so the audit renders them as currency.
const CENTS_FIELDS = new Set([
  'flat_amount_cents', 'cap_amount_cents', 'intro_flat_amount_cents', 'amount_cents', 'billing_amount',
]);

function fmtValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (CENTS_FIELDS.has(field) && typeof v === 'number') {
    return formatCurrency(v);
  }
  if (CENTS_FIELDS.has(field) && typeof v === 'string' && /^\d+$/.test(v)) {
    return formatCurrency(parseInt(v, 10));
  }
  return String(v);
}

function fieldLabel(field: string, t: TFunction): string {
  // Known fields have a translated name; any other is its stored name made readable.
  const readable = field
    .replace(/_cents$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return t(`audit.field.${field}`, { defaultValue: readable });
}

export function BusinessAuditTrail({ businessId }: Props) {
  const { t } = useTranslation('payments');
  const actionLabel = (code: string) => (ACTION_CODES.includes(code) ? t(`audit.action.${code}`) : code);
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
        const res = await payApi.getBusinessAudit(businessId, p, 100);
        rows.push(...res.entries);
        all = res.total;
        if (res.entries.length < 100 || rows.length >= res.total) break;
      }
      setEntries(rows);
      setTotal(all);
    } catch {
      setEntries([]); setTotal(0);
    } finally { setLoading(false); }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  function who(e: TenantAuditEntry): string {
    const name = [e.user_first_name, e.user_last_name].filter(Boolean).join(' ').trim();
    return name || e.user_email || t('audit.system');
  }

  function renderChanges(e: TenantAuditEntry): React.ReactNode {
    const d = e.details;
    if (!d) return '—';
    if (Array.isArray(d.changes) && d.changes.length > 0) {
      return (
        <ul style={styles.changeList}>
          {d.changes.map((c: AuditChange, i: number) => (
            <li key={i}>
              <span style={styles.field}>{fieldLabel(c.field, t)}:</span>{' '}
              <span style={styles.from}>{fmtValue(c.field, c.from)}</span>
              {' → '}
              <span style={styles.to}>{fmtValue(c.field, c.to)}</span>
            </li>
          ))}
        </ul>
      );
    }
    if (d.amount_cents !== undefined) {
      return <span>{fmtValue('amount_cents', d.amount_cents)}{d.reason ? ` — ${String(d.reason)}` : ''}</span>;
    }
    return <span style={styles.muted}>{JSON.stringify(d)}</span>;
  }

  if (loading && entries.length === 0) return <p style={styles.muted}>{t('audit.loading')}</p>;
  if (!loading && entries.length === 0) return <p style={styles.muted}>{t('audit.empty')}</p>;

  return (
    <div>
      <p style={styles.muted}>{t('audit.recorded', { count: total })}</p>
      <Table
        rowId={(e: TenantAuditEntry) => e.id}
        data={entries}
        loading={loading}
        clientSort
        columns={[
          { key: 'created_at', header: t('audit.col.when'), sortable: true, filter: 'date' as const, render: (v: string) => formatDateTime(v) },
          { key: 'who', header: t('audit.col.who'), sortable: true, filterValue: (e: TenantAuditEntry) => who(e), render: (_: any, e: TenantAuditEntry) => who(e) },
          { key: 'action', header: t('audit.col.action'), sortable: true, filterLabel: (v: string) => actionLabel(v), render: (v: string) => actionLabel(v) },
          { key: 'details', header: t('audit.col.details'), filter: false as const, render: (_: any, e: TenantAuditEntry) => renderChanges(e) },
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
