import { useState, useEffect, useCallback } from 'react';
import { Table } from '../design-system/components/data/Table';
import { Badge } from '../design-system/components/data/Badge';
import { Button } from '../design-system/components/actions/Button';
import { SearchInput } from '../design-system/components/actions/SearchInput';
import { apiClient } from '../api/client';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'archived';
  default_language: string;
  currency: string;
  timezone: string;
  created_at: string;
  updated_at: string;
  owner?: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
  } | null;
}

interface CreateTenantForm {
  name: string;
  slug: string;
  owner_email: string;
  owner_first_name: string;
  owner_last_name: string;
  owner_password: string;
  default_language: string;
  currency: string;
  timezone: string;
}

interface EditTenantForm {
  name: string;
  slug: string;
  default_language: string;
  currency: string;
  timezone: string;
  owner_email: string;
  owner_first_name: string;
  owner_last_name: string;
}

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success',
  suspended: 'warning',
  archived: 'error',
};

function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

const EMPTY_FORM: CreateTenantForm = {
  name: '',
  slug: '',
  owner_email: '',
  owner_first_name: '',
  owner_last_name: '',
  owner_password: '',
  default_language: 'en',
  currency: 'EUR',
  timezone: 'UTC',
};

export function Tenants() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Create modal state
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateTenantForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Detail panel state
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditTenantForm>({ name: '', default_language: '', currency: '', timezone: '' });
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchTenants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/v1/admin/tenants');
      setTenants(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load tenants');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  // Filter tenants by search
  const filteredTenants = tenants.filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      t.slug.toLowerCase().includes(q) ||
      t.status.toLowerCase().includes(q)
    );
  });

  // Create tenant
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const body: Record<string, string> = {
        name: createForm.name,
        owner_email: createForm.owner_email,
        owner_first_name: createForm.owner_first_name,
        owner_last_name: createForm.owner_last_name,
        owner_password: createForm.owner_password,
        default_language: createForm.default_language,
        currency: createForm.currency,
        timezone: createForm.timezone,
      };
      if (createForm.slug.trim()) {
        body.slug = createForm.slug;
      }
      await apiClient.post('/v1/admin/tenants', body);
      setShowCreate(false);
      setCreateForm(EMPTY_FORM);
      fetchTenants();
    } catch (err: any) {
      setCreateError(err.response?.data?.message || 'Failed to create tenant');
    } finally {
      setCreating(false);
    }
  }

  // Suspend tenant
  async function handleSuspend(tenant: Tenant) {
    setActionLoading(true);
    try {
      await apiClient.put(`/v1/admin/tenants/${tenant.id}/suspend`);
      await fetchTenants();
      setSelectedTenant((prev) => prev ? { ...prev, status: 'suspended' } : null);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to suspend tenant');
    } finally {
      setActionLoading(false);
    }
  }

  // Activate tenant
  async function handleActivate(tenant: Tenant) {
    setActionLoading(true);
    try {
      await apiClient.put(`/v1/admin/tenants/${tenant.id}/activate`);
      await fetchTenants();
      setSelectedTenant((prev) => prev ? { ...prev, status: 'active' } : null);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to activate tenant');
    } finally {
      setActionLoading(false);
    }
  }

  // Start editing
  function startEditing(tenant: Tenant) {
    setEditForm({
      name: tenant.name,
      slug: tenant.slug,
      default_language: tenant.default_language,
      currency: tenant.currency,
      timezone: tenant.timezone,
      owner_email: tenant.owner?.email || '',
      owner_first_name: tenant.owner?.first_name || '',
      owner_last_name: tenant.owner?.last_name || '',
    });
    setEditError(null);
    setEditing(true);
  }

  // Save edit
  async function handleSaveEdit() {
    if (!selectedTenant) return;
    setSaving(true);
    setEditError(null);
    try {
      const body: Record<string, string> = {};
      // Only send fields that changed
      if (editForm.name !== selectedTenant.name) body.name = editForm.name;
      if (editForm.slug !== selectedTenant.slug) body.slug = editForm.slug;
      if (editForm.default_language !== selectedTenant.default_language) body.default_language = editForm.default_language;
      if (editForm.currency !== selectedTenant.currency) body.currency = editForm.currency;
      if (editForm.timezone !== selectedTenant.timezone) body.timezone = editForm.timezone;
      if (editForm.owner_email !== (selectedTenant.owner?.email || '')) body.owner_email = editForm.owner_email;
      if (editForm.owner_first_name !== (selectedTenant.owner?.first_name || '')) body.owner_first_name = editForm.owner_first_name;
      if (editForm.owner_last_name !== (selectedTenant.owner?.last_name || '')) body.owner_last_name = editForm.owner_last_name;

      if (Object.keys(body).length === 0) {
        setEditing(false);
        return;
      }

      const res = await apiClient.put(`/v1/admin/tenants/${selectedTenant.id}`, body);
      const updated = res.data.data;
      setSelectedTenant(updated);
      setEditing(false);
      fetchTenants();
    } catch (err: any) {
      setEditError(err.response?.data?.message || 'Failed to update tenant');
    } finally {
      setSaving(false);
    }
  }

  // Close detail panel
  function closeDetail() {
    setSelectedTenant(null);
    setEditing(false);
    setEditError(null);
  }

  // Open detail panel with full data (including owner)
  async function openTenantDetail(tenant: Tenant) {
    setSelectedTenant(tenant);
    setEditing(false);
    setEditError(null);
    try {
      const res = await apiClient.get(`/v1/admin/tenants/${tenant.id}`);
      setSelectedTenant(res.data.data);
    } catch {
      // Still show basic data if detail fetch fails
    }
  }

  const columns = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'slug', header: 'URL Alias', sortable: true },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (val: string) => (
        <Badge variant={STATUS_VARIANTS[val] || 'neutral'}>{formatStatus(val)}</Badge>
      ),
    },
    { key: 'currency', header: 'Currency', sortable: true },
    { key: 'default_language', header: 'Language', sortable: true },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (val: string) => new Date(val).toLocaleDateString(),
    },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Tenants</h1>
        <Button onClick={() => setShowCreate(true)}>Create Tenant</Button>
      </div>

      {/* Search */}
      <div style={styles.toolbar}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search tenants..."
        />
      </div>

      {/* Error state */}
      {error && (
        <div style={styles.errorBanner}>
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={fetchTenants}>Retry</Button>
        </div>
      )}

      {/* Table */}
      <Table
        columns={columns}
        data={filteredTenants}
        loading={loading}
        onRowClick={(row) => openTenantDetail(row)}
        emptyMessage="No tenants found"
        clientSort
        mobileCardMode
      />

      {/* Detail Panel */}
      {selectedTenant && (
        <div style={styles.overlay} onClick={closeDetail}>
          <div style={styles.detailPanel} onClick={(e) => e.stopPropagation()}>
            <div style={styles.detailHeader}>
              <h2 style={styles.detailTitle}>{editing ? 'Edit Tenant' : selectedTenant.name}</h2>
              <button
                style={styles.closeBtn}
                onClick={closeDetail}
                aria-label="Close detail panel"
              >
                &times;
              </button>
            </div>

            {editError && <div style={styles.formError}>{editError}</div>}

            {editing ? (
              /* Edit Mode */
              <div style={styles.form}>
                <div style={styles.formDivider}>Tenant Details</div>

                <div style={styles.formGroup}>
                  <label style={styles.label} htmlFor="edit-name">Tenant Name</label>
                  <input
                    id="edit-name"
                    style={styles.input}
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    required
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label} htmlFor="edit-slug">URL Alias</label>
                  <input
                    id="edit-slug"
                    style={styles.input}
                    type="text"
                    value={editForm.slug}
                    onChange={(e) => setEditForm({ ...editForm, slug: e.target.value })}
                    pattern="^[a-z0-9-]+$"
                  />
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Lowercase letters, numbers, and hyphens only</span>
                </div>

                <div style={styles.formRow}>
                  <div style={styles.formGroup}>
                    <label style={styles.label} htmlFor="edit-language">Language</label>
                    <select
                      id="edit-language"
                      style={styles.input}
                      value={editForm.default_language}
                      onChange={(e) => setEditForm({ ...editForm, default_language: e.target.value })}
                    >
                      <option value="en">English</option>
                      <option value="es">Spanish</option>
                    </select>
                  </div>
                  <div style={styles.formGroup}>
                    <label style={styles.label} htmlFor="edit-currency">Currency</label>
                    <input
                      id="edit-currency"
                      style={styles.input}
                      type="text"
                      value={editForm.currency}
                      onChange={(e) => setEditForm({ ...editForm, currency: e.target.value.toUpperCase() })}
                      maxLength={3}
                    />
                  </div>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label} htmlFor="edit-timezone">Timezone</label>
                  <input
                    id="edit-timezone"
                    style={styles.input}
                    type="text"
                    value={editForm.timezone}
                    onChange={(e) => setEditForm({ ...editForm, timezone: e.target.value })}
                    placeholder="UTC"
                  />
                </div>

                <div style={styles.formDivider}>Owner Details</div>

                <div style={styles.formRow}>
                  <div style={styles.formGroup}>
                    <label style={styles.label} htmlFor="edit-owner-first">First Name</label>
                    <input
                      id="edit-owner-first"
                      style={styles.input}
                      type="text"
                      value={editForm.owner_first_name}
                      onChange={(e) => setEditForm({ ...editForm, owner_first_name: e.target.value })}
                    />
                  </div>
                  <div style={styles.formGroup}>
                    <label style={styles.label} htmlFor="edit-owner-last">Last Name</label>
                    <input
                      id="edit-owner-last"
                      style={styles.input}
                      type="text"
                      value={editForm.owner_last_name}
                      onChange={(e) => setEditForm({ ...editForm, owner_last_name: e.target.value })}
                    />
                  </div>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label} htmlFor="edit-owner-email">Email</label>
                  <input
                    id="edit-owner-email"
                    style={styles.input}
                    type="email"
                    value={editForm.owner_email}
                    onChange={(e) => setEditForm({ ...editForm, owner_email: e.target.value })}
                  />
                </div>

                <div style={styles.formActions}>
                  <Button variant="outline" type="button" onClick={() => { setEditing(false); setEditError(null); }}>
                    Cancel
                  </Button>
                  <Button onClick={handleSaveEdit} loading={saving}>
                    Save Changes
                  </Button>
                </div>
              </div>
            ) : (
              /* View Mode */
              <>
                <div style={styles.detailBody}>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>URL Alias</span>
                    <span style={styles.detailValue}>{selectedTenant.slug}</span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Status</span>
                    <Badge variant={STATUS_VARIANTS[selectedTenant.status] || 'neutral'}>
                      {formatStatus(selectedTenant.status)}
                    </Badge>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Currency</span>
                    <span style={styles.detailValue}>{selectedTenant.currency}</span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Timezone</span>
                    <span style={styles.detailValue}>{selectedTenant.timezone}</span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Language</span>
                    <span style={styles.detailValue}>{selectedTenant.default_language}</span>
                  </div>
                  {selectedTenant.owner && (
                    <>
                      <div style={{ ...styles.formDivider, marginTop: '12px' }}>Owner</div>
                      <div style={styles.detailRow}>
                        <span style={styles.detailLabel}>Name</span>
                        <span style={styles.detailValue}>
                          {selectedTenant.owner.first_name} {selectedTenant.owner.last_name}
                        </span>
                      </div>
                      <div style={styles.detailRow}>
                        <span style={styles.detailLabel}>Email</span>
                        <span style={styles.detailValue}>{selectedTenant.owner.email}</span>
                      </div>
                    </>
                  )}
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Created</span>
                    <span style={styles.detailValue}>
                      {new Date(selectedTenant.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Updated</span>
                    <span style={styles.detailValue}>
                      {new Date(selectedTenant.updated_at).toLocaleString()}
                    </span>
                  </div>
                </div>
                <div style={styles.detailActions}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => startEditing(selectedTenant)}
                  >
                    Edit
                  </Button>
                  {selectedTenant.status === 'active' && (
                    <Button
                      variant="destructive"
                      size="sm"
                      loading={actionLoading}
                      onClick={() => handleSuspend(selectedTenant)}
                    >
                      Suspend
                    </Button>
                  )}
                  {selectedTenant.status === 'suspended' && (
                    <Button
                      variant="primary"
                      size="sm"
                      loading={actionLoading}
                      onClick={() => handleActivate(selectedTenant)}
                    >
                      Activate
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Create Tenant Modal */}
      {showCreate && (
        <div style={styles.overlay} onClick={() => setShowCreate(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>Create Tenant</h2>
              <button
                style={styles.closeBtn}
                onClick={() => setShowCreate(false)}
                aria-label="Close create modal"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleCreate} style={styles.form}>
              {createError && <div style={styles.formError}>{createError}</div>}

              <div style={styles.formGroup}>
                <label style={styles.label} htmlFor="tenant-name">Name *</label>
                <input
                  id="tenant-name"
                  style={styles.input}
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  required
                  placeholder="My Business"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label} htmlFor="tenant-slug">URL Alias (optional, auto-generates)</label>
                <input
                  id="tenant-slug"
                  style={styles.input}
                  type="text"
                  value={createForm.slug}
                  onChange={(e) => setCreateForm({ ...createForm, slug: e.target.value })}
                  placeholder="my-business"
                />
              </div>

              <div style={styles.formDivider}>Owner Details</div>

              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label} htmlFor="owner-first">First Name *</label>
                  <input
                    id="owner-first"
                    style={styles.input}
                    type="text"
                    value={createForm.owner_first_name}
                    onChange={(e) => setCreateForm({ ...createForm, owner_first_name: e.target.value })}
                    required
                  />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label} htmlFor="owner-last">Last Name *</label>
                  <input
                    id="owner-last"
                    style={styles.input}
                    type="text"
                    value={createForm.owner_last_name}
                    onChange={(e) => setCreateForm({ ...createForm, owner_last_name: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label} htmlFor="owner-email">Email *</label>
                <input
                  id="owner-email"
                  style={styles.input}
                  type="email"
                  value={createForm.owner_email}
                  onChange={(e) => setCreateForm({ ...createForm, owner_email: e.target.value })}
                  required
                  placeholder="owner@example.com"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label} htmlFor="owner-password">Password *</label>
                <input
                  id="owner-password"
                  style={styles.input}
                  type="password"
                  value={createForm.owner_password}
                  onChange={(e) => setCreateForm({ ...createForm, owner_password: e.target.value })}
                  required
                  minLength={8}
                />
              </div>

              <div style={styles.formDivider}>Settings</div>

              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label} htmlFor="tenant-language">Language</label>
                  <select
                    id="tenant-language"
                    style={styles.input}
                    value={createForm.default_language}
                    onChange={(e) => setCreateForm({ ...createForm, default_language: e.target.value })}
                  >
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                  </select>
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label} htmlFor="tenant-currency">Currency</label>
                  <input
                    id="tenant-currency"
                    style={styles.input}
                    type="text"
                    value={createForm.currency}
                    onChange={(e) => setCreateForm({ ...createForm, currency: e.target.value })}
                    placeholder="EUR"
                  />
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label} htmlFor="tenant-timezone">Timezone</label>
                <input
                  id="tenant-timezone"
                  style={styles.input}
                  type="text"
                  value={createForm.timezone}
                  onChange={(e) => setCreateForm({ ...createForm, timezone: e.target.value })}
                  placeholder="UTC"
                />
              </div>

              <div style={styles.formActions}>
                <Button variant="outline" type="button" onClick={() => setShowCreate(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={creating}>
                  Create Tenant
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 'var(--space-lg)', maxWidth: '1200px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  title: { fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  toolbar: { display: 'flex', gap: 'var(--space-md)', alignItems: 'center', marginBottom: 'var(--space-md)' },
  errorBanner: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: 'var(--space-sm) var(--space-md)', marginBottom: 'var(--space-md)',
    background: 'var(--color-error-bg)', borderRadius: 'var(--radius-md)',
    color: 'var(--color-error-light)', fontSize: 'var(--font-size-sm)',
  },

  // Overlay
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    backdropFilter: 'blur(2px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },

  // Detail Panel
  detailPanel: {
    background: 'var(--color-surface-elevated, var(--color-surface))', borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-xl)', width: '100%', maxWidth: '480px',
    maxHeight: '80vh', overflowY: 'auto' as const,
    boxShadow: '0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px var(--color-border)',
  },
  detailHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  detailTitle: { fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  detailBody: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-sm)' },
  detailRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-xs) 0', borderBottom: '1px solid var(--color-border)' },
  detailLabel: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', fontWeight: 'var(--font-weight-medium)' as any },
  detailValue: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' },
  detailActions: { marginTop: 'var(--space-lg)', display: 'flex', gap: 'var(--space-sm)' },

  // Modal
  modal: {
    background: 'var(--color-surface-elevated, var(--color-surface))', borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-xl)', width: '100%', maxWidth: '560px',
    maxHeight: '85vh', overflowY: 'auto' as const,
    boxShadow: '0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px var(--color-border)',
  },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' },
  modalTitle: { fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-text)', margin: 0 },
  closeBtn: {
    background: 'none', border: 'none', color: 'var(--color-text-secondary)',
    fontSize: '24px', cursor: 'pointer', padding: '4px 8px', lineHeight: 1,
  },

  // Form
  form: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-md)' },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-xs)', flex: 1 },
  formRow: { display: 'flex', gap: 'var(--space-md)' },
  formDivider: {
    fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)' as any,
    color: 'var(--color-text-secondary)', textTransform: 'uppercase' as const,
    letterSpacing: 'var(--letter-spacing-wider)', paddingTop: 'var(--space-sm)',
    borderTop: '1px solid var(--color-border)',
  },
  label: { fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', fontWeight: 'var(--font-weight-medium)' as any },
  input: {
    background: 'var(--color-bg)', border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)', padding: 'var(--space-sm) var(--space-md)',
    color: 'var(--color-text)', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-family)',
    outline: 'none',
  },
  formError: {
    padding: 'var(--space-sm) var(--space-md)', background: 'var(--color-error-bg)',
    borderRadius: 'var(--radius-md)', color: 'var(--color-error-light)', fontSize: 'var(--font-size-sm)',
  },
  formActions: { display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)', paddingTop: 'var(--space-md)' },
};
