import { useState, useEffect, useCallback } from 'react';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import { apiClient } from '../api/client';

interface AdminUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  persona: 'system' | 'tenant';
  status: 'active' | 'inactive';
  tenant_id: string;
  business_id: string;
  tenant_name: string | null;
  created_at: string;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
}

interface CreateUserForm {
  email: string;
  first_name: string;
  last_name: string;
  password: string;
  persona: 'system' | 'tenant';
  role: string;
  tenant_id: string;
}

const EMPTY_FORM: CreateUserForm = {
  email: '',
  first_name: '',
  last_name: '',
  password: '',
  persona: 'system',
  role: 'system_admin',
  tenant_id: '',
};

const PERSONA_ROLES: Record<string, { value: string; label: string }[]> = {
  system: [
    { value: 'system_admin', label: 'System Admin' },
    { value: 'system_support', label: 'System Support' },
  ],
  tenant: [
    { value: 'tenant_owner', label: 'Tenant Owner' },
    { value: 'tenant_manager', label: 'Tenant Manager' },
  ],
};

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  active: 'success',
  inactive: 'error',
};

function formatRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterPersona, setFilterPersona] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit modal
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState<{ first_name: string; last_name: string; email: string; role: string; status: string; password: string }>({
    first_name: '', last_name: '', email: '', role: '', status: '', password: '',
  });
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterPersona) params.set('persona', filterPersona);
      const res = await apiClient.get(`/v1/admin/users?${params}`);
      setUsers(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [filterPersona]);

  const fetchTenants = useCallback(async () => {
    try {
      const res = await apiClient.get('/v1/admin/tenants');
      setTenants(res.data.data);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);
  useEffect(() => { fetchTenants(); }, [fetchTenants]);

  // Filter by search
  const filteredUsers = users.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.email.toLowerCase().includes(q) ||
      u.first_name.toLowerCase().includes(q) ||
      u.last_name.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q) ||
      (u.tenant_name || '').toLowerCase().includes(q)
    );
  });

  // Create user
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const body: Record<string, string> = {
        email: createForm.email,
        first_name: createForm.first_name,
        last_name: createForm.last_name,
        password: createForm.password,
        persona: createForm.persona,
        role: createForm.role,
      };
      if (createForm.persona === 'tenant' && createForm.tenant_id) {
        body.tenant_id = createForm.tenant_id;
      }
      await apiClient.post('/v1/admin/users', body);
      setShowCreate(false);
      setCreateForm(EMPTY_FORM);
      fetchUsers();
    } catch (err: any) {
      setCreateError(err.response?.data?.error || 'Failed to create user');
    } finally {
      setCreating(false);
    }
  }

  // Open edit
  function openEdit(user: AdminUser) {
    setEditUser(user);
    setEditForm({
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      role: user.role,
      status: user.status,
      password: '',
    });
    setEditError(null);
  }

  // Save edit
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
      if (editForm.role !== editUser.role) body.role = editForm.role;
      if (editForm.status !== editUser.status) body.status = editForm.status;
      if (editForm.password) body.password = editForm.password;

      if (Object.keys(body).length === 0) {
        setEditUser(null);
        return;
      }
      await apiClient.put(`/v1/admin/users/${editUser.id}`, body);
      setEditUser(null);
      fetchUsers();
    } catch (err: any) {
      setEditError(err.response?.data?.error || 'Failed to update user');
    } finally {
      setSaving(false);
    }
  }

  // Deactivate user
  async function handleDeactivate(user: AdminUser) {
    if (!confirm(`Deactivate ${user.first_name} ${user.last_name}?`)) return;
    try {
      await apiClient.delete(`/v1/admin/users/${user.id}`);
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to deactivate user');
    }
  }

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (_: any, u: AdminUser) => `${u.first_name} ${u.last_name}`,
    },
    { key: 'email', header: 'Email' },
    {
      key: 'persona',
      header: 'Level',
      render: (_: any, u: AdminUser) => (
        <Badge variant={u.persona === 'system' ? 'info' : 'neutral'}>
          {u.persona === 'system' ? 'System' : 'Tenant'}
        </Badge>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (_: any, u: AdminUser) => formatRole(u.role),
    },
    {
      key: 'tenant_name',
      header: 'Tenant',
      render: (val: any) => val || '—',
    },
    {
      key: 'status',
      header: 'Status',
      render: (_: any, u: AdminUser) => (
        <Badge variant={STATUS_VARIANTS[u.status] || 'neutral'}>
          {u.status.charAt(0).toUpperCase() + u.status.slice(1)}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (_: any, u: AdminUser) => (
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button size="sm" variant="secondary" onClick={() => openEdit(u)}>Edit</Button>
          {u.status === 'active' && (
            <Button size="sm" variant="destructive" onClick={() => handleDeactivate(u)}>Deactivate</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>User Management</h1>
        <Button onClick={() => setShowCreate(true)}>Create User</Button>
      </div>

      <div style={styles.toolbar}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search users..." />
        <select
          style={styles.select}
          value={filterPersona}
          onChange={(e) => setFilterPersona(e.target.value)}
          aria-label="Filter by level"
        >
          <option value="">All Levels</option>
          <option value="system">System</option>
          <option value="tenant">Tenant</option>
        </select>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <Table
        columns={columns}
        data={filteredUsers}
        loading={loading}
        emptyMessage="No users found"
      />

      {/* Create Modal */}
      {showCreate && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <h2 style={styles.modalTitle}>Create User</h2>
            {createError && <div style={styles.error}>{createError}</div>}
            <form onSubmit={handleCreate}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Level *</label>
                <select
                  style={styles.input}
                  value={createForm.persona}
                  onChange={(e) => {
                    const persona = e.target.value as 'system' | 'tenant';
                    const defaultRole = PERSONA_ROLES[persona][0].value;
                    setCreateForm({ ...createForm, persona, role: defaultRole, tenant_id: '' });
                  }}
                >
                  <option value="system">System</option>
                  <option value="tenant">Tenant</option>
                </select>
              </div>

              {createForm.persona === 'tenant' && (
                <div style={styles.formGroup}>
                  <label style={styles.label}>Tenant *</label>
                  <select
                    style={styles.input}
                    value={createForm.tenant_id}
                    onChange={(e) => setCreateForm({ ...createForm, tenant_id: e.target.value })}
                    required
                  >
                    <option value="">Select tenant...</option>
                    {tenants.filter(t => t.slug !== 'daystream').map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div style={styles.formGroup}>
                <label style={styles.label}>Role *</label>
                <select
                  style={styles.input}
                  value={createForm.role}
                  onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                >
                  {PERSONA_ROLES[createForm.persona].map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>First Name *</label>
                  <input
                    style={styles.input}
                    type="text"
                    value={createForm.first_name}
                    onChange={(e) => setCreateForm({ ...createForm, first_name: e.target.value })}
                    required
                  />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Last Name *</label>
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
                <label style={styles.label}>Email *</label>
                <input
                  style={styles.input}
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  required
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Password *</label>
                <input
                  style={styles.input}
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  required
                  minLength={10}
                />
                <small style={styles.helper}>Minimum 10 characters</small>
              </div>

              <div style={styles.modalActions}>
                <Button variant="secondary" onClick={() => setShowCreate(false)} type="button">Cancel</Button>
                <Button type="submit" loading={creating}>Create User</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editUser && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <h2 style={styles.modalTitle}>Edit User</h2>
            <p style={styles.subtitle}>{editUser.email} ({editUser.persona})</p>
            {editError && <div style={styles.error}>{editError}</div>}
            <form onSubmit={handleSaveEdit}>
              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>First Name</label>
                  <input
                    style={styles.input}
                    type="text"
                    value={editForm.first_name}
                    onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                  />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Last Name</label>
                  <input
                    style={styles.input}
                    type="text"
                    value={editForm.last_name}
                    onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                  />
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Email</label>
                <input
                  style={styles.input}
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                />
              </div>

              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Role</label>
                  <select
                    style={styles.input}
                    value={editForm.role}
                    onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  >
                    {PERSONA_ROLES[editUser.persona].map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Status</label>
                  <select
                    style={styles.input}
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>New Password (leave blank to keep current)</label>
                <input
                  style={styles.input}
                  type="password"
                  value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  minLength={10}
                />
              </div>

              <div style={styles.modalActions}>
                <Button variant="secondary" onClick={() => setEditUser(null)} type="button">Cancel</Button>
                <Button type="submit" loading={saving}>Save Changes</Button>
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
    fontSize: '24px',
    fontWeight: 600,
    color: 'var(--color-text)',
    margin: 0,
  },
  toolbar: {
    display: 'flex',
    gap: '12px',
    marginBottom: '16px',
    alignItems: 'center',
  },
  select: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid var(--color-border, #333)',
    background: 'var(--color-surface, #242424)',
    color: 'var(--color-text)',
    fontSize: '14px',
  },
  error: {
    padding: '12px 16px',
    background: 'var(--color-error-bg, rgba(211, 47, 47, 0.1))',
    border: '1px solid var(--color-error, #D32F2F)',
    borderRadius: '8px',
    color: 'var(--color-error, #D32F2F)',
    marginBottom: '16px',
    fontSize: '14px',
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
    fontSize: '20px',
    fontWeight: 600,
    color: 'var(--color-text)',
    marginBottom: '16px',
    marginTop: 0,
  },
  subtitle: {
    fontSize: '14px',
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
    fontSize: '14px',
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
    fontSize: '16px',
    boxSizing: 'border-box' as const,
  },
  helper: {
    display: 'block',
    fontSize: '12px',
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
