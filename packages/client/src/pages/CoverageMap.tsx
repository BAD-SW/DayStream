import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';

interface Territory {
  id: string;
  name: string;
  status: string;
  territory_lat: number;
  territory_lng: number;
  territory_radius_km: number;
  territory_address: string;
}

export function CoverageMap() {
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.get('/v1/prospects/territories')
      .then((res) => setTerritories(res.data.data || []))
      .catch(() => setTerritories([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={styles.page}><p style={styles.muted}>Loading territories...</p></div>;

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Territory Coverage</h1>
      <p style={styles.description}>
        All assigned tenant territories. {territories.length} territory(ies) configured.
      </p>

      {territories.length === 0 ? (
        <p style={styles.muted}>No territories assigned yet. Edit a tenant to assign their territory.</p>
      ) : (
        <div style={styles.grid}>
          {territories.map((t) => (
            <div key={t.id} style={styles.card}>
              <div style={styles.cardHeader}>
                <strong style={styles.cardName}>{t.name}</strong>
                <span style={{ ...styles.badge, background: t.status === 'active' ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>{t.status}</span>
              </div>
              <div style={styles.cardBody}>
                <div style={styles.cardRow}>
                  <span style={styles.cardLabel}>Location</span>
                  <span style={styles.cardValue}>{t.territory_address}</span>
                </div>
                <div style={styles.cardRow}>
                  <span style={styles.cardLabel}>Radius</span>
                  <span style={styles.cardValue}>{t.territory_radius_km} km</span>
                </div>
                <div style={styles.cardRow}>
                  <span style={styles.cardLabel}>Coordinates</span>
                  <span style={styles.cardValue}>{t.territory_lat.toFixed(4)}, {t.territory_lng.toFixed(4)}</span>
                </div>
              </div>
              <a
                href={`https://www.google.com/maps/@${t.territory_lat},${t.territory_lng},${Math.max(10, 14 - Math.floor(t.territory_radius_km / 10))}z`}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.mapLink}
              >
                View on Google Maps
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: '1200px', margin: '0 auto', padding: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 300, margin: '0 0 var(--space-sm)', color: 'var(--color-text)' },
  description: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-lg)' },
  muted: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--space-md)' },
  card: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', background: 'var(--color-background)' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)' },
  cardName: { fontSize: '14px', color: 'var(--color-text)' },
  badge: { fontSize: '11px', color: '#fff', padding: '2px 8px', borderRadius: '12px' },
  cardBody: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  cardRow: { display: 'flex', justifyContent: 'space-between', fontSize: '13px' },
  cardLabel: { color: 'var(--color-text-secondary)' },
  cardValue: { color: 'var(--color-text)' },
  mapLink: { display: 'inline-block', marginTop: 'var(--space-sm)', fontSize: '12px', color: 'var(--color-primary)', textDecoration: 'underline' },
};
