import { useState, useEffect, useRef } from 'react';
import { apiClient } from '../api/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface Territory {
  id: string;
  name: string;
  status: string;
  territory_lat: number;
  territory_lng: number;
  territory_radius_km: number;
  territory_address: string;
}

const COLORS = ['#C9A96E', '#4A90A4', '#2E7D32', '#D32F2F', '#7B1FA2', '#F57C00', '#00838F', '#5D4037'];

export function CoverageMap() {
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    apiClient.get('/v1/prospects/territories')
      .then((res) => setTerritories(res.data.data || []))
      .catch(() => setTerritories([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading || !mapRef.current) return;
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    // Default center (world view) if no territories
    const defaultCenter: [number, number] = territories.length > 0
      ? [territories[0].territory_lat, territories[0].territory_lng]
      : [40, 0];
    const defaultZoom = territories.length > 0 ? 6 : 2;

    const map = L.map(mapRef.current).setView(defaultCenter, defaultZoom);
    mapInstanceRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    // Add territory circles
    const bounds = L.latLngBounds([]);
    territories.forEach((t, idx) => {
      const color = COLORS[idx % COLORS.length];
      const circle = L.circle([t.territory_lat, t.territory_lng], {
        radius: t.territory_radius_km * 1000,
        color,
        fillColor: color,
        fillOpacity: 0.15,
        weight: 2,
      }).addTo(map);

      circle.bindPopup(`
        <strong>${t.name}</strong><br/>
        ${t.territory_address}<br/>
        <em>Radius: ${t.territory_radius_km} km</em><br/>
        <span style="color: ${t.status === 'active' ? '#2E7D32' : '#999'}">${t.status}</span>
      `);

      // Add center marker with label
      L.marker([t.territory_lat, t.territory_lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="background:${color};color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;white-space:nowrap;font-weight:600;">${t.name}</div>`,
          iconSize: [0, 0],
          iconAnchor: [-5, 10],
        }),
      }).addTo(map);

      bounds.extend(circle.getBounds());
    });

    // Fit map to show all territories
    if (territories.length > 0) {
      map.fitBounds(bounds, { padding: [30, 30] });
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [loading, territories]);

  if (loading) return <div style={styles.page}><p style={styles.muted}>Loading territories...</p></div>;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Territory Coverage</h1>
        <span style={styles.count}>{territories.length} territory(ies) assigned</span>
      </div>

      {territories.length === 0 ? (
        <p style={styles.muted}>No territories assigned yet. Edit a tenant to assign their territory.</p>
      ) : (
        <div ref={mapRef} style={styles.map} />
      )}

      {/* Legend */}
      {territories.length > 0 && (
        <div style={styles.legend}>
          {territories.map((t, idx) => (
            <div key={t.id} style={styles.legendItem}>
              <span style={{ ...styles.legendDot, background: COLORS[idx % COLORS.length] }} />
              <span style={styles.legendName}>{t.name}</span>
              <span style={styles.legendDetail}>{t.territory_address} ({t.territory_radius_km} km)</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: '1400px', margin: '0 auto', padding: 'var(--space-lg)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 300, margin: 0, color: 'var(--color-text)' },
  count: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  muted: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
  map: { width: '100%', height: '600px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' },
  legend: { marginTop: 'var(--space-md)', display: 'flex', flexDirection: 'column' as const, gap: '6px' },
  legendItem: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' },
  legendDot: { width: '12px', height: '12px', borderRadius: '50%', flexShrink: 0 },
  legendName: { fontWeight: 600, color: 'var(--color-text)' },
  legendDetail: { color: 'var(--color-text-secondary)' },
};
