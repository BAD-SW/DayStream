import { FONT_STACKS } from '../../themes/ThemeProvider';
import { meetsWcagAA } from '../../utils/contrast';

const CURATED_FONTS = ['System Default', 'Inter', 'Merriweather', 'Source Sans 3'];
const FONT_SIZES = [14, 15, 16, 17] as const;

export interface ThemeValues {
  primaryColor?: string | null;
  secondaryColor?: string | null;
  fontFamily?: string | null;
  baseFontSize?: number | null;
}

export type ThemeField = keyof ThemeValues;

interface ThemeEditorFieldsProps {
  values: ThemeValues;
  onChange: (field: ThemeField, value: string | number | null) => void;
  /** Resolved values from the parent level (tenant for a business, platform for a tenant).
   * When provided, a field left null shows what it would inherit + a "Customize" control;
   * when a field has a value, a "Reset to inherited" control appears instead. Omit at the
   * top of the cascade (system/platform level), where there's nothing to inherit from. */
  inherited?: ThemeValues;
  inheritedLabel?: string;
}

interface ResolvedTheme {
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  baseFontSize: number;
}

const DEFAULTS: ResolvedTheme = {
  primaryColor: '#C9A96E',
  secondaryColor: '#4A7FB5',
  fontFamily: 'System Default',
  baseFontSize: 15,
};

/**
 * Shared Typography + Colors + live-preview editor, reused by the system Default Theme
 * tab, the tenant Appearance section, and the business Appearance panel — the three
 * levels differ only in how they fetch/save these same fields and what (if anything)
 * sits above them in the inheritance chain.
 */
