/**
 * Token documentation stories — displays all design tokens visually.
 */

export default {
  title: 'Tokens/Overview',
};

const colors = [
  { name: '--color-primary', label: 'Primary' },
  { name: '--color-primary-hover', label: 'Primary Hover' },
  { name: '--color-background', label: 'Background' },
  { name: '--color-surface', label: 'Surface' },
  { name: '--color-text', label: 'Text' },
  { name: '--color-text-secondary', label: 'Text Secondary' },
  { name: '--color-border', label: 'Border' },
  { name: '--color-success', label: 'Success' },
  { name: '--color-warning', label: 'Warning' },
  { name: '--color-error', label: 'Error' },
  { name: '--color-info', label: 'Info' },
];

export const Colors = () => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
    {colors.map((c) => (
      <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: `var(${c.name})`, border: '1px solid var(--color-border)' }} />
        <div>
          <div style={{ fontSize: '14px', color: 'var(--color-text)' }}>{c.label}</div>
          <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{c.name}</div>
        </div>
      </div>
    ))}
  </div>
);

const spacings = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'];

export const Spacing = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
    {spacings.map((s) => (
      <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <span style={{ width: '40px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>--space-{s}</span>
        <div style={{ height: '16px', width: `var(--space-${s})`, background: 'var(--color-primary)', borderRadius: '2px' }} />
      </div>
    ))}
  </div>
);

const fontSizes = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl'];

export const Typography = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
    {fontSizes.map((s) => (
      <div key={s} style={{ fontSize: `var(--font-size-${s})`, color: 'var(--color-text)' }}>
        --font-size-{s}: The quick brown fox
      </div>
    ))}
  </div>
);
