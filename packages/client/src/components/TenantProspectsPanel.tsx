import { useState, useEffect, useRef } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { apiClient } from '../api/client';
import { ProspectsList } from './ProspectsList';

/**
 * TenantProspectsPanel — SYSTEM ADMIN control to generate a tenant's prospect list
 * (the costly Google Places search). Generation lives here, in the tenant-definition
 * window, rather than in the tenant's own app — so a tenant can't repeatedly trigger
 * cost. The tenant still VIEWS the resulting prospects in their own Prospects page.
 *
 * Depends on the tenant having a territory assigned (the TerritoryPicker above).
 */

interface Props {
  tenantId: string;
}

interface CategoryMapping { id: string; ui_category_name: string }

interface UsageInfo {
  status: 'ok' | 'not_configured' | 'error';
  message?: string;
  calls_this_month?: number;
  free_threshold?: number;
  remaining?: number;
  resets_on?: string;
  period_label?: string;
  as_of?: string;
}

interface GenProgress {
  phase: 'searching' | 'saving' | 'finalizing';
  categories_total: number;
  categories_done: number;
  centers_total: number;
  centers_done: number;
  api_calls: number;
  found: number;
  current_category?: string;
}

export function TenantProspectsPanel({ tenantId }: Props) {
  const [categories, setCategories] = useState<CategoryMapping[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastRun, setLastRun] = useState<{ total: number; added: number; inactive: number; calls?: number; truncated?: boolean } | null>(null);
  const [showList, setShowList] = useState(false);
  const [listCount, setListCount] = useState<number | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [progress, setProgress] = useState<GenProgress | null>(null);
  const pollTimer = useRef<number | null>(null);

  const loadUsage = (refresh = false) => {
    apiClient.get(`/v1/prospects/usage${refresh ? '?refresh=true' : ''}`)
      .then((res) => setUsage(res.data.data as UsageInfo))
      .catch(() => setUsage({ status: 'error', message: 'Could not load usage.' }));
  };

  useEffect(() => {
    apiClient.get('/v1/prospects/categories')
      .then((res) => {
        const cats: CategoryMapping[] = res.data.data || [];
        setCategories(cats);
        setSelectedIds(cats.map((c) => c.id));
      })
      .catch(() => {});
    loadUsage();
    return () => { if (pollTimer.current) window.clearTimeout(pollTimer.current); };
  }, []);

  const toggle = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  async function handleGenerate() {
    if (selectedIds.length === 0) { setMsg({ ok: false, text: 'Select at least one category.' }); return; }
    setMsg(null);

    // No pre-run cost estimate dialog: the estimate range was too wide to be useful, and the
    // Google Places usage table (calls this month vs. the free allowance) now gives a far
    // better, real signal of consumption. Generate kicks off the background run directly.
    setGenerating(true);
    setProgress(null);
    try {
      // Kick off the background run; this returns immediately (202).
      await apiClient.post(`/v1/prospects/${tenantId}/generate`, { category_ids: selectedIds });
      setMsg({ ok: true, text: 'Generation started…' });
      pollStatus();
    } catch (err: any) {
      setMsg({ ok: false, text: err?.response?.data?.error || 'Failed to start generation.' });
      setGenerating(false);
    }
  }

  // Poll the background run's status until it finishes, updating progress as it goes.
  function pollStatus() {
    const tick = async () => {
      try {
        const res = await apiClient.get(`/v1/prospects/${tenantId}/generate/status`);
        const s = res.data.data || res.data;
        if (s.state === 'running') {
          setProgress(s.progress || null);
          pollTimer.current = window.setTimeout(tick, 2500);
          return;
        }
        if (s.state === 'done') {
          const r = s.result || {};
          setLastRun({ total: r.total_returned ?? 0, added: r.new_added ?? 0, inactive: r.inactive_marked ?? 0, calls: r.api_calls, truncated: !!r.truncated });
          setMsg({ ok: true, text: r.truncated ? 'Generated (stopped at the API-call budget — results are partial).' : 'Prospect list generated.' });
          loadUsage(true); // refresh month-to-date usage after a paid run
        } else if (s.state === 'error') {
          setMsg({ ok: false, text: s.error || 'Generation failed.' });
        }
        setProgress(null);
        setGenerating(false);
      } catch {
        // Transient poll failure — try again shortly rather than giving up.
        pollTimer.current = window.setTimeout(tick, 3500);
      }
    };
    tick();
  }

  return (
    <div style={styles.wrap}>
      <p style={styles.help}>
        Generate the prospect list for this tenant from Google Places, scoped to the territory
        above. This is a paid search run by DayStream admins — the tenant views the results in
        their own Prospects page but cannot run it themselves.
      </p>

      {categories.length === 0 ? (
        <p style={styles.muted}>No prospect categories configured.</p>
      ) : (
        <>
          <div style={styles.chips}>
            {categories.map((c) => {
              const on = selectedIds.includes(c.id);
              return (
                <button
                  key={c.id} type="button" onClick={() => toggle(c.id)}
                  style={{ ...styles.chip, ...(on ? styles.chipOn : {}) }}
                >
                  {c.ui_category_name}
                </button>
              );
            })}
          </div>
          <div style={styles.row}>
            <div style={styles.actionsCol}>
              <div style={styles.actions}>
                <Button variant="primary" size="sm" loading={generating} onClick={handleGenerate}>
                  {generating ? 'Generating…' : 'Generate prospects'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowList(true)}>View prospects</Button>
                <span style={styles.muted}>{selectedIds.length} of {categories.length} categories selected</span>
              </div>

              {/* Status + result sit directly under the buttons, in the left column, so the
                  message is close to the action and doesn't drop below the usage card. */}
              {msg && (
                <p style={{ ...styles.status, color: msg.ok ? 'var(--color-success, #17794A)' : 'var(--color-error, #C4291C)' }}>{msg.text}</p>
              )}
              {generating && progress && (
                <p style={styles.statusDetail}>
                  {progress.phase === 'searching'
                    ? `Searching ${progress.current_category ?? ''} — area ${progress.centers_done}/${progress.centers_total}, category ${progress.categories_done + 1}/${progress.categories_total}`
                    : progress.phase === 'saving' ? 'Saving results…' : 'Finalizing…'}
                  {` · ${progress.api_calls.toLocaleString()} API calls · ${progress.found.toLocaleString()} found`}
                </p>
              )}
              {lastRun && !generating && (
                <p style={styles.statusDetail}>
                  <strong>{lastRun.total.toLocaleString()}</strong> prospects found · {lastRun.added.toLocaleString()} added · {lastRun.inactive.toLocaleString()} marked inactive
                  {lastRun.calls != null ? ` · ${lastRun.calls.toLocaleString()} API calls` : ''}
                  {lastRun.truncated ? ' · ⚠ partial (API-call budget reached)' : ''}
                </p>
              )}
            </div>
            <UsageTable usage={usage} onRefresh={() => loadUsage(true)} />
          </div>
        </>
      )}

      {/* System-admin view of this tenant's prospect list — same detail/functionality
          the tenant sees on their own Prospects page. */}
      {showList && (
        <div style={styles.overlay} onClick={() => setShowList(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>
                Prospects{listCount != null ? ` (${listCount})` : ''}
              </h3>
              <button style={styles.closeBtn} onClick={() => setShowList(false)} aria-label="Close">&times;</button>
            </div>
            <p style={styles.muted}>Viewing this tenant&rsquo;s prospect list. Changes here (status, notes, dismiss) apply to the tenant.</p>
            <ProspectsList apiBase={`/v1/prospects/${tenantId}`} ownTenant={false} onCountChange={setListCount} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Authoritative Google Places API usage for the current billing month (red-box table). */
function UsageTable({ usage, onRefresh }: { usage: UsageInfo | null; onRefresh: () => void }) {
  if (!usage) {
    return <div style={styles.usageBox}><span style={styles.muted}>Loading usage…</span></div>;
  }

  if (usage.status !== 'ok') {
    const notConfigured = usage.status === 'not_configured';
    return (
      <div style={styles.usageBox}>
        <div style={styles.usageTitle}>Google Places usage</div>
        <p style={styles.muted}>
          {notConfigured
            ? 'Usage monitoring not configured.'
            : (usage.message || 'Usage unavailable.')}
        </p>
        {notConfigured && (
          <a href="/admin/config?tab=api-keys" style={styles.usageLink}>Configure in Configuration → API Keys</a>
        )}
      </div>
    );
  }

  const calls = usage.calls_this_month ?? 0;
  const threshold = usage.free_threshold ?? 0;
  const remaining = usage.remaining ?? Math.max(0, threshold - calls);
  const pct = threshold > 0 ? Math.min(100, Math.round((calls / threshold) * 100)) : 0;
  const over = threshold > 0 && calls > threshold;
  const resets = usage.resets_on ? new Date(usage.resets_on).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

  return (
    <div style={styles.usageBox}>
      <div style={styles.usageHeader}>
        <span style={styles.usageTitle}>Google Places usage</span>
        <button type="button" onClick={onRefresh} style={styles.refreshBtn} aria-label="Refresh usage" title="Refresh">↻</button>
      </div>
      <table style={styles.usageTable}>
        <tbody>
          <tr>
            <td style={styles.usageLabel}>Calls this month</td>
            <td style={styles.usageValue}>{calls.toLocaleString()}</td>
          </tr>
          <tr>
            <td style={styles.usageLabel}>Free allowance</td>
            <td style={styles.usageValue}>{threshold.toLocaleString()}</td>
          </tr>
          <tr>
            <td style={styles.usageLabel}>Remaining</td>
            <td style={{ ...styles.usageValue, color: over ? 'var(--color-error, #C4291C)' : 'var(--color-text)' }}>
              {over ? `0 (over by ${(calls - threshold).toLocaleString()})` : remaining.toLocaleString()}
            </td>
          </tr>
          <tr>
            <td style={styles.usageLabel}>Resets</td>
            <td style={styles.usageValue}>{resets}</td>
          </tr>
        </tbody>
      </table>
      <div style={styles.usageBarTrack} aria-hidden>
        <div style={{ ...styles.usageBarFill, width: `${pct}%`, background: over ? 'var(--color-error, #C4291C)' : 'var(--color-primary)' }} />
      </div>
      {usage.period_label && <span style={styles.usageFoot}>{usage.period_label}</span>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', maxWidth: '860px' },
  row: { display: 'flex', gap: 'var(--space-lg)', alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: '4px' },
  actionsCol: { display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', flex: '1 1 320px', minWidth: '280px' },
  usageBox: { flex: '0 0 300px', minWidth: '260px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', padding: 'var(--space-md)', background: 'var(--color-surface, transparent)' },
  usageHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  usageTitle: { fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)' },
  refreshBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-md)', cursor: 'pointer', lineHeight: 1, padding: '0 4px' },
  usageTable: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' },
  usageLabel: { textAlign: 'left', color: 'var(--color-text-secondary)', padding: '3px 0' },
  usageValue: { textAlign: 'right', color: 'var(--color-text)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  usageBarTrack: { height: '6px', borderRadius: '3px', background: 'var(--color-border)', overflow: 'hidden', marginTop: '10px' },
  usageBarFill: { height: '100%', borderRadius: '3px', transition: 'width 0.3s ease' },
  usageFoot: { display: 'block', marginTop: '6px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' },
  usageLink: { fontSize: 'var(--font-size-xs)', color: 'var(--color-primary)', textDecoration: 'none' },
  help: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 },
  muted: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', margin: 0 },
  msg: { fontSize: 'var(--font-size-sm)', margin: '4px 0 0' },
  status: { fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-bold)' as any, margin: 'var(--space-sm) 0 0' },
  statusDetail: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: '2px 0 0' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  chip: { padding: '4px 12px', fontSize: 'var(--font-size-sm)', borderRadius: '16px', cursor: 'pointer', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text)', fontFamily: 'var(--font-family)' },
  chipOn: { background: 'var(--color-primary)', color: '#fff', borderColor: 'var(--color-primary)' },
  actions: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', marginTop: '4px' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 },
  modal: { background: 'var(--color-surface-modal, #FFFFFF)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-xl)', width: '95vw', maxWidth: '1200px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px var(--color-border)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xs)' },
  modalTitle: { fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  closeBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-2xl)', cursor: 'pointer', padding: '0 8px', lineHeight: 1 },
};
