import { useState } from 'react';
import { Staff } from './Staff';
import { Resources } from './Resources';
import { Locations } from './Locations';

export function Business() {
  const [activeTab, setActiveTab] = useState<'staff' | 'resources' | 'locations'>('staff');

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Business</h1>
      </div>
      <div style={styles.tabBar}>
        <button onClick={() => setActiveTab('staff')} style={{ ...styles.tab, ...(activeTab === 'staff' ? styles.tabActive : {}) }}>Staff</button>
        <button onClick={() => setActiveTab('resources')} style={{ ...styles.tab, ...(activeTab === 'resources' ? styles.tabActive : {}) }}>Resources</button>
        <button onClick={() => setActiveTab('locations')} style={{ ...styles.tab, ...(activeTab === 'locations' ? styles.tabActive : {}) }}>Locations</button>
      </div>
      {activeTab === 'staff' && <Staff />}
      {activeTab === 'resources' && <Resources />}
      {activeTab === 'locations' && <Locations />}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  tabBar: { display: 'flex', gap: '0', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--space-lg)' },
  tab: { background: 'none', border: 'none', borderBottom: '2px solid transparent', padding: '10px 20px', fontSize: '14px', fontWeight: 500, color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
  tabActive: { color: 'var(--color-primary)', borderBottomColor: 'var(--color-primary)' },
};
