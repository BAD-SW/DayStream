import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Table } from '../design-system/components/data/Table';
import { dayOf } from '../design-system/components/data/TableFilters';
import { Badge } from '../design-system/components/data/Badge';
import { apiClient } from '../api/client';
import { formatDateOnly } from '../utils/date';

// Who has an offering (THE-23 item 1): everyone enrolled or who bought it, past ones included,
// each with their status and a link to their profile.

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success', renewing: 'info', pending: 'warning', paused: 'warning', cancelled: 'error', expired: 'neutral', 'used up': 'neutral',
};

const name = (r: any) => `${r.customer_first_name || ''} ${r.customer_last_name || ''}`.trim() || r.customer_email || '—';
const date = (v: string | null) => (v ? formatDateOnly(v) : '—');
const moment = (v: string | null) => (v ? new Date(v).toLocaleDateString() : '—'); // timestamps
// Timestamps shown as a date sort by that date, so rows on the same day keep their order.
const byDay = (key: string) => (r: any) => dayOf(r[key]);

const personCol = {
  key: 'person', header: 'Name', sortable: true, filterValue: name, sortValue: name,
  render: (_: unknown, r: any) => <Link to={`/customers/${r.customer_id}`}>{name(r)}</Link>,
};
const statusCol = {
  key: 'status', header: 'Status', sortable: true,
  render: (v: string) => <Badge variant={STATUS_VARIANTS[v] || 'neutral'}>{v}</Badge>,
};

function usePeople(url: string) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setLoading(true); setFailed(false);
    apiClient.get(url)
      .then((res) => setRows((res.data.data || []).map((r: any) => ({ ...r, person: name(r) }))))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [url]);
  return { rows, loading, failed };
}

export function MembershipPeople({ planId, businessId }: { planId: string; businessId: string }) {
  const { rows, loading, failed } = usePeople(`/v1/memberships?business_id=${businessId}&plan_id=${planId}`);
  const columns = [
    personCol,
    // A cancelled membership stays active until its paid period ends.
    { ...statusCol, render: (v: string, r: any) => <>{statusCol.render(v)}{r.cancelled_at && v !== 'cancelled' && <span style={{ marginLeft: 6, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>ends {date(r.current_period_end)}</span>}</> },
    { key: 'start_date', header: 'Start date', sortable: true, filter: 'date' as const, render: date },
    { key: 'next_billing_date', header: 'Next renewal', sortable: true, filter: 'date' as const, render: date },
  ];
  return <Table columns={columns} data={rows} loading={loading} clientSort emptyMessage={failed ? 'The list could not be loaded' : 'Nobody has been enrolled yet'} />;
}

export function PackagePeople({ packageId, businessId }: { packageId: string; businessId: string }) {
  const { rows, loading, failed } = usePeople(`/v1/packages/${packageId}/purchases?business_id=${businessId}`);
  // A package can hold sessions, minutes or both: each counted in its own unit.
  const usage = (r: any) => [
    r.sessions_total ? `${r.sessions_used} used · ${r.sessions_total - r.sessions_used} left of ${r.sessions_total} sessions` : '',
    r.minutes_total ? `${r.minutes_used} used · ${r.minutes_total - r.minutes_used} left of ${r.minutes_total} min` : '',
  ].filter(Boolean).join(' / ') || '—';
  const columns = [
    personCol,
    statusCol,
    { key: 'purchased_at', header: 'Purchased', sortable: true, filter: 'date' as const, sortValue: byDay('purchased_at'), render: moment },
    { key: 'usage', header: 'Used / left', filter: false as const, render: (_: unknown, r: any) => usage(r) },
    { key: 'expires_at', header: 'Expires', sortable: true, filter: 'date' as const, sortValue: byDay('expires_at'), render: (v: string | null) => (v ? moment(v) : 'Never') },
  ];
  return <Table columns={columns} data={rows} loading={loading} clientSort emptyMessage={failed ? 'The list could not be loaded' : 'Nobody has bought this package yet'} />;
}