export function ThemeEditorFields({ values, onChange, inherited, inheritedLabel }: ThemeEditorFieldsProps) {
  const resolved: ResolvedTheme = {
    primaryColor: values.primaryColor ?? inherited?.primaryColor ?? DEFAULTS.primaryColor,
    secondaryColor: values.secondaryColor ?? inherited?.secondaryColor ?? DEFAULTS.secondaryColor,
    fontFamily: values.fontFamily ?? inherited?.fontFamily ?? DEFAULTS.fontFamily,
    baseFontSize: values.baseFontSize ?? inherited?.baseFontSize ?? DEFAULTS.baseFontSize,
  };
  const fontStack = resolved.fontFamily !== 'System Default' ? FONT_STACKS[resolved.fontFamily] : 'var(--font-family)';
  const primaryContrast = meetsWcagAA('#FFFFFF', resolved.primaryColor);
  const secondaryContrast = meetsWcagAA('#FFFFFF', resolved.secondaryColor);

  function InheritToggle({ field }: { field: ThemeField }) {
    if (!inherited) return null;
    const isCustomized = values[field] !== null && values[field] !== undefined;
    if (isCustomized) {
      return (
        <button type="button" style={styles.inheritLink} onClick={() => onChange(field, null)}>
          Reset to inherited
        </button>
      );
    }
    return (
      <button type="button" style={styles.inheritLink} onClick={() => onChange(field, resolved[field] as any)}>
        Customize (inherited from {inheritedLabel})
      </button>
    );
  }

  return (
    <div style={styles.layout}>
      <div>
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Typography</h3>
          <div style={{ marginBottom: 'var(--space-lg)' }}>
            <div style={styles.labelRow}>
              <label style={styles.label}>Font family</label>
              <InheritToggle field="fontFamily" />
            </div>
            <select
              value={resolved.fontFamily}
              onChange={(e) => onChange('fontFamily', e.target.value)}
              disabled={!!inherited && values.fontFamily === null}
              style={styles.select}
            >
              {CURATED_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <div style={styles.labelRow}>
              <label style={styles.label}>Base font size</label>
              <InheritToggle field="baseFontSize" />
            </div>
            <div style={styles.segmented}>
              {FONT_SIZES.map((size) => (
                <button key={size} type="button"
                  disabled={!!inherited && values.baseFontSize === null}
                  style={{ ...styles.segmentBtn, ...(resolved.baseFontSize === size ? styles.segmentBtnActive : {}) }}
                  onClick={() => onChange('baseFontSize', size)}
                >{size}</button>
              ))}
            </div>
          </div>
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Colors</h3>
          <div style={{ marginBottom: 'var(--space-lg)' }}>
            <div style={styles.labelRow}>
              <label style={styles.label}>Primary color</label>
              <InheritToggle field="primaryColor" />
            </div>
            <div style={styles.colorRow}>
              <input type="color" value={resolved.primaryColor} disabled={!!inherited && values.primaryColor === null}
                onChange={(e) => onChange('primaryColor', e.target.value)} style={styles.colorSwatch} />
              <input type="text" value={resolved.primaryColor} disabled={!!inherited && values.primaryColor === null}
                onChange={(e) => onChange('primaryColor', e.target.value)} style={styles.colorHex} />
            </div>
            <div style={{ ...styles.contrastNote, color: primaryContrast ? 'var(--color-success)' : 'var(--color-warning)' }}>
              {primaryContrast ? '✓ Passes contrast with white text' : '⚠ Low contrast with white text — consider a darker shade'}
            </div>
          </div>
          <div>
            <div style={styles.labelRow}>
              <label style={styles.label}>Secondary color</label>
              <InheritToggle field="secondaryColor" />
            </div>
            <div style={styles.colorRow}>
              <input type="color" value={resolved.secondaryColor} disabled={!!inherited && values.secondaryColor === null}
                onChange={(e) => onChange('secondaryColor', e.target.value)} style={styles.colorSwatch} />
              <input type="text" value={resolved.secondaryColor} disabled={!!inherited && values.secondaryColor === null}
                onChange={(e) => onChange('secondaryColor', e.target.value)} style={styles.colorHex} />
            </div>
            <div style={{ ...styles.contrastNote, color: secondaryContrast ? 'var(--color-success)' : 'var(--color-warning)' }}>
              {secondaryContrast ? '✓ Passes contrast with white text' : '⚠ Low contrast with white text — consider a darker shade'}
            </div>
          </div>
        </div>
      </div>

      <div style={styles.previewPanel}>
        <div style={styles.previewLabel}>LIVE PREVIEW</div>
        <p style={styles.previewNote}>Updates as you edit — not saved until you click Save.</p>
        <div style={styles.previewFrame}>
          <div style={{ fontFamily: fontStack, fontSize: `${resolved.baseFontSize + 5}px`, fontWeight: 700, color: 'var(--color-text)', marginBottom: '12px' }}>
            Book an appointment
          </div>
          <div style={{ fontFamily: fontStack, fontSize: `${resolved.baseFontSize}px`, color: 'var(--color-text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
            This is how headings and body text will look with the selected font and size.
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{ background: resolved.primaryColor, color: '#fff', padding: '10px 18px', borderRadius: 'var(--radius-md)', fontSize: '14px', fontWeight: 600 }}>Primary Action</div>
            <span style={{ background: `${resolved.secondaryColor}22`, color: resolved.secondaryColor, padding: '5px 13px', borderRadius: 'var(--radius-full)', fontSize: '12.5px', fontWeight: 700 }}>Sample Pill</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  layout: { display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 'var(--space-xl)', alignItems: 'start' },
  card: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)', marginBottom: 'var(--space-lg)' },
  cardTitle: { fontSize: 'var(--font-size-section-header, 1.0625rem)', fontWeight: 700 as any, color: 'var(--color-text)', margin: '0 0 var(--space-md) 0' },
  labelRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: '13.5px', fontWeight: 600 as any, color: 'var(--color-text-secondary)' },
  inheritLink: { background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '12px', fontWeight: 600 as any, cursor: 'pointer', padding: 0 },
  select: { width: '100%', marginTop: '7px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: '15px' },
  segmented: { display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', width: 'fit-content', marginTop: '7px' },
  segmentBtn: { border: 'none', borderRight: '1px solid var(--color-border)', background: 'var(--color-surface)', padding: '9px 16px', fontSize: '14px', fontWeight: 600, color: 'var(--color-text-secondary)', cursor: 'pointer' },
  segmentBtnActive: { background: 'var(--color-primary)', color: 'var(--color-primary-contrast)' },
  colorRow: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '7px' },
  colorSwatch: { width: '38px', height: '38px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: 0, cursor: 'pointer' },
  colorHex: { fontSize: '14px', padding: '9px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', width: '110px', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-family)' },
  contrastNote: { fontSize: '12.5px', marginTop: '8px' },
  previewPanel: { position: 'sticky', top: '24px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' },
  previewLabel: { fontSize: '12px', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-secondary)', padding: '14px 18px 0' },
  previewNote: { fontSize: '12px', color: 'var(--color-text-secondary)', padding: '0 18px 14px', margin: 0 },
  previewFrame: { borderTop: '1px solid var(--color-border)', padding: 'var(--space-lg)' },
};
