import { useState, useEffect, CSSProperties } from 'react';
import { Button } from '../../design-system/components/actions/Button';
import { apiClient } from '../../api/client';
import { fetchBaseTokens, createTheme, updateTheme, BaseTokensResponse } from '../../api/themes';
import { BuiltInThemeId, ThemeListItem, ThemeScope } from '@daystream/shared';
import { deriveFromBrandColors } from './colorDerivation';

interface ThemeEditorProps {
  persona: 'business' | 'tenant' | 'system';
  mode: 'create' | 'edit';
  theme?: ThemeListItem; // in 'create' mode: the theme being customized FROM; in 'edit' mode: the theme itself
  onSaved: () => void;
  onCancel: () => void;
}

const TEXT_COLOR_KEYS = ['--color-text-title', '--color-text-body', '--color-text-secondary', '--color-text-muted'];
const TYPOGRAPHY_KEYS = [
  '--font-family', '--font-size-title', '--font-size-subtitle', '--font-size-body', '--font-size-small',
  '--font-weight-normal', '--font-weight-medium', '--font-weight-bold',
  ...TEXT_COLOR_KEYS,
];
const COLOR_KEYS = [
  '--color-primary', '--color-primary-hover', '--color-primary-contrast',
  '--color-secondary', '--color-secondary-hover', '--color-secondary-contrast',
  '--color-background', '--color-surface', '--color-border', '--color-divider',
  '--color-sidebar-bg', '--color-header-bg', '--color-nav-active-bg', '--color-nav-active-text',
  '--color-accent', '--color-success', '--color-warning', '--color-error',
];
// Split across two columns (Column 2 / Column 3) so the 18-item list doesn't tower over
// the other sections.
const COLOR_KEYS_COL_A = COLOR_KEYS.slice(0, 9);
const COLOR_KEYS_COL_B = COLOR_KEYS.slice(9);
const BRANDING_KEYS = ['logo-url', 'favicon-url', 'app-icon-url', 'brand-name'];
const CURATED_FONTS = ['System Default', 'Inter', 'Merriweather', 'Source Sans 3'];
const FONT_SIZE_TOKENS = ['--font-size-title', '--font-size-subtitle', '--font-size-body', '--font-size-small'];
const FONT_WEIGHT_TOKENS = ['--font-weight-normal', '--font-weight-medium', '--font-weight-bold'];

// A quick "easy path" palette offered alongside the hex input + native colour picker
// on every colour field — most users pick a basic colour rather than dial in a hex value.
const PRESET_COLORS = [
  '#DC2626', '#EA580C', '#D97706', '#CA8A04', '#16A34A', '#0D9488',
  '#2563EB', '#4F46E5', '#9333EA', '#DB2777', '#6B7280', '#111827', '#FFFFFF',
];

function ownScopeFor(persona: ThemeEditorProps['persona']): ThemeScope {
  return persona === 'business' ? 'business' : persona === 'tenant' ? 'tenant' : 'system';
}

