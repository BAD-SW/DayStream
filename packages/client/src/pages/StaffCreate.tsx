import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/components/actions/Button';
import * as staffApi from '../api/staff';

export function StaffCreate() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    mobile_phone: '',
    employment_type: 'full_time',
    role: 'business_staff',
    hire_date: '',
    bio: '',
    languages: '',
    show_on_directory: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.first_name || !form.last_name) {
      setError('First and last name are required');
      return;
    }
    if (!form.email) {
      setError('Email is required');
      return;
    }
    if (!form.password || form.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const businessId = localStorage.getItem('business_id') || '';
      const staff = await staffApi.createStaff({ ...form, business_id: businessId });
      navigate(`/staff/${staff.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create staff');
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="p-6 max-w-2xl">
      <Button variant="ghost" onClick={() => navigate('/business')}>← Back</Button>
      <h1 className="text-2xl font-semibold mt-2 mb-6">Add Staff Member</h1>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-4">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">First Name *</label>
            <input className="border rounded w-full px-3 py-2" value={form.first_name}
              onChange={(e) => updateField('first_name', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Last Name *</label>
            <input className="border rounded w-full px-3 py-2" value={form.last_name}
              onChange={(e) => updateField('last_name', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email *</label>
            <input type="email" className="border rounded w-full px-3 py-2" value={form.email}
              onChange={(e) => updateField('email', e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password *</label>
            <input type="password" className="border rounded w-full px-3 py-2" value={form.password}
              onChange={(e) => updateField('password', e.target.value)} required minLength={8} placeholder="Min 8 characters" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Mobile Phone</label>
            <input className="border rounded w-full px-3 py-2" value={form.mobile_phone}
              onChange={(e) => updateField('mobile_phone', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Employment Type</label>
            <select className="border rounded w-full px-3 py-2" value={form.employment_type}
              onChange={(e) => updateField('employment_type', e.target.value)}>
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
              <option value="contractor">Contractor</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Role</label>
            <select className="border rounded w-full px-3 py-2" value={form.role}
              onChange={(e) => updateField('role', e.target.value)}>
              <option value="business_staff">Staff</option>
              <option value="business_manager">Manager</option>
              <option value="business_owner">Owner</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Hire Date</label>
            <input type="date" className="border rounded w-full px-3 py-2" value={form.hire_date}
              onChange={(e) => updateField('hire_date', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Languages</label>
          <input className="border rounded w-full px-3 py-2" value={form.languages}
            onChange={(e) => updateField('languages', e.target.value)} placeholder="e.g., English, Spanish" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Bio</label>
          <textarea className="border rounded w-full px-3 py-2" rows={3} value={form.bio}
            onChange={(e) => updateField('bio', e.target.value)} placeholder="Public-facing bio..." />
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" id="show_dir" checked={form.show_on_directory}
            onChange={(e) => updateField('show_on_directory', e.target.checked)} />
          <label htmlFor="show_dir" className="text-sm">Show on public directory</label>
        </div>

        <div className="flex gap-3 pt-4">
          <Button type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Staff'}</Button>
          <Button variant="ghost" onClick={() => navigate('/business')}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
