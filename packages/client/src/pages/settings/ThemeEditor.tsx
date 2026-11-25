import { useState, useEffect, CSSProperties } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Card } from '../../design-system/components/data/Card';
import { Input } from '../../design-system/components/forms/Input';
import { Select } from '../../design-system/components/forms/Select';
import { SegmentedControl } from '../../design-system/components/forms/SegmentedControl';
import './ThemeEditor.css';
import { Button } from '../../design-system/components/actions/Button';
import { apiClient } from '../../api/client';
import { fetchBaseTokens, createTheme, updateTheme, BaseTokensResponse } from '../../api/themes';
import { BuiltInThemeId, ThemeListItem, ThemeScope } from '@daystream/shared';
import { deriveFromBrandColors } from './colorDerivation';
import { useContextManager } from '../../context/ContextManager';
import { CURATED_FONTS, fontStackFor } from '../../design-system/themes/ThemeProvider';

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
const BASE_THEME_IDS: BuiltInThemeId[] = ['navy', 'bold-business', 'classic'];
const FONT_SIZE_TOKENS = ['--font-size-title', '--font-size-subtitle', '--font-size-body', '--font-size-small'];
const FONT_WEIGHT_TOKENS = ['--font-weight-normal', '--font-weight-medium', '--font-weight-bold'];

// A quick "easy path" palette offered alongside the hex input + native colour picker
// on every colour field — most users pick a basic colour rather than dial in a hex value.
const PRESET_COLORS = [
  '#DC2626', '#EA580C', '#D97706', '#CA8A04', '#16A34A', '#0D9488',
  '#2563EB', '#0F1F5C', '#4F46E5', '#9333EA', '#DB2777', '#6B7280', '#111827', '#FFFFFF',
];

function ownScopeFor(persona: ThemeEditorProps['persona']): ThemeScope {
  return persona === 'business' ? 'business' : persona === 'tenant' ? 'tenant' : 'system';
}

