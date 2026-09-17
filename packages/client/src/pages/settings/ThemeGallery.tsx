import { useState, useEffect, useCallback } from 'react';
import { Button } from '../../design-system/components/actions/Button';
import { Badge } from '../../design-system/components/data/Badge';
import { fetchThemes, deleteTheme } from '../../api/themes';
import { ThemeListItem, ThemeScope } from '@daystream/shared';
import { ThemeEditor } from './ThemeEditor';
import { ApplyThemeDialog } from './ApplyThemeDialog';
import { useTheme } from '../../design-system/themes/ThemeProvider';

interface ThemeGalleryProps {
  persona: 'business' | 'tenant' | 'system';
}

const SWATCH_KEYS = ['--color-primary', '--color-sidebar-bg', '--color-background', '--color-surface', '--color-text-body'];

/** The caller's own scope, used to decide which Custom_Theme cards show a Delete button
 * and what the Apply Dialog's scope options are — same rule for both. */
function ownScopeFor(persona: ThemeGalleryProps['persona']): ThemeScope {
  return persona === 'business' ? 'business' : persona === 'tenant' ? 'tenant' : 'system';
}

export function ThemeGallery({ persona }: ThemeGalleryProps) {
  const { refreshTheme } = useTheme();
  const [themes, setThemes] = useState<ThemeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorTarget, setEditorTarget] = useState<{ mode: 'create' | 'edit'; theme?: ThemeListItem } | null>(null);
  const [applyTarget, setApplyTarget] = useState<ThemeListItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    fetchThemes()
      .then(setThemes)
      .catch(() => setError('Failed to load themes.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleDelete(theme: ThemeListItem) {
    if (!confirm(`Delete "${theme.name}"? This cannot be undone.`)) return;
    try {
      await deleteTheme(theme.id);
      setToast(`"${theme.name}" deleted.`);
      load();
    } catch (err: any) {
      setToast(err.response?.data?.error || 'Failed to delete theme.');
    }
  }

  const own = ownScopeFor(persona);

  function canDelete(theme: ThemeListItem): boolean {
    if (theme.is_built_in) return false;
    if (persona === 'system') return true;
    if (persona === 'tenant') return theme.scope !== 'system';
    return theme.scope === 'business';
  }

  if (editorTarget) {
    return (
      <ThemeEditor
        persona={persona}
        mode={editorTarget.mode}
        theme={editorTarget.theme}
        onSaved={() => { setEditorTarget(null); load(); setToast('Theme saved.'); }}
        onCancel={() => setEditorTarget(null)}
      />
    );
  }

  return (
    <div>
      <div style={styles.header}>
        <div>
          <h3 style={styles.title}>Themes</h3>
          <p style={styles.subtext}>Pick a theme to apply, customise one into a new named theme, or build one from scratch.</p>
        </div>
        <Button onClick={() => setEditorTarget({ mode: 'create' })}>New Theme</Button>
      </div>

      {toast && <div style={styles.toast}>{toast}</div>}

      {loading && <p style={styles.loading}>Loading themes...</p>}
      {error && (
        <div style={styles.errorBox}>
          {error} <button style={styles.retryBtn} onClick={load}>Retry</button>
        </div>
      )}

      {!loading && !error && (
        <div style={styles.grid}>
          {themes.map((theme) => (
            <div key={theme.id} style={styles.card}>
              <div style={styles.swatchRow}>
                {SWATCH_KEYS.map((k) => (
                  <span key={k} style={{ ...styles.swatch, background: theme.preview_tokens[k] || 'transparent' }} />
                ))}
              </div>
              <div style={styles.cardBody}>
                <div style={styles.cardTitleRow}>
                  <span style={styles.cardName}>{theme.name}</span>
                  {theme.is_active && <Badge variant="success">Active</Badge>}
                </div>
                <div style={styles.cardMeta}>
                  {theme.is_built_in ? 'Built-in' : 'Custom'} · based on {theme.base_theme === 'bold-business' ? 'Bold Business' : 'Classic'}
                  {!theme.is_built_in && theme.scope !== own && <> · {theme.scope} scope</>}
                </div>
                <div style={styles.cardActions}>
                  <Button variant="outline" onClick={() => setApplyTarget(theme)}>Apply</Button>
                  <Button variant="ghost" onClick={() => setEditorTarget({ mode: 'create', theme })}>Customize</Button>
                  {!theme.is_built_in && (persona === 'system' || theme.scope === own) && (
                    <Button variant="ghost" onClick={() => setEditorTarget({ mode: 'edit', theme })}>Edit</Button>
                  )}
                  {canDelete(theme) && (
                    <Button variant="ghost" onClick={() => handleDelete(theme)}>Delete</Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {applyTarget && (
        <ApplyThemeDialog
          theme={applyTarget}
          persona={persona}
          onClose={() => setApplyTarget(null)}
          onApplied={() => { setApplyTarget(null); load(); refreshTheme(); setToast(`"${applyTarget.name}" applied.`); }}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-section-header, 1.0625rem)', fontWeight: 700, color: 'var(--color-text)', margin: '0 0 4px 0' },
  subtext: { fontSize: '13.5px', color: 'var(--color-text-secondary)', margin: 0, maxWidth: '480px' },
  loading: { fontSize: '14px', color: 'var(--color-text-secondary)' },
  errorBox: { fontSize: '14px', color: 'var(--color-error)', marginBottom: 'var(--space-md)' },
  retryBtn: { background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontWeight: 600, marginLeft: '8px' },
  toast: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '13.5px', color: 'var(--color-text)', marginBottom: 'var(--space-md)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-lg)' },
  card: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' },
  swatchRow: { display: 'flex', height: '48px' },
  swatch: { flex: 1 },
  cardBody: { padding: 'var(--space-md) var(--space-lg) var(--space-lg)' },
  cardTitleRow: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' },
  cardName: { fontSize: '15px', fontWeight: 700, color: 'var(--color-text)' },
  cardMeta: { fontSize: '12.5px', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-md)' },
  cardActions: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
};
