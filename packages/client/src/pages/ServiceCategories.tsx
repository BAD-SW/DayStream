import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import { Badge } from '../design-system/components/data/Badge';
import * as servicesApi from '../api/services';
import type { ServiceCategory } from '../api/services';
import { useTranslation } from 'react-i18next';

export function ServiceCategories() {
  const { t } = useTranslation('offerings');
  const navigate = useNavigate();
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('');
  const [newParent, setNewParent] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editIcon, setEditIcon] = useState('');

  const businessId = localStorage.getItem('business_id') || '';

  const fetchCategories = async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const cats = await servicesApi.getCategories(businessId);
      setCategories(cats);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchCategories(); }, [businessId]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await servicesApi.createCategory({
      business_id: businessId,
      name: newName,
      icon: newIcon || undefined,
      parent_id: newParent || undefined,
    });
    setNewName('');
    setNewIcon('');
    setNewParent('');
    setShowAdd(false);
    fetchCategories();
  };

  const handleSaveEdit = async () => {
    if (!editId) return;
    await servicesApi.updateCategory(editId, businessId, { name: editName, icon: editIcon });
    setEditId(null);
    fetchCategories();
  };

  const handleDelete = async (id: string) => {
    await servicesApi.deleteCategory(id, businessId);
    fetchCategories();
  };

  const parentCategories = categories.filter((c) => !c.parent_id);
  const childCategories = (parentId: string) => categories.filter((c) => c.parent_id === parentId);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button style={styles.back} onClick={() => navigate('/services')}>{t('categories.backToServices')}</button>
        <h1 style={styles.title}>{t('categories.title')}</h1>
        <Button onClick={() => setShowAdd(!showAdd)}>{showAdd ? t('common:cancel') : t('categories.add')}</Button>
      </div>

      {showAdd && (
        <div style={styles.addForm}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('categories.namePlaceholder')} style={styles.input} />
          <input value={newIcon} onChange={(e) => setNewIcon(e.target.value)} placeholder={t('categories.iconOptional')} style={styles.input} />
          <select value={newParent} onChange={(e) => setNewParent(e.target.value)} style={styles.input}>
            <option value="">{t('categories.noParent')}</option>
            {parentCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <Button onClick={handleCreate}>{t('common:create')}</Button>
        </div>
      )}

      {loading && <p style={styles.empty}>{t('common:loading')}</p>}

      <div style={styles.list}>
        {parentCategories.map((cat) => (
          <div key={cat.id}>
            <div style={styles.categoryRow}>
              {editId === cat.id ? (
                <div style={styles.editRow}>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} style={styles.input} />
                  <input value={editIcon} onChange={(e) => setEditIcon(e.target.value)} placeholder={t('categories.iconPlaceholder')} style={styles.inputSmall} />
                  <Button onClick={handleSaveEdit}>{t('common:save')}</Button>
                  <button style={styles.cancelBtn} onClick={() => setEditId(null)}>{t('common:cancel')}</button>
                </div>
              ) : (
                <>
                  <div style={styles.catInfo}>
                    {cat.icon && <span style={styles.icon}>{cat.icon}</span>}
                    <strong>{cat.name}</strong>
                    <Badge variant="neutral">{t('categories.serviceCount', { count: Number(cat.service_count) })}</Badge>
                  </div>
                  <div style={styles.catActions}>
                    <button style={styles.actionBtn} onClick={() => { setEditId(cat.id); setEditName(cat.name); setEditIcon(cat.icon || ''); }}>{t('common:edit')}</button>
                    <button style={styles.actionBtn} onClick={() => handleDelete(cat.id)}>{t('shared.archive')}</button>
                  </div>
                </>
              )}
            </div>
            {/* Child categories */}
            {childCategories(cat.id).map((child) => (
              <div key={child.id} style={styles.childRow}>
                <div style={styles.catInfo}>
                  <span style={styles.indent}>↳</span>
                  {child.icon && <span style={styles.icon}>{child.icon}</span>}
                  <span>{child.name}</span>
                  <Badge variant="neutral">{t('categories.serviceCount', { count: Number(child.service_count) })}</Badge>
                </div>
                <button style={styles.actionBtn} onClick={() => handleDelete(child.id)}>{t('shared.archive')}</button>
              </div>
            ))}
          </div>
        ))}
        {!loading && categories.length === 0 && <p style={styles.empty}>{t('categories.empty')}</p>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '800px', margin: '0 auto' },
  header: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' },
  back: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)', padding: 0, fontFamily: 'var(--font-family)', alignSelf: 'flex-start' },
  title: { fontSize: 'var(--page-title-size)', fontWeight: 'var(--page-title-weight)' as any, color: 'var(--color-text)', margin: 0 },
  addForm: { display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)', flexWrap: 'wrap' as const, alignItems: 'center' },
  list: { display: 'flex', flexDirection: 'column' as const },
  categoryRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-md) 0', borderBottom: '1px solid var(--color-border)' },
  childRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-sm) 0', paddingLeft: 'var(--space-lg)', borderBottom: '1px solid var(--color-border)' },
  catInfo: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: 'var(--font-size-sm)' },
  catActions: { display: 'flex', gap: 'var(--space-xs)' },
  icon: { fontSize: 'var(--font-size-lg)' },
  indent: { color: 'var(--color-text-disabled)' },
  editRow: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' },
  input: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)' },
  inputSmall: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px', color: 'var(--color-text)', fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-sm)', width: '80px' },
  actionBtn: { background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--button-radius)', padding: '4px 10px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-family)', minHeight: 'var(--button-height-sm)' },
  cancelBtn: { background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-xs)', fontFamily: 'var(--font-family)' },
  empty: { color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', textAlign: 'center', padding: 'var(--space-xl)' },
};