export function ThemeEditor({ persona, mode, theme, onSaved, onCancel }: ThemeEditorProps) {
  const { t } = useTranslation('settings');
  const tokenLabel = (k: string) => t(`themes.token.${k.slice(2)}`);
  const isEditingExisting = mode === 'edit' && !!theme && !theme.is_built_in;
  // Quick Setup (4 inputs, everything else derived) is the default for a fresh theme;
  // editing an existing one opens in Advanced since it may already have hand-tuned values.
  const [setupMode, setSetupMode] = useState<'quick' | 'advanced'>(isEditingExisting ? 'advanced' : 'quick');
  const [baseTheme, setBaseTheme] = useState<BuiltInThemeId>(theme?.base_theme || 'navy');
  const [baseTokens, setBaseTokens] = useState<BaseTokensResponse | null>(null);
  const [values, setValues] = useState<Record<string, string>>(theme?.preview_tokens || {});
  const [name, setName] = useState(isEditingExisting ? theme!.name : '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ownTenantId, setOwnTenantId] = useState<string | null>(null);
  const { activeContext } = useContextManager();

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
    if (!name.trim()) { setNameError(t('themes.nameRequired')); return; }

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
        const scopeId = persona === 'business' ? activeContext.businessId : persona === 'tenant' ? ownTenantId : null;
        await createTheme({ name: name.trim(), base_theme: baseTheme, scope: own, scope_id: scopeId, tokens });
      }
      onSaved();
    } catch (err: any) {
      if (err.response?.status === 409) setNameError(err.response?.data?.error || t('themes.nameExists'));
      else setNameError(err.response?.data?.error || t('themes.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const previewStyle: CSSProperties = {
    ...Object.fromEntries([...TYPOGRAPHY_KEYS, ...COLOR_KEYS].map((k) => [k, values[k]]).filter(([, v]) => v)),
    ...(values['--font-family'] ? { '--font-family': fontStackFor(values['--font-family']) } : {}),
  } as CSSProperties;

  const fontOptions = CURATED_FONTS.map((f) => ({ value: f, label: f }));

  return (
    <div className="te">
      <Card
        padding="lg"
        title={isEditingExisting ? t('themes.editTitle', { name: theme!.name }) : t('themes.newTheme')}
        actions={<>
          <Button variant="ghost" onClick={onCancel}>{t('common:cancel')}</Button>
          <Button onClick={handleSave} loading={saving}>{t('themes.saveTheme')}</Button>
        </>}
      >
        <div className={`te-basics${isEditingExisting ? ' te-basics--edit' : ''}`}>
          <Input label={t('themes.themeName')} name="theme-name" value={name} onChange={setName} placeholder={t('themes.themeNamePlaceholder')} error={nameError ?? undefined} />
          {!isEditingExisting && (
            <Select
              label={t('themes.baseTheme')}
              name="theme-base"
              value={baseTheme}
              onChange={(v) => setBaseTheme(v as BuiltInThemeId)}
              options={BASE_THEME_IDS.map((id) => ({ value: id, label: t(`themes.base.${id}`) }))}
            />
          )}
          <div className="te-field">
            <span className="te-label">{t('themes.setupMode')}</span>
            <SegmentedControl
              aria-label={t('themes.setupMode')}
              value={setupMode}
              onChange={setSetupMode}
              options={[{ value: 'quick', label: t('themes.quickSetup') }, { value: 'advanced', label: t('themes.advanced') }]}
            />
          </div>
        </div>
      </Card>

      {setupMode === 'quick' ? (
        <div className="te-quick">
          <Card padding="lg" title={t('themes.quickSetupTitle')}>
            <div className="te-stack">
              <ColorField label={t('themes.primaryColour')} value={values['--color-primary'] || '#000000'} onChange={(v) => handleBrandChange('primary', v)} />
              <ColorField label={t('themes.secondaryColour')} value={values['--color-secondary'] || '#000000'} onChange={(v) => handleBrandChange('secondary', v)} />
              <Select label={t('themes.fontFamily')} name="theme-font" value={values['--font-family'] || 'System Default'} onChange={(v) => handleChange('--font-family', v)} options={fontOptions} />
              <Input label={t('themes.logoUrl')} name="theme-logo" value={values['logo-url'] || ''} onChange={(v) => handleChange('logo-url', v)} placeholder={'https://…/logo.svg'} />
              <p className="te-hint">
                <Trans i18nKey="themes.quickHint" ns="settings" values={{ base: t(`themes.base.${baseTheme}`) }} components={{ strong: <strong /> }} />
              </p>
            </div>
          </Card>
          {renderPreview()}
        </div>
      ) : (
        <div className="te-advanced">
          <Card padding="lg" title={t('themes.typography')} actions={<Button variant="ghost" size="sm" onClick={handleResetToBase}>{t('themes.resetToBase')}</Button>}>
            <div className="te-stack">
              <Select label={t('themes.fontFamily')} name="theme-font-adv" value={values['--font-family'] || 'System Default'} onChange={(v) => handleChange('--font-family', v)} options={fontOptions} />
              <div className="te-grid-2">
                {FONT_SIZE_TOKENS.map((k) => (
                  <Input key={k} label={tokenLabel(k)} name={`theme${k}`} value={values[k] || ''} onChange={(v) => handleChange(k, v)} placeholder={t('themes.sizePlaceholder')} />
                ))}
              </div>
              <div className="te-grid-3">
                {FONT_WEIGHT_TOKENS.map((k) => (
                  <Select key={k} label={tokenLabel(k)} name={`theme${k}`} value={values[k] || ''} onChange={(v) => handleChange(k, v)} placeholder="—"
                    options={['300', '400', '500', '600', '700', '800'].map((w) => ({ value: w, label: w }))} />
                ))}
              </div>
              {TEXT_COLOR_KEYS.map((k) => (
                <ColorField key={k} label={tokenLabel(k)} value={values[k] || '#000000'} onChange={(v) => handleChange(k, v)} />
              ))}
            </div>
          </Card>

          <Card padding="lg" title={t('themes.colours')}>
            <div className="te-stack">
              {COLOR_KEYS_COL_A.map((k) => (
                <ColorField key={k} label={tokenLabel(k)} value={values[k] || '#000000'} onChange={(v) => handleChange(k, v)} />
              ))}
            </div>
          </Card>
          <Card padding="lg" title={t('themes.moreColours')}>
            <div className="te-stack">
              {COLOR_KEYS_COL_B.map((k) => (
                <ColorField key={k} label={tokenLabel(k)} value={values[k] || '#000000'} onChange={(v) => handleChange(k, v)} />
              ))}
            </div>
          </Card>

          <div className="te-stack">
            <Card padding="lg" title={t('themes.branding')}>
              <div className="te-stack">
                <Input label={t('themes.logoUrl')} name="theme-logo-adv" value={values['logo-url'] || ''} onChange={(v) => handleChange('logo-url', v)} placeholder={'https://…/logo.svg'} />
                <Input label={t('themes.faviconUrl')} name="theme-favicon" value={values['favicon-url'] || ''} onChange={(v) => handleChange('favicon-url', v)} placeholder="https://…/favicon.png" />
                <Input label={t('themes.appIconUrl')} name="theme-app-icon" value={values['app-icon-url'] || ''} onChange={(v) => handleChange('app-icon-url', v)} placeholder="https://…/icon.png" />
                <Input label={t('themes.brandNameOverride')} name="theme-brand-name" value={values['brand-name'] || ''} onChange={(v) => handleChange('brand-name', v)} placeholder={t('themes.brandNamePlaceholder')} />
              </div>
            </Card>
            {renderPreview()}
          </div>
        </div>
      )}
    </div>
  );

  function renderPreview() {
    return (
      <Card padding="lg" title={t('themes.livePreview')}>
        <p className="te-preview-note">{t('themes.previewNote')}</p>
        <div className="te-preview" data-base-theme={baseTheme === 'classic' ? undefined : baseTheme} style={previewStyle}>
          <div className="te-preview__sidebar">{t('themes.previewSidebar')}</div>
          <div className="te-preview__topbar">{t('themes.previewTopBar')}</div>
          <div className="te-preview__title">{t('themes.previewTitle')}</div>
          <div className="te-preview__body">{t('themes.previewBody')}</div>
          <div className="te-preview__muted">{t('themes.previewMuted')}</div>
          <div className="te-preview__buttons">
            <span className="te-preview__btn te-preview__btn--primary">{t('themes.previewPrimary')}</span>
            <span className="te-preview__btn te-preview__btn--secondary">{t('themes.previewSecondary')}</span>
          </div>
          <div className="te-preview__card">{t('themes.previewCard')}</div>
        </div>
      </Card>
    );
  }
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation('settings');
  const id = `color-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="te-field">
      <label className="te-label" htmlFor={id}>{label}</label>
      <div className="te-color-row">
        <input type="color" aria-label={t('themes.colourPicker', { label })} value={/^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="te-color-swatch" />
        <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} className="te-color-hex" spellCheck={false} />
      </div>
      <div className="te-presets" role="group" aria-label={t('themes.colourPresets', { label })}>
        {PRESET_COLORS.map((c) => (
          <button key={c} type="button" title={c} aria-label={c} aria-pressed={value.toLowerCase() === c.toLowerCase()}
            onClick={() => onChange(c)} className="te-preset" style={{ background: c }} />
        ))}
      </div>
    </div>
  );
}


