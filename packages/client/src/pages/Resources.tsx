import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../design-system/components/actions/Button';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import { Badge } from '../design-system/components/data/Badge';
import { Table } from '../design-system/components/data/Table';
import * as resourcesApi from '../api/resources';
import type { Resource, ResourceType } from '../api/resources';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  active: 'success', inactive: 'neutral', maintenance: 'warning',
};

export function Resources() {
  const { t } = useTranslation('setup');
  const navigate = useNavigate();
  const businessId = localStorage.getItem('business_id') || '';
  const [resources, setResources] = useState<Resource[]>([]);
  const [types, setTypes] = useState<ResourceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    if (!businessId) return;
    resourcesApi.getResourceTypes({ business_id: businessId }).then(setTypes).catch(() => {});
  }, [businessId]);

  const fetchResources = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      // Every resource (100 per call until all are in): the column filters replace the menus
      // above the table (column filters beside the sort icon, David 2026-11-02).
      const rows: any[] = [];
      for (let p = 1; ; p++) {
        const result = await resourcesApi.getResources({ business_id: businessId, search: search || undefined, page: p, limit: 100 });
        rows.push(...result.data);
        if (result.data.length < 100 || p >= (result.meta?.totalPages || Math.ceil((result.meta?.total || 0) / 100) || 1)) break;
      }
      setResources(rows);
    } catch {} finally { setLoading(false); }
  }, [businessId, search]);

  useEffect(() => { fetchResources(); }, [fetchResources]);
  useEffect(() => { const timer = setTimeout(() => setSearch(searchInput), 300); return () => clearTimeout(timer); }, [searchInput]);

  const columns = [
    { key: 'name', header: t('resources.name'), sortable: true },
    {
      key: 'category', header: t('resources.category'), sortable: true,
      render: (val: string) => val ? t(`resources.category_${val}`, { defaultValue: val.charAt(0).toUpperCase() + val.slice(1) }) : '—',
    },
    {
      key: 'capacity', header: t('resources.capacity'), sortable: true,
      render: (val: number) => val > 1 ? t('resources.concurrent', { n: val }) : t('resources.exclusive'),
    },
    {
      key: 'buffer_minutes', header: t('resources.buffer'), sortable: true,
      render: (val: number) => val > 0 ? t('resources.minutes', { n: val }) : '—',
    },
    {
      key: 'status', header: t('resources.status'), sortable: true,
      render: (val: string) => <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>{t(`resources.status_${val}`, { defaultValue: val })}</Badge>,
    },
  ];

  return (
    <div>
      <div style={styles.toolbar}>
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder={t('resources.search')} />
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={() => navigate('/resources/new')}>{t('resources.add')}</Button>
      </div>

      <Table
        columns={columns}
        data={resources}
        loading={loading}
        onRowClick={(row) => navigate(`/resources/${row.id}`)}
        emptyMessage={t('resources.empty')}
        mobileCardMode
        clientSort
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: { display: 'flex', gap: 'var(--space-md)', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap' },
  select: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
};
