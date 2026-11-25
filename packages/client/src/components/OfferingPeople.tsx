import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Table } from '../design-system/components/data/Table';
import { dayOf } from '../design-system/components/data/TableFilters';
import { Badge } from '../design-system/components/data/Badge';
import { apiClient } from '../api/client';
import { formatDateOnly } from '../utils/date';
import { formatDate } from '../utils/format';

// Who has an offering (THE-23 item 1): everyone enrolled or who bought it, past ones included,
// each with their status and a link to their profile.
const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success', renewing: 'info', pending: 'warning', paused: 'warning', cancelled: 'error', expired: 'neutral', 'used up': 'neutral',
};

const name = (r: any) => `${r.customer_first_name || ''} ${r.customer_last_name || ''}`.trim() || r.customer_email || '—';
const date = (v: string | null) => (v ? formatDateOnly(v) : '—');
const moment = (v: string | null) => (v ? formatDate(v) : '—'); // timestamps
// Timestamps shown as a date sort by that date, so rows on the same day keep their order.
const byDay = (key: string) => (r: any) => dayOf(r[key]);

// Column definitions take `t`, so their headers and status words follow the language shown.
const personCol = (t: TFunction) => ({
  key: 'person', header: t('people.name'), sortable: true, filterValue: name, sortValue: name,
  render: (_: unknown, r: any) => <Link to={`/customers/${r.customer_id}`}>{name(r)}</Link>,
});

const statusLabel = (t: TFunction, v: string) => t(`people.status.${String(v).replace(/\s+/g, '_')}`, { defaultValue: v });

const statusCol = (t: TFunction) => ({
  key: 'status', header: t('shared.status'), sortable: true,
  render: (v: string) => <Badge variant={STATUS_VARIANTS[v] || 'neutral'}>{statusLabel(t, v)}</Badge>,
});

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
  const { t } = useTranslation('offerings');
  const { rows, loading, failed } = usePeople(`/v1/memberships?business_id=${businessId}&plan_id=${planId}`);
  const status = statusCol(t);
  const columns = [
    personCol(t),
    // A cancelled membership stays active until its paid period ends.
    { ...status, render: (v: string, r: any) => <>{status.render(v)}{r.cancelled_at && v !== 'cancelled' && <span style={{ marginLeft: 6, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>{t('people.ends', { date: date(r.current_period_end) })}</span>}</> },
    { key: 'start_date', header: t('people.startDate'), sortable: true, filter: 'date' as const, render: date },
    { key: 'next_billing_date', header: t('people.nextRenewal'), sortable: true, filter: 'date' as const, render: date },
  ];
  return <Table columns={columns} data={rows} loading={loading} clientSort emptyMessage={failed ? t('people.loadFailed') : t('people.noMembers')} />;
}

export function PackagePeople({ packageId, businessId }: { packageId: string; businessId: string }) {
  const { t } = useTranslation('offerings');
  const { rows, loading, failed } = usePeople(`/v1/packages/${packageId}/purchases?business_id=${businessId}`);
  // A package can hold sessions, minutes or both: each counted in its own unit.
  const usage = (r: any) => [
    r.sessions_total ? t('people.usageSessions', { used: r.sessions_used, left: r.sessions_total - r.sessions_used, total: r.sessions_total }) : '',
    r.minutes_total ? t('people.usageMinutes', { used: r.minutes_used, left: r.minutes_total - r.minutes_used, total: r.minutes_total }) : '',
  ].filter(Boolean).join(' / ') || '—';
  const columns = [
    personCol(t),
    statusCol(t),
    { key: 'purchased_at', header: t('people.purchased'), sortable: true, filter: 'date' as const, sortValue: byDay('purchased_at'), render: moment },
    { key: 'usage', header: t('people.usedLeft'), filter: false as const, render: (_: unknown, r: any) => usage(r) },
    { key: 'expires_at', header: t('giftCards.expires'), sortable: true, filter: 'date' as const, sortValue: byDay('expires_at'), render: (v: string | null) => (v ? moment(v) : t('packages.never')) },
  ];
  return <Table columns={columns} data={rows} loading={loading} clientSort emptyMessage={failed ? t('people.loadFailed') : t('people.noBuyers')} />;
}
