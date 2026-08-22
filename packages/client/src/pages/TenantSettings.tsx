import { useState, useEffect } from 'react';
import { Button } from '../design-system/components/actions/Button';
import { ThemeEditorFields, ThemeValues, ThemeField } from '../design-system/components/forms/ThemeEditorFields';
import { apiClient } from '../api/client';

type SettingsTab = 'appearance';

export function TenantSettings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'appearance', label: 'Appearance' },
  ];

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Settings</h1>
      <div style={styles.tabBar}>
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{ ...styles.tab, ...(activeTab === tab.key ? styles.tabActive : {}) }}>
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === 'appearance' && <TenantAppearanceSettings />}
    </div>
  );
}

const CONFIG_KEY_MAP: Record<ThemeField, string> = {
  primaryColor: 'brand.primary_color',
  secondaryColor: 'brand.secondary_color',
  fontFamily: 'brand.font_family',
  baseFontSize: 'brand.base_font_size',
};

function TenantAppearanceSettings() {
  const [values, setValues] = useState<ThemeValues>({});
  const [inherited, setInherited] = useState<ThemeValues>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get('/v1/admin/config')
      .then((res) => {
        const config = res.data.data || {};
        const overridden: string[] = res.data.meta?.overridden || [];
        const nextValues: ThemeValues = {};
        const nextInherited: ThemeValues = {};
        (Object.keys(CONFIG_KEY_MAP) as ThemeField[]).forEach((field) => {
          const key = CONFIG_KEY_MAP[field];
          const raw = config[key];
          const isCustomized = overridden.includes(key);
          const parsed = field === 'baseFontSize' && raw != null ? Number(raw) : raw;
          nextValues[field] = isCustomized ? parsed : null;
          nextInherited[field] = parsed ?? null;
        });
        setValues(nextValues);
        setInherited(nextInherited);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function handleChange(field: ThemeField, value: string | number | null) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  const handleSave = async () => {
    setSaving(true); setMessage(null);
    try {
      await Promise.all((Object.keys(CONFIG_KEY_MAP) as ThemeField[]).map((field) => {
        const key = CONFIG_KEY_MAP[field];
        const value = values[field];
        return value !== null && value !== undefined
          ? apiClient.put(`/v1/admin/config/${key}`, { value })
          : apiClient.delete(`/v1/admin/config/${key}`);
      }));
      setMessage('Appearance saved. Businesses under this tenant that haven’t customized these fields will pick it up immediately.');
    } catch {
      setMessage('Failed to save appearance settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>Loading...</p>;

  return (
    <div>
      {message && <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)', marginBottom: 'var(--space-md)' }}>{message}</p>}
      <ThemeEditorFields values={values} onChange={handleChange} inherited={inherited} inheritedLabel="platform default" />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-lg)' }}>
        <Button onClick={handleSave} loading={saving}>Save Appearance</Button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '900px', margin: '0 auto' },
  title: { fontSize: 'var(--font-size-page-title, var(--font-size-2xl))', fontWeight: 700 as any, color: 'var(--color-text)', marginBottom: 'var(--space-lg)' },
  tabBar: { display: 'flex', gap: 0, borderBottom: '1px solid var(--color-border)', marginBottom: '24px' },
  tab: {
    background: 'none', border: 'none', outline: 'none', borderBottom: '3px solid transparent',
    padding: '10px 20px', fontSize: '14px', fontWeight: 500, color: 'var(--color-text-secondary)',
    cursor: 'pointer', fontFamily: 'var(--font-family)', marginBottom: '-1px',
  },
  tabActive: { color: 'var(--color-primary)', fontWeight: 600, borderBottomColor: 'var(--color-primary)' },
};
