import { useState } from 'react';
import { ThemeGallery } from './settings/ThemeGallery';

type SettingsTab = 'appearance';

export function TenantSettings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'appearance', label: 'Themes' },
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
      {activeTab === 'appearance' && <ThemeGallery persona="tenant" />}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-xl)' },
  title: { fontSize: 'var(--font-size-page-title)', fontWeight: 700, color: 'var(--color-text-title)', margin: '0 0 var(--space-lg) 0' },
  tabBar: { display: 'flex', gap: '4px', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--space-xl)' },
  tab: { padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid transparent', color: 'var(--color-text-secondary)', fontSize: '14px', fontWeight: 600, cursor: 'pointer' },
  tabActive: { color: 'var(--color-primary)', borderBottomColor: 'var(--color-primary)' },
};
