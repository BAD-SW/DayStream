import { useState, useEffect, useCallback } from 'react';
import { Button } from '../../design-system/components/actions/Button';
import { Badge } from '../../design-system/components/data/Badge';
import { fetchThemes, deleteTheme } from '../../api/themes';
import { ThemeListItem, ThemeScope } from '@daystream/shared';
import { ThemeEditor } from './ThemeEditor';
import { ApplyThemeDialog } from './ApplyThemeDialog';
import { useTheme } from '../../design-system/themes/ThemeProvider';
import { ConfirmDialog } from '../../design-system/components/feedback/ConfirmDialog';
import './ThemeGallery.css';

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
  const [deleteTarget, setDeleteTarget] = useState<ThemeListItem | null>(null);

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
    <div className="tg">
      <div className="tg-header">
        <div>
          <h2 className="tg-title">Themes</h2>
          <p className="tg-subtext">Pick a theme to apply, customise one into a new named theme, or build one from scratch.</p>
        </div>
        <Button onClick={() => setEditorTarget({ mode: 'create' })}>New theme</Button>
      </div>

      {toast && <div className="tg-toast" role="status">{toast}</div>}

      {loading && <p className="tg-muted">Loading themes...</p>}
      {error && (
        <div className="tg-error">
          {error} <Button variant="ghost" size="sm" onClick={load}>Retry</Button>
        </div>
      )}

      {!loading && !error && (
        <div className="tg-grid">
          {themes.map((theme) => (
            <div key={theme.id} className="tg-card">
              <div className="tg-swatches" aria-hidden="true">
                {SWATCH_KEYS.map((k) => (
                  <span key={k} style={{ background: theme.preview_tokens[k] || 'transparent' }} />
                ))}
              </div>
              <div className="tg-card-body">
                <div className="tg-card-title">
                  <span className="tg-card-name">{theme.name}</span>
                  {theme.is_active && <Badge variant="success">Active</Badge>}
                </div>
                <div className="tg-card-meta">
                  {theme.is_built_in ? 'Built-in' : 'Custom'} · based on {theme.base_theme === 'navy' ? 'Navy' : theme.base_theme === 'bold-business' ? 'Bold Business' : 'Classic'}
                  {!theme.is_built_in && theme.scope !== own && <> · {theme.scope} scope</>}
                </div>
                <div className="tg-card-actions">
                  <Button variant="outline" size="sm" onClick={() => setApplyTarget(theme)}>Apply</Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditorTarget({ mode: 'create', theme })}>Customize</Button>
                  {!theme.is_built_in && (persona === 'system' || theme.scope === own) && (
                    <Button variant="ghost" size="sm" onClick={() => setEditorTarget({ mode: 'edit', theme })}>Edit</Button>
                  )}
                  {canDelete(theme) && (
                    <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(theme)}>Delete</Button>
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

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) handleDelete(deleteTarget); }}
        title="Delete theme"
        message={deleteTarget ? `Delete "${deleteTarget.name}"? This cannot be undone.` : ''}
        confirmLabel="Delete"
      />
    </div>
  );
}
