import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { ProspectsList } from '../components/ProspectsList';

/**
 * Prospects — the tenant's own prospect list (view + manage + export). Generation
 * is handled by DayStream system admins (Tenants → Settings → Prospects); this page
 * is read/manage only. The list/table/manage UI is the shared ProspectsList
 * component, pointed at the tenant's own JWT-scoped endpoints.
 */
export function Prospects() {
  const [territory, setTerritory] = useState<{ location: string } | null>(null);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    apiClient.get('/v1/prospects/territory-info')
      .then((res) => { const d = res.data.data; if (d) setTerritory({ location: d.territory_address || '' }); })
      .catch(() => {});
  }, []);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Prospects</h1>
          {count != null && <span style={styles.count}>{count} prospect{count !== 1 ? 's' : ''}</span>}
        </div>
        {territory && (
          <span style={styles.territory}>Location: <strong style={{ color: 'var(--color-text)' }}>{territory.location}</strong></span>
        )}
      </div>

      {/* Export CSV lives inside ProspectsList (fetches via the authed client). */}
      <ProspectsList apiBase="/v1/prospects" ownTenant onCountChange={setCount} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: '1200px', margin: '0 auto', padding: 'var(--space-lg)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, margin: 0, color: 'var(--color-text)' },
  count: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  territory: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
};
