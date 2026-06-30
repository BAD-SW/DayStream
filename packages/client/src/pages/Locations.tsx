import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import * as locationsApi from '../api/locations';
import type { Location } from '../api/locations';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  active: 'success',
  inactive: 'error',
  temporarily_closed: 'warning',
};

export function Locations() {
  const navigate = useNavigate();
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const businessId = localStorage.getItem('business_id') || '';

  const fetchLocations = async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const locs = await locationsApi.getLocations(businessId, { search: search || undefined });
      setLocations(locs);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchLocations(); }, [businessId, search]);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Locations</h1>
        <Button onClick={() => navigate('/settings/locations/new')}>Add Location</Button>
      </div>

      <div style={styles.toolbar}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search locations..." />
      </div>

      {loading && <p style={styles.empty}>Loading...</p>}

      <div style={styles.list}>
        {locations.map((loc) => (
          <div key={loc.id} style={styles.locationCard} onClick={() => navigate(`/settings/locations/${loc.id}`)}>
            <div style={styles.cardHeader}>
              <div style={styles.cardTitle}>
                <strong>{loc.name}</strong>
                {loc.is_primary && <Badge variant="info">Primary</Badge>}
                <Badge variant={STATUS_VARIANTS[loc.status] || 'neutral'}>{loc.status.replace('_', ' ')}</Badge>
              </div>
            </div>
            <div style={styles.cardBody}>
              {loc.address_line1 && (
                <span style={styles.cardDetail}>
                  {loc.address_line1}{loc.city ? `, ${loc.city}` : ''}{loc.state_province ? `, ${loc.state_province}` : ''} {loc.postal_code || ''}
                </span>
              )}
              {loc.phone && <span style={styles.cardDetail}>📞 {loc.phone}</span>}
              {loc.timezone && <span style={styles.cardDetail}>🕐 {loc.timezone}</span>}
            </div>
          </div>
        ))}
        {!loading && locations.length === 0 && (
          <p style={styles.empty}>No locations yet. Add your first location to get started.</p>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '900px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  toolbar: { marginBottom: 'var(--space-md)' },
  list: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)' },
  locationCard: { padding: 'var(--space-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', cursor: 'pointer', transition: 'border-color 0.15s' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xs)' },
  cardTitle: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: 'var(--font-size-sm)' },
  cardBody: { display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap' as const },
  cardDetail: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  empty: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', textAlign: 'center', padding: 'var(--space-xl)' },
};
