import { useState, useEffect, useMemo } from 'react';
import { apiClient } from '../api/client';

/**
 * OvertureTaxonomyPicker — a searchable, grouped (by L0), expandable tree of the full Overture
 * taxonomy (~2.2k codes) with checkboxes. Lets an admin map valid Overture category codes into
 * a prospect category WITHOUT typing (no typo risk). Selecting a parent node is meaningful: the
 * generation query is hierarchy-aware, so a parent selection catches its whole subtree.
 *
 * Fed by GET /v1/prospects/overture-taxonomy. Writes the selected code set up via onChange.
 */

interface TaxNode { code: string; parent: string | null; l0: string; depth: number; childCount: number; count: number }
interface Catalog { release: string; nodes: TaxNode[] }

interface Props {
  selected: string[];
  onChange: (codes: string[]) => void;
}

// Module-level cache so the ~2.2k catalog is fetched once per session, not per mount.
let catalogCache: Catalog | null = null;

export function OvertureTaxonomyPicker({ selected, onChange }: Props) {
  const [catalog, setCatalog] = useState<Catalog | null>(catalogCache);
  const [loading, setLoading] = useState(!catalogCache);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (catalogCache) return;
    apiClient.get('/v1/prospects/overture-taxonomy')
      .then((res) => {
        const data: Catalog = res.data.data || res.data;
        catalogCache = data;
        setCatalog(data);
      })
      .catch(() => setCatalog({ release: '', nodes: [] }))
      .finally(() => setLoading(false));
  }, []);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Index: children by parent, and nodes by l0 (top-level groups).
  const { childrenOf, l0Groups, byCode } = useMemo(() => {
    const childrenOf = new Map<string, TaxNode[]>();
    const byCode = new Map<string, TaxNode>();
    const l0Set = new Set<string>();
    for (const n of catalog?.nodes || []) {
      byCode.set(n.code, n);
      l0Set.add(n.l0);
      if (n.parent) {
        const arr = childrenOf.get(n.parent) || [];
        arr.push(n);
        childrenOf.set(n.parent, arr);
      }
    }
    const l0Groups = [...l0Set].sort();
    return { childrenOf, l0Groups, byCode };
  }, [catalog]);

  // Search results: flat list of codes whose code contains the query (case-insensitive).
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return (catalog?.nodes || [])
      .filter((n) => n.code.includes(q))
      .slice(0, 200);
  }, [search, catalog]);

  const toggle = (code: string) => {
    const next = new Set(selectedSet);
    if (next.has(code)) next.delete(code); else next.add(code);
    onChange([...next]);
  };

  const toggleExpand = (code: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };

  const prettify = (code: string) => code.replace(/_/g, ' ');

  if (loading) return <p style={styles.muted}>Loading taxonomy…</p>;
  if (!catalog || catalog.nodes.length === 0) return <p style={styles.muted}>Taxonomy unavailable.</p>;

  // A single row (checkbox + optional expand caret + label + count).
  const renderRow = (n: TaxNode, showCaret: boolean) => {
    const kids = childrenOf.get(n.code) || [];
    const isExpanded = expanded.has(n.code);
    const checked = selectedSet.has(n.code);
    return (
      <div key={n.code}>
        <div style={{ ...styles.row, paddingLeft: `${8 + n.depth * 16}px` }}>
          {showCaret && kids.length > 0 ? (
            <button type="button" style={styles.caret} onClick={() => toggleExpand(n.code)} aria-label={isExpanded ? 'Collapse' : 'Expand'}>
              {isExpanded ? '▾' : '▸'}
            </button>
          ) : <span style={styles.caretSpacer} />}
          <label style={styles.rowLabel}>
            <input type="checkbox" checked={checked} onChange={() => toggle(n.code)} style={styles.checkbox} />
            <span style={styles.code}>{prettify(n.code)}</span>
            {kids.length > 0 && <span style={styles.childHint}>+{kids.length}</span>}
          </label>
        </div>
        {showCaret && isExpanded && kids.map((k) => renderRow(k, true))}
      </div>
    );
  };

  return (
    <div style={styles.wrap}>
      <input
        type="text"
        placeholder="Search Overture tags (e.g. massage, naturopathic, salon)…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={styles.searchInput}
      />
      <p style={styles.hint}>
        Pick a parent to include its whole branch (e.g. “complementary and alternative medicine”
        covers naturopathic, acupuncture, etc.). {catalog.nodes.length.toLocaleString()} tags · release {catalog.release}
      </p>

      <div style={styles.tree}>
        {searchResults ? (
          searchResults.length === 0 ? (
            <p style={styles.muted}>No tags match “{search}”.</p>
          ) : (
            searchResults.map((n) => (
              <div key={n.code} style={styles.searchRow} title={n.parent ? `under ${prettify(n.parent)}` : n.l0}>
                <label style={styles.rowLabel}>
                  <input type="checkbox" checked={selectedSet.has(n.code)} onChange={() => toggle(n.code)} style={styles.checkbox} />
                  <span style={styles.code}>{prettify(n.code)}</span>
                  <span style={styles.pathHint}>{prettify(n.l0)}{n.parent && n.parent !== n.l0 ? ` › ${prettify(n.parent)}` : ''}</span>
                </label>
              </div>
            ))
          )
        ) : (
          l0Groups.map((l0) => {
            const isOpen = expanded.has(`l0:${l0}`);
            const top = (childrenOf.get(l0) || []);
            const l0Node = byCode.get(l0);
            return (
              <div key={l0} style={styles.l0Group}>
                <button type="button" style={styles.l0Header} onClick={() => toggleExpand(`l0:${l0}`)}>
                  <span>{isOpen ? '▾' : '▸'}</span>
                  <span style={styles.l0Name}>{prettify(l0)}</span>
                </button>
                {isOpen && (
                  <div>
                    {/* The L0 itself is selectable (broadest), then its children. */}
                    {l0Node && (
                      <label style={{ ...styles.rowLabel, paddingLeft: '24px' }}>
                        <input type="checkbox" checked={selectedSet.has(l0)} onChange={() => toggle(l0)} style={styles.checkbox} />
                        <span style={styles.code}>all {prettify(l0)}</span>
                      </label>
                    )}
                    {top.map((n) => renderRow(n, true))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {selected.length > 0 && (
        <div style={styles.selectedBar}>
          <span style={styles.selectedLabel}>{selected.length} selected:</span>
          {selected.map((code) => (
            <span key={code} style={styles.chip}>
              {prettify(code)}
              <button type="button" style={styles.chipX} onClick={() => toggle(code)} aria-label={`Remove ${code}`}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-sm)', background: 'var(--color-background)' },
  searchInput: { width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', background: 'var(--color-background)', boxSizing: 'border-box' as const },
  hint: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', margin: '6px 2px' },
  tree: { maxHeight: '320px', overflowY: 'auto' as const, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 0' },
  l0Group: { borderBottom: '1px solid var(--color-border)' },
  l0Header: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '8px 10px', color: 'var(--color-text)', fontSize: 'var(--font-size-sm)', fontWeight: 600, textAlign: 'left' as const },
  l0Name: { textTransform: 'capitalize' as const },
  row: { display: 'flex', alignItems: 'center', gap: '4px' },
  caret: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)', width: '16px', padding: 0 },
  caretSpacer: { display: 'inline-block', width: '16px' },
  rowLabel: { display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0', cursor: 'pointer', fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', flex: 1 },
  checkbox: { width: '15px', height: '15px', cursor: 'pointer' },
  code: { textTransform: 'capitalize' as const },
  childHint: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  searchRow: { padding: '2px 10px' },
  pathHint: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', textTransform: 'capitalize' as const, marginLeft: '6px' },
  selectedBar: { display: 'flex', flexWrap: 'wrap' as const, gap: '6px', alignItems: 'center', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--color-border)' },
  selectedLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontWeight: 600 },
  chip: { display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 4px 2px 8px', borderRadius: '12px', fontSize: 'var(--font-size-xs)', background: 'var(--color-primary)', color: 'var(--color-primary-contrast, #fff)', textTransform: 'capitalize' as const },
  chipX: { background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 'var(--font-size-sm)', lineHeight: 1, padding: '0 2px' },
  muted: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', padding: '8px' },
};
