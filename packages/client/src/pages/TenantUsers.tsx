import { askConfirm, showMessage } from '../design-system/components/feedback/dialogs';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import { apiClient } from '../api/client';
import { formatDate } from '../utils/format';

interface TenantUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  persona: string;
  status: 'active' | 'inactive';
  business_id: string;
  created_at: string;
}

interface CreateForm {
  email: string;
  first_name: string;
  last_name: string;
  password: string;
}

const EMPTY_FORM: CreateForm = {
  email: '',
  first_name: '',
  last_name: '',
  password: '',
};

const STATUS_VARIANTS: Record<string, 'success' | 'error' | 'neutral'> = {
  active: 'success',
  inactive: 'error',
};

export function TenantUsers() {
  const { t } = useTranslation('tenant');
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit modal
  const [editUser, setEditUser] = useState<TenantUser | null>(null);
  const [editForm, setEditForm] = useState<{ first_name: string; last_name: string; email: string; status: string; password: string }>({
    first_name: '', last_name: '', email: '', status: '', password: '',
  });
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/v1/admin/tenant-users');
      setUsers(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || t('users.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const filteredUsers = users.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.email.toLowerCase().includes(q) ||
      u.first_name.toLowerCase().includes(q) ||
      u.last_name.toLowerCase().includes(q)
    );
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await apiClient.post('/v1/admin/tenant-users', createForm);
      setShowCreate(false);
      setCreateForm(EMPTY_FORM);
      fetchUsers();
    } catch (err: any) {
      setCreateError(err.response?.data?.error || t('users.createFailed'));
    } finally {
      setCreating(false);
    }
  }

  function openEdit(user: TenantUser) {
    setEditUser(user);
    setEditForm({
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      status: user.status,
      password: '',
    });
    setEditError(null);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    setSaving(true);
    setEditError(null);
    try {
      const body: Record<string, string> = {};
      if (editForm.first_name !== editUser.first_name) body.first_name = editForm.first_name;
      if (editForm.last_name !== editUser.last_name) body.last_name = editForm.last_name;
      if (editForm.email !== editUser.email) body.email = editForm.email;
      if (editForm.status !== editUser.status) body.status = editForm.status;
      if (editForm.password) body.password = editForm.password;

      if (Object.keys(body).length === 0) { setEditUser(null); return; }
      await apiClient.put(`/v1/admin/tenant-users/${editUser.id}`, body);
      setEditUser(null);
      fetchUsers();
    } catch (err: any) {
      setEditError(err.response?.data?.error || t('users.updateFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(user: TenantUser) {
    if (!(await askConfirm({ message: t('users.deactivateConfirm', { name: `${user.first_name} ${user.last_name}` }), confirmLabel: t('common:action.deactivate'), destructive: true }))) return;
    try {
      await apiClient.delete(`/v1/admin/tenant-users/${user.id}`);
      fetchUsers();
    } catch (err: any) {
      void showMessage({ message: err.response?.data?.error || t('users.deactivateFailed'), tone: 'error' });
    }
  }

  const columns = [
    {
      key: 'name',
      header: t('users.name'),
      render: (_: any, u: TenantUser) => `${u.first_name} ${u.last_name}`,
    },
    { key: 'email', header: t('users.email') },
    {
      key: 'status',
      header: t('users.status'),
      render: (_: any, u: TenantUser) => (
        <Badge variant={STATUS_VARIANTS[u.status] || 'neutral'}>
          {t(`users.status_${u.status}`, { defaultValue: u.status })}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: t('users.created'),
      render: (val: any) => val ? formatDate(val) : '—',
    },
    {
      key: 'actions',
      header: '',
      render: (_: any, u: TenantUser) => (
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button size="sm" variant="secondary" onClick={() => openEdit(u)}>{t('common:edit')}</Button>
          {u.status === 'active' && (
            <Button size="sm" variant="destructive" onClick={() => handleDeactivate(u)}>{t('users.deactivate')}</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>{t('users.title')}</h1>
        <Button onClick={() => setShowCreate(true)}>{t('users.create')}</Button>
      </div>

      <div style={styles.toolbar}>
        <SearchInput value={search} onChange={setSearch} placeholder={t('users.search')} />
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <Table
        columns={columns}
        data={filteredUsers}
        loading={loading}
        emptyMessage={t('users.empty')}
      />

      {/* Create Modal */}
      {showCreate && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <h2 style={styles.modalTitle}>{t('users.create')}</h2>
            {createError && <div style={styles.error}>{createError}</div>}
            <form onSubmit={handleCreate}>
              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>{t('users.firstNameRequired')}</label>
                  <input
                    style={styles.input}
                    type="text"
                    value={createForm.first_name}
                    onChange={(e) => setCreateForm({ ...createForm, first_name: e.target.value })}
                    required
                  />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>{t('users.lastNameRequired')}</label>
                  <input
                    style={styles.input}
                    type="text"
                    value={createForm.last_name}
                    onChange={(e) => setCreateForm({ ...createForm, last_name: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>{t('users.emailRequired')}</label>
                <input
                  style={styles.input}
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  required
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>{t('users.passwordRequired')}</label>
                <input
                  style={styles.input}
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  required
                  minLength={10}
                />
                <small style={styles.helper}>{t('users.passwordHelp')}</small>
              </div>

              <div style={styles.modalActions}>
                <Button variant="secondary" onClick={() => setShowCreate(false)} type="button">{t('common:cancel')}</Button>
                <Button type="submit" loading={creating}>{t('users.create')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editUser && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <h2 style={styles.modalTitle}>{t('users.edit')}</h2>
            <p style={styles.subtitle}>{editUser.email}</p>
            {editError && <div style={styles.error}>{editError}</div>}
            <form onSubmit={handleSaveEdit}>
              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>{t('users.firstName')}</label>
                  <input
                    style={styles.input}
                    type="text"
                    value={editForm.first_name}
                    onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                  />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>{t('users.lastName')}</label>
                  <input
                    style={styles.input}
                    type="text"
                    value={editForm.last_name}
                    onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                  />
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>{t('users.email')}</label>
                <input
                  style={styles.input}
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>{t('users.status')}</label>
                <select
                  style={styles.input}
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                >
                  <option value="active">{t('users.status_active')}</option>
                  <option value="inactive">{t('users.status_inactive')}</option>
                </select>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>{t('users.newPassword')}</label>
                <input
                  style={styles.input}
                  type="password"
                  value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  minLength={10}
                />
              </div>

              <div style={styles.modalActions}>
                <Button variant="secondary" onClick={() => setEditUser(null)} type="button">{t('common:cancel')}</Button>
                <Button type="submit" loading={saving}>{t('users.saveChanges')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '24px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  },
  title: {
    fontSize: 'var(--page-title-size)',
    fontWeight: 'var(--page-title-weight)' as any,
    color: 'var(--color-text)',
    margin: 0,
  },
  toolbar: {
    display: 'flex',
    gap: '12px',
    marginBottom: '16px',
    alignItems: 'center',
  },
  error: {
    padding: '12px 16px',
    background: 'var(--color-error-bg, rgba(211, 47, 47, 0.1))',
    border: '1px solid var(--color-error, #D32F2F)',
    borderRadius: '8px',
    color: 'var(--color-error, #D32F2F)',
    marginBottom: '16px',
    fontSize: 'var(--font-size-base)',
  },
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: 'var(--color-surface-modal, #FFFFFF)',
    borderRadius: '12px',
    padding: '32px',
    width: '100%',
    maxWidth: '500px',
    maxHeight: '90vh',
    overflow: 'auto',
  },
  modalTitle: {
    fontSize: 'var(--font-size-xl)',
    fontWeight: 600,
    color: 'var(--color-text)',
    marginBottom: '16px',
    marginTop: 0,
  },
  subtitle: {
    fontSize: 'var(--font-size-base)',
    color: 'var(--color-text-secondary, #B0B0B0)',
    marginBottom: '16px',
    marginTop: 0,
  },
  formGroup: {
    marginBottom: '16px',
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
  },
  label: {
    display: 'block',
    fontSize: 'var(--font-size-base)',
    fontWeight: 500,
    color: 'var(--color-text)',
    marginBottom: '4px',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid var(--color-border, #333)',
    background: 'var(--color-background, #1A1A1A)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-base)',
    boxSizing: 'border-box' as const,
  },
  helper: {
    display: 'block',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text-secondary, #B0B0B0)',
    marginTop: '4px',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '24px',
  },
};
