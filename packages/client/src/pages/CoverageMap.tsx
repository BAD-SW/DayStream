import { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '../api/client';
import { cellToBoundary } from 'h3-js';

interface TerritoryComponent { id: string | null; label: string; kind: string | null; population?: number | null }
interface Territory {
  tenantId: string;
  name: string;
  status: string;
  location: string;
  hexagons: string[];
  components: TerritoryComponent[];
  population: number | null;
}

const COLORS = ['#C9A96E', '#4A90A4', '#2E7D32', '#D32F2F', '#7B1FA2', '#F57C00', '#00838F', '#5D4037'];

/** First 2 comma-parts of a long display name, e.g. "Erie County, New York, United States" -> "Erie County, New York". */
function shortName(label: string): string {
  return (label || '').split(',').slice(0, 2).join(',').trim();
}

// Polygon styling for the selected vs. unselected (dimmed) vs. default states.
const STYLE_DEFAULT = { strokeOpacity: 0.8, strokeWeight: 1, fillOpacity: 0.25 };
const STYLE_SELECTED = { strokeOpacity: 1, strokeWeight: 2, fillOpacity: 0.5 };
const STYLE_DIMMED = { strokeOpacity: 0.25, strokeWeight: 1, fillOpacity: 0.07 };

export function CoverageMap() {
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  // Per-territory google.maps.Polygon[] and LatLngBounds, keyed by tenantId, so we can
  // re-style and zoom to a territory on selection.
  const polysRef = useRef<Map<string, any[]>>(new Map());
  const boundsRef = useRef<Map<string, any>>(new Map());
  // Row refs so a map-driven selection can scroll the list row into view.
  const rowRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const colorFor = (idx: number) => COLORS[idx % COLORS.length];

  useEffect(() => {
    Promise.all([
      apiClient.get('/v1/prospects/territories').then((res) => res.data.data || []),
      apiClient.get('/v1/prospects/maps-key').then((res) => res.data.data?.key || null).catch(() => null),
    ]).then(([terr, key]) => {
      setTerritories(terr);
      setApiKey(key);
    }).finally(() => setLoading(false));
  }, []);

  // Apply styling across all territories' polygons for the current selection. When nothing
  // is selected, everything is default; when one is selected, it's emphasized and the rest
  // are dimmed so the chosen territory stands out.
  const applySelectionStyles = useCallback((selId: string | null) => {
    for (const [tid, polys] of polysRef.current) {
      const style = selId == null ? STYLE_DEFAULT : (tid === selId ? STYLE_SELECTED : STYLE_DIMMED);
      for (const p of polys) p.setOptions(style);
    }
  }, []);

  // Select a territory (or clear with null): restyle polygons, zoom the map to it, and scroll
  // its list row into view. Shared by both list clicks and map clicks.
  const selectTerritory = useCallback((tid: string | null) => {
    setSelectedId((prev) => {
      const next = prev === tid ? null : tid; // clicking the selected one again clears
      applySelectionStyles(next);
      const map = mapInstanceRef.current;
      if (next && map) {
        const b = boundsRef.current.get(next);
        if (b && !b.isEmpty()) map.fitBounds(b, { padding: 40 });
      }
      if (next) {
        const row = rowRefs.current.get(next);
        row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      return next;
    });
  }, [applySelectionStyles]);

  const initMap = useCallback(() => {
    if (!mapRef.current || !apiKey || territories.length === 0) return;
    if (mapInstanceRef.current) return;

    const tryBuild = () => {
      if ((window as any).google?.maps?.Map) buildMap();
      else setTimeout(tryBuild, 200);
    };

    if (!(window as any).google?.maps) {
      const existing = document.querySelector('script[src*="maps.googleapis.com"]');
      if (!existing) {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
        script.async = true;
        script.onload = () => tryBuild();
        script.onerror = () => console.error('Failed to load Google Maps script');
        document.head.appendChild(script);
      } else {
        tryBuild();
      }
    } else {
      buildMap();
    }
  }, [apiKey, territories]);

  useEffect(() => { if (!loading) initMap(); }, [loading, initMap]);

  function buildMap() {
    if (!mapRef.current || mapInstanceRef.current) return;
    const google = (window as any).google;
    if (!google?.maps) return;

    const map = new google.maps.Map(mapRef.current, {
      zoom: 4,
      center: { lat: 39, lng: -98 },
      mapTypeId: 'roadmap',
      streetViewControl: false,
    });
    mapInstanceRef.current = map;

    // Clicking empty map space clears the selection.
    map.addListener('click', () => selectTerritory(null));

    const allBounds = new google.maps.LatLngBounds();

    territories.forEach((territory, idx) => {
      const color = colorFor(idx);
      const polys: any[] = [];
      const tBounds = new google.maps.LatLngBounds();

      for (const hexId of territory.hexagons) {
        try {
          const boundary = cellToBoundary(hexId);
          const paths = boundary.map(([lat, lng]) => ({ lat, lng }));
          const polygon = new google.maps.Polygon({
            paths, map, strokeColor: color, fillColor: color, ...STYLE_DEFAULT,
          });
          // Clicking a territory's polygon selects it (highlights its list row).
          polygon.addListener('click', (e: any) => {
            if (e?.domEvent) e.domEvent.stopPropagation(); // don't also trigger the map's clear
            selectTerritory(territory.tenantId);
          });
          polys.push(polygon);
          for (const point of paths) { tBounds.extend(point); allBounds.extend(point); }
        } catch { /* skip invalid hexagons */ }
      }

      polysRef.current.set(territory.tenantId, polys);
      boundsRef.current.set(territory.tenantId, tBounds);
    });

    if (territories.length > 0 && !allBounds.isEmpty()) map.fitBounds(allBounds, { padding: 30 });
  }

  if (loading) return <div style={styles.page}><p style={styles.muted}>Loading territories...</p></div>;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Territory Coverage</h1>
        <span style={styles.count}>{territories.length} territory(ies) assigned</span>
      </div>

      {!apiKey && !loading && (
        <p style={styles.muted}>Google Maps API key not configured. Set it under Configuration → API Keys.</p>
      )}

      {territories.length === 0 && !loading && (
        <p style={styles.muted}>No territories assigned yet. Edit a tenant to assign their territory.</p>
      )}

      <div ref={mapRef} style={{ ...styles.map, display: territories.length === 0 || !apiKey ? 'none' : 'block' }} />

      {/* Compact multi-column key: color + territory name only. Click to highlight on the map;
          clicking a territory on the map highlights its entry here. */}
      {territories.length > 0 && (
        <>
          <div style={styles.listHeader}>
            <span>Territories</span>
            {selectedId && (
              <button type="button" style={styles.clearBtn} onClick={() => selectTerritory(null)}>clear selection</button>
            )}
          </div>

          {/* Detail panel for the selected territory — its composition, size, and population. */}
          {(() => {
            const sel = territories.find((t) => t.tenantId === selectedId);
            if (!sel) return null;
            const idx = territories.findIndex((t) => t.tenantId === sel.tenantId);
            return (
              <div style={styles.detail}>
                <div style={styles.detailHead}>
                  <span style={{ ...styles.dot, background: colorFor(idx) }} />
                  <span style={styles.detailTitle}>{sel.name}</span>
                  <span style={styles.detailMeta}>
                    {sel.status}
                    {' · '}{sel.hexagons.length.toLocaleString()} cells
                    {sel.population != null && <> {' · '}~{sel.population.toLocaleString()} people</>}
                  </span>
                </div>
                {sel.components.length > 0 ? (
                  <ul style={styles.compList}>
                    {sel.components.map((c, i) => (
                      <li key={i} style={styles.compItem}>
                        <span>{shortName(c.label)}</span>
                        {c.kind && <span style={styles.compKind}>{c.kind}</span>}
                        {c.population != null && <span style={styles.compPop}>~{c.population.toLocaleString()}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={styles.detailLocation}>{sel.location}</p>
                )}
              </div>
            );
          })()}

          <div style={styles.grid} role="list">
            {territories.map((t, idx) => {
              const selected = t.tenantId === selectedId;
              return (
                <button
                  key={t.tenantId}
                  type="button"
                  role="listitem"
                  ref={(el) => { rowRefs.current.set(t.tenantId, el); }}
                  onClick={() => selectTerritory(t.tenantId)}
                  aria-pressed={selected}
                  title={t.location}
                  style={{ ...styles.chip, ...(selected ? styles.chipSelected : {}) }}
                >
                  <span style={{ ...styles.dot, background: colorFor(idx) }} />
                  <span style={styles.chipName}>{t.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: '1400px', margin: '0 auto', padding: 'var(--space-lg)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, margin: 0, color: 'var(--color-text)' },
  count: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' },
  muted: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' },
  map: { width: '100%', height: '600px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' },
  listHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: 'var(--space-md) 0 var(--space-sm)', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)' },
  clearBtn: { background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 'var(--font-size-xs)', textDecoration: 'underline', fontWeight: 400, padding: 0 },
  // Responsive multi-column grid — auto-fills as many compact chips per row as fit, and grows
  // in height with the content (no fixed cap / scrollbar).
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '6px' },
  chip: {
    display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left' as const,
    padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
    background: 'var(--color-surface, transparent)', color: 'var(--color-text)', cursor: 'pointer',
    fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)',
  },
  chipSelected: { borderColor: 'var(--color-primary)', background: 'var(--color-primary-subtle, rgba(74,144,164,0.12))', fontWeight: 600 },
  dot: { width: '12px', height: '12px', borderRadius: '50%', flexShrink: 0 },
  chipName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  detail: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', marginBottom: 'var(--space-sm)', background: 'var(--color-surface, transparent)' },
  detailHead: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const, marginBottom: 'var(--space-sm)' },
  detailTitle: { fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--color-text)' },
  detailMeta: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  detailLocation: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 },
  compList: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '4px' },
  compItem: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  compKind: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', textTransform: 'capitalize' as const },
  compPop: { fontSize: 'var(--font-size-xs)', color: 'var(--color-recovery, #4A90A4)', marginLeft: 'auto' },
};