export function ThemeEditor({ persona, mode, theme, onSaved, onCancel }: ThemeEditorProps) {
  const isEditingExisting = mode === 'edit' && !!theme && !theme.is_built_in;
  // Quick Setup (4 inputs, everything else derived) is the default for a fresh theme;
  // editing an existing one opens in Advanced since it may already have hand-tuned values.
  const [setupMode, setSetupMode] = useState<'quick' | 'advanced'>(isEditingExisting ? 'advanced' : 'quick');
  const [baseTheme, setBaseTheme] = useState<BuiltInThemeId>(theme?.base_theme || 'bold-business');
  const [baseTokens, setBaseTokens] = useState<BaseTokensResponse | null>(null);
  const [values, setValues] = useState<Record<string, string>>(theme?.preview_tokens || {});
  const [name, setName] = useState(isEditingExisting ? theme!.name : '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ownTenantId, setOwnTenantId] = useState<string | null>(null);

  useEffect(() => {
    fetchBaseTokens().then(setBaseTokens).catch(() => {});
    if (persona !== 'business') {
      apiClient.get('/v1/admin/my-context').then((res) => setOwnTenantId(res.data.data?.tenant?.id || null)).catch(() => {});
    }
  }, [persona]);

  // When creating fresh from a built-in (no saved values yet) or switching base theme,
  // seed the Typography/Colors values from that base's defaults. Branding is untouched —
  // it has no base-theme default (Requirement 3.8 / 8.9 equivalent for branding).
  useEffect(() => {
    if (!baseTokens) return;
    if (mode === 'edit' && theme && !theme.is_built_in) return; // keep the saved values as-is
    setValues((prev) => ({ ...baseTokens.tokens[baseTheme], ...pickBranding(prev) }));
  }, [baseTheme, baseTokens]); // eslint-disable-line react-hooks/exhaustive-deps

  function pickBranding(v: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const k of BRANDING_KEYS) if (v[k]) out[k] = v[k];
    return out;
  }

  function handleChange(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  /** Quick Setup: changing the primary/secondary brand colour re-derives every colour
   * token that plausibly follows from it (hover/contrast/sidebar/nav/accent) — everything
   * else keeps the base theme's own values. See colorDerivation.ts. */
  function handleBrandChange(field: 'primary' | 'secondary', value: string) {
    setValues((v) => {
      const primary = field === 'primary' ? value : (v['--color-primary'] || '#000000');
      const secondary = field === 'secondary' ? value : (v['--color-secondary'] || '#000000');
      return { ...v, ...deriveFromBrandColors(primary, secondary) };
    });
  }

  function handleResetToBase() {
    if (!baseTokens) return;
    setValues((v) => ({ ...baseTokens.tokens[baseTheme], ...pickBranding(v) }));
  }

  async function handleSave() {
    setNameError(null);
    if (!name.trim()) { setNameError('Name is required.'); return; }

    const tokens: Record<string, string> = {};
    for (const k of [...TYPOGRAPHY_KEYS, ...COLOR_KEYS, ...BRANDING_KEYS]) {
      if (values[k]) tokens[k] = values[k];
    }

    setSaving(true);
    try {
      if (isEditingExisting) {
        await updateTheme(theme!.id, { name: name.trim(), tokens });
      } else {
        const own = ownScopeFor(persona);
        const scopeId = persona === 'business' ? localStorage.getItem('business_id') : persona === 'tenant' ? ownTenantId : null;
        await createTheme({ name: name.trim(), base_theme: baseTheme, scope: own, scope_id: scopeId, tokens });
      }
      onSaved();
    } catch (err: any) {
      if (err.response?.status === 409) setNameError(err.response?.data?.error || 'A theme with this name already exists at this scope.');
      else setNameError(err.response?.data?.error || 'Failed to save theme.');
    } finally {
      setSaving(false);
    }
  }

  const previewStyle: CSSProperties = {
    ...Object.fromEntries([...TYPOGRAPHY_KEYS, ...COLOR_KEYS].map((k) => [k, values[k]]).filter(([, v]) => v)),
  } as CSSProperties;

  return (
    <div>
      <div style={styles.headerRow}>
        <h3 style={styles.title}>{isEditingExisting ? `Edit "${theme!.name}"` : 'New Theme'}</h3>
        <div style={styles.headerActions}>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>Save Theme</Button>
        </div>
      </div>

      {/* Name + base theme — compact single row, not full-width cards */}
      <div style={styles.topRow}>
        <div style={{ ...styles.topField, flex: isEditingExisting ? 1 : 2 }}>
          <label style={styles.fieldLabel}>Theme name</label>
          <input style={styles.textInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Transcend Teal" />
          {nameError && <p style={styles.errorText}>{nameError}</p>}
        </div>
        {!isEditingExisting && (
          <div style={{ ...styles.topField, flex: 1 }}>
            <label style={styles.fieldLabel}>Base theme</label>
            <select style={styles.select} value={baseTheme} onChange={(e) => setBaseTheme(e.target.value as BuiltInThemeId)}>
              <option value="bold-business">Bold Business</option>
              <option value="classic">Classic</option>
            </select>
          </div>
        )}
        <div style={{ ...styles.topField, flex: 1 }}>
          <label style={styles.fieldLabel}>Setup mode</label>
          <div style={styles.modeToggle}>
            <button type="button" style={{ ...styles.modeBtn, ...(setupMode === 'quick' ? styles.modeBtnActive : {}) }} onClick={() => setSetupMode('quick')}>Quick Setup</button>
            <button type="button" style={{ ...styles.modeBtn, ...(setupMode === 'advanced' ? styles.modeBtnActive : {}) }} onClick={() => setSetupMode('advanced')}>Advanced</button>
          </div>
        </div>
      </div>

      {setupMode === 'quick' ? (
        <div style={styles.quickLayout}>
          <div style={styles.card}>
            <h4 style={styles.sectionTitle}>Quick Setup</h4>
            <ColorField label="Primary colour" value={values['--color-primary'] || '#000000'} onChange={(v) => handleBrandChange('primary', v)} />
            <ColorField label="Secondary colour" value={values['--color-secondary'] || '#000000'} onChange={(v) => handleBrandChange('secondary', v)} />
            <div style={styles.field}>
              <label style={styles.fieldLabel}>Font family</label>
              <select style={styles.select} value={values['--font-family'] || 'System Default'} onChange={(e) => handleChange('--font-family', e.target.value)}>
                {CURATED_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>Logo URL</label>
              <input style={styles.textInput} value={values['logo-url'] || ''} onChange={(e) => handleChange('logo-url', e.target.value)} placeholder="https://…/logo.svg" />
            </div>
            <p style={styles.quickHint}>
              Hover/contrast/sidebar/nav shades are derived automatically from your primary and secondary colours.
              Backgrounds, text, borders, and status colours follow the {baseTheme === 'bold-business' ? 'Bold Business' : 'Classic'} base theme.
              Switch to <strong>Advanced</strong> to fine-tune any of it.
            </p>
          </div>
          {renderPreview()}
        </div>
      ) : (
      <div style={styles.fourCol}>
        {/* Typography */}
        <div style={styles.card}>
          <div style={styles.sectionHeaderRow}>
            <h4 style={styles.sectionTitle}>Typography</h4>
            <button type="button" style={styles.resetBtn} onClick={handleResetToBase}>Reset to Base</button>
          </div>
          <div style={styles.field}>
            <label style={styles.fieldLabel}>Font family</label>
            <select style={styles.select} value={values['--font-family'] || 'System Default'} onChange={(e) => handleChange('--font-family', e.target.value)}>
              {CURATED_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div style={styles.twoColGrid}>
            {FONT_SIZE_TOKENS.map((k) => (
              <div style={styles.field} key={k}>
                <label style={styles.fieldLabel}>{LABELS[k]}</label>
                <input style={styles.textInput} value={values[k] || ''} onChange={(e) => handleChange(k, e.target.value)} placeholder="e.g. 15px" />
              </div>
            ))}
          </div>
          <div style={styles.threeColSmallGrid}>
            {FONT_WEIGHT_TOKENS.map((k) => (
              <div style={styles.field} key={k}>
                <label style={styles.fieldLabel}>{LABELS[k]}</label>
                <select style={styles.select} value={values[k] || ''} onChange={(e) => handleChange(k, e.target.value)}>
                  <option value="">—</option>
                  {['300', '400', '500', '600', '700'].map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
            ))}
          </div>
          {TEXT_COLOR_KEYS.map((k) => (
            <ColorField key={k} label={LABELS[k]} value={values[k] || '#000000'} onChange={(v) => handleChange(k, v)} />
          ))}
        </div>

        {/* Colors — split across two columns so the list doesn't dominate the page height */}
        <div style={styles.card}>
          <h4 style={styles.sectionTitle}>Colors</h4>
          {COLOR_KEYS_COL_A.map((k) => (
            <ColorField key={k} label={LABELS[k]} value={values[k] || '#000000'} onChange={(v) => handleChange(k, v)} />
          ))}
        </div>
        <div style={styles.card}>
          <h4 style={{ ...styles.sectionTitle, visibility: 'hidden' }}>Colors</h4>
          {COLOR_KEYS_COL_B.map((k) => (
            <ColorField key={k} label={LABELS[k]} value={values[k] || '#000000'} onChange={(v) => handleChange(k, v)} />
          ))}
        </div>

        {/* Branding + preview underneath (branding has few fields, so the preview fills the rest of this column) */}
        <div>
          <div style={styles.card}>
            <h4 style={styles.sectionTitle}>Branding</h4>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>Logo URL</label>
              <input style={styles.textInput} value={values['logo-url'] || ''} onChange={(e) => handleChange('logo-url', e.target.value)} placeholder="https://…/logo.svg" />
            </div>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>Favicon URL</label>
              <input style={styles.textInput} value={values['favicon-url'] || ''} onChange={(e) => handleChange('favicon-url', e.target.value)} placeholder="https://…/favicon.png" />
            </div>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>App icon URL</label>
              <input style={styles.textInput} value={values['app-icon-url'] || ''} onChange={(e) => handleChange('app-icon-url', e.target.value)} placeholder="https://…/icon.png" />
            </div>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>Brand name override</label>
              <input style={styles.textInput} value={values['brand-name'] || ''} onChange={(e) => handleChange('brand-name', e.target.value)} placeholder="Blank = use platform/tenant name" />
            </div>
          </div>

          {renderPreview()}
        </div>
      </div>
      )}
    </div>
  );

  function renderPreview() {
    return (
      <div style={styles.previewPanel}>
        <div style={styles.previewLabel}>LIVE PREVIEW</div>
        <p style={styles.previewNote}>Updates as you edit — not saved until you click Save.</p>
        <div style={{ ...styles.previewFrame, ...previewStyle, background: 'var(--color-background)' }}>
          <div style={{ background: 'var(--color-sidebar-bg)', color: '#fff', padding: '10px', borderRadius: 'var(--radius-md)', fontSize: '12px', marginBottom: '10px' }}>Sidebar</div>
          <div style={{ background: 'var(--color-header-bg)', border: '1px solid var(--color-border)', padding: '8px 10px', borderRadius: 'var(--radius-md)', marginBottom: '12px', fontSize: '12px', color: 'var(--color-text-body)' }}>Top bar</div>
          <div style={{ fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-title)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text-title)', marginBottom: '6px' }}>Book an appointment</div>
          <div style={{ fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-body)', color: 'var(--color-text-body)', marginBottom: '4px' }}>Body text sample</div>
          <div style={{ fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-small)', color: 'var(--color-text-muted)', marginBottom: '14px' }}>Muted small text</div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div style={{ background: 'var(--color-primary)', color: 'var(--color-primary-contrast)', padding: '8px 16px', borderRadius: 'var(--radius-md)', fontSize: '13px', fontWeight: 600 }}>Primary</div>
            <div style={{ background: 'var(--color-secondary)', color: 'var(--color-secondary-contrast)', padding: '8px 16px', borderRadius: 'var(--radius-md)', fontSize: '13px', fontWeight: 600 }}>Secondary</div>
          </div>
          <div style={{ marginTop: '14px', background: 'var(--color-surface)', border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)', padding: '10px', fontSize: '12px', color: 'var(--color-text-body)' }}>
            Card / table row surface
          </div>
        </div>
      </div>
    );
  }
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={styles.colorField}>
      <label style={styles.fieldLabel}>{label}</label>
      <div style={styles.colorRow}>
        <input type="color" value={/^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} style={styles.colorSwatch} />
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} style={styles.colorHex} />
      </div>
      <div style={styles.presetRow}>
        {PRESET_COLORS.map((c) => (
          <button key={c} type="button" title={c} onClick={() => onChange(c)}
            style={{ ...styles.presetDot, background: c, outline: value.toLowerCase() === c.toLowerCase() ? '2px solid var(--color-primary)' : 'none', outlineOffset: '1px' }} />
        ))}
      </div>
    </div>
  );
}

const LABELS: Record<string, string> = {
  '--font-size-title': 'Title size', '--font-size-subtitle': 'Subtitle size', '--font-size-body': 'Body text size', '--font-size-small': 'Small text size',
  '--font-weight-normal': 'Normal weight', '--font-weight-medium': 'Medium weight', '--font-weight-bold': 'Bold weight',
  '--color-text-title': 'Title colour', '--color-text-body': 'Body text colour', '--color-text-secondary': 'Secondary text (sidebar, labels)', '--color-text-muted': 'Muted text colour',
  '--color-primary': 'Primary', '--color-primary-hover': 'Primary hover', '--color-primary-contrast': 'Primary text',
  '--color-secondary': 'Secondary', '--color-secondary-hover': 'Secondary hover', '--color-secondary-contrast': 'Secondary text',
  '--color-background': 'Page background', '--color-surface': 'Card surface', '--color-border': 'Border', '--color-divider': 'Divider',
  '--color-sidebar-bg': 'Sidebar background', '--color-header-bg': 'Header background',
  '--color-nav-active-bg': 'Active nav background', '--color-nav-active-text': 'Active nav text',
  '--color-accent': 'Accent', '--color-success': 'Success', '--color-warning': 'Warning', '--color-error': 'Error',
};

const styles: Record<string, CSSProperties> = {
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' },
  title: { fontSize: 'var(--font-size-section-header, 1.0625rem)', fontWeight: 700, color: 'var(--color-text)', margin: 0 },
  headerActions: { display: 'flex', gap: '8px', flexShrink: 0 },
  topRow: { display: 'flex', gap: 'var(--space-lg)', marginBottom: 'var(--space-lg)' },
  topField: { minWidth: 0 },
  modeToggle: { display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', width: 'fit-content' },
  modeBtn: { border: 'none', borderRight: '1px solid var(--color-border)', background: 'var(--color-background)', padding: '9px 14px', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-secondary)', cursor: 'pointer' },
  modeBtnActive: { background: 'var(--color-primary)', color: 'var(--color-primary-contrast)' },
  quickLayout: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-lg)', alignItems: 'start', maxWidth: '900px' },
  quickHint: { fontSize: '12.5px', color: 'var(--color-text-secondary)', lineHeight: 1.5, margin: 'var(--space-md) 0 0' },
  // Colors columns get more width than Typography/Branding — they need room for the
  // 13-swatch preset row to sit on one line instead of wrapping.
  fourCol: { display: 'grid', gridTemplateColumns: '0.85fr 1.15fr 1.15fr 0.85fr', gap: 'var(--space-lg)', alignItems: 'start' },
  card: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)', marginBottom: 'var(--space-lg)' },
  sectionHeaderRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' },
  sectionTitle: { fontSize: '14.5px', fontWeight: 700, color: 'var(--color-text)', margin: '0 0 var(--space-md) 0' },
  resetBtn: { background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: 0 },
  fieldLabel: { fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '5px' },
  textInput: { width: '100%', padding: '9px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)', color: 'var(--color-text)', fontSize: '13.5px', boxSizing: 'border-box' },
  select: { width: '100%', padding: '9px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)', color: 'var(--color-text)', fontSize: '13.5px', boxSizing: 'border-box' },
  field: { marginBottom: 'var(--space-md)' },
  twoColGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: 'var(--space-md)' },
  threeColSmallGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: 'var(--space-md)' },
  colorField: { marginBottom: 'var(--space-md)' },
  colorRow: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' },
  colorSwatch: { width: '32px', height: '32px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: 0, cursor: 'pointer', flexShrink: 0 },
  colorHex: { flex: 1, minWidth: 0, fontSize: '12.5px', padding: '7px 9px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)', color: 'var(--color-text)', boxSizing: 'border-box' },
  presetRow: { display: 'flex', flexWrap: 'nowrap', gap: '3px' },
  presetDot: { width: '15px', height: '15px', borderRadius: '50%', border: '1px solid var(--color-border)', padding: 0, cursor: 'pointer', flexShrink: 0 },
  errorText: { fontSize: '12.5px', color: 'var(--color-error)', marginTop: '6px' },
  previewPanel: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' },
  previewLabel: { fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-secondary)', padding: '14px 18px 0' },
  previewNote: { fontSize: '11.5px', color: 'var(--color-text-secondary)', padding: '0 18px 14px', margin: 0 },
  previewFrame: { borderTop: '1px solid var(--color-border)', padding: 'var(--space-lg)' },
};
