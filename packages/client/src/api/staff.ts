import { apiClient } from './client';

export interface StaffProfile {
  id: string;
  tenant_id: string;
  user_id: string | null;
  staff_ref: string;
  first_name: string;
  last_name: string;
  email: string | null;
  mobile_phone: string | null;
  date_of_birth: string | null;
  hire_date: string | null;
  employment_type: string;
  status: string;
  bio: string | null;
  profile_photo_path: string | null;
  languages: string | null;
  show_on_directory: boolean;
  primary_location_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Qualification {
  id: string;
  staff_id: string;
  name: string;
  issuing_body: string | null;
  date_obtained: string | null;
  expiry_date: string | null;
  certification_number: string | null;
  document_path: string | null;
  show_on_directory: boolean;
}

export interface AvailabilityPattern {
  id: string;
  staff_id: string;
  name: string;
  effective_from: string;
  effective_to: string | null;
  is_default: boolean;
  location_id: string | null;
  slots: PatternSlot[];
}

export interface PatternSlot {
  id: string;
  pattern_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface LeaveRequest {
  id: string;
  staff_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  notes: string | null;
  status: string;
  first_name?: string;
  last_name?: string;
  staff_ref?: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

// ============================================================
// Staff CRUD
// ============================================================

export async function getStaffList(params?: Record<string, any>) {
  const res = await apiClient.get('/v1/staff', { params });
  return { data: res.data.data, meta: res.data.meta };
}

export async function createStaff(data: Record<string, any>) {
  const res = await apiClient.post('/v1/staff', data);
  return res.data.data;
}

export async function getStaff(id: string) {
  const res = await apiClient.get(`/v1/staff/${id}`);
  return res.data.data;
}

export async function updateStaff(id: string, data: Record<string, any>) {
  const res = await apiClient.put(`/v1/staff/${id}`, data);
  return res.data.data;
}

export async function deactivateStaff(id: string) {
  const res = await apiClient.put(`/v1/staff/${id}/deactivate`);
  return res.data.data;
}

export async function uploadStaffPhoto(id: string, file: File) {
  const formData = new FormData();
  formData.append('photo', file);
  const res = await apiClient.post(`/v1/staff/${id}/photo`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.data;
}

// ============================================================
// Qualifications
// ============================================================

export async function getQualifications(staffId: string) {
  const res = await apiClient.get(`/v1/staff/${staffId}/qualifications`);
  return res.data.data as Qualification[];
}

export async function addQualification(staffId: string, data: Record<string, any>) {
  const res = await apiClient.post(`/v1/staff/${staffId}/qualifications`, data);
  return res.data.data;
}

export async function deleteQualification(staffId: string, qualId: string) {
  await apiClient.delete(`/v1/staff/${staffId}/qualifications/${qualId}`);
}

export async function getExpiringQualifications(days?: number) {
  const res = await apiClient.get('/v1/staff/qualifications/expiring', { params: { days } });
  return res.data.data;
}

// ============================================================
// Availability
// ============================================================

export async function getAvailabilityPatterns(staffId: string) {
  const res = await apiClient.get(`/v1/staff/${staffId}/availability/patterns`);
  return res.data.data as AvailabilityPattern[];
}

export async function createAvailabilityPattern(staffId: string, data: Record<string, any>) {
  const res = await apiClient.post(`/v1/staff/${staffId}/availability/patterns`, data);
  return res.data.data;
}

export async function copyAvailabilityPattern(staffId: string, patternId: string) {
  const res = await apiClient.post(`/v1/staff/${staffId}/availability/patterns/${patternId}/copy`);
  return res.data.data;
}

export async function deleteAvailabilityPattern(staffId: string, patternId: string) {
  await apiClient.delete(`/v1/staff/${staffId}/availability/patterns/${patternId}`);
}

export async function getResolvedAvailability(staffId: string, startDate: string, endDate: string) {
  const res = await apiClient.get(`/v1/staff/${staffId}/availability`, {
    params: { start_date: startDate, end_date: endDate },
  });
  return res.data.data;
}

// ============================================================
// Availability Overrides
// ============================================================

export interface AvailabilityOverride {
  id: string;
  staff_id: string;
  override_date: string;
  start_time: string | null;
  end_time: string | null;
  is_unavailable: boolean;
  reason: string | null;
}

export async function getAvailabilityOverrides(staffId: string) {
  const res = await apiClient.get(`/v1/staff/${staffId}/availability/overrides`);
  return res.data.data as AvailabilityOverride[];
}

export async function createAvailabilityOverride(staffId: string, data: Record<string, any>) {
  const res = await apiClient.post(`/v1/staff/${staffId}/availability/overrides`, data);
  return res.data.data;
}

export async function deleteAvailabilityOverride(staffId: string, overrideId: string) {
  await apiClient.delete(`/v1/staff/${staffId}/availability/overrides/${overrideId}`);
}

// ============================================================
// Leave Management
// ============================================================

export async function getLeaveRequests(params?: Record<string, any>) {
  const res = await apiClient.get('/v1/staff/leave', { params });
  return { data: res.data.data as LeaveRequest[], meta: res.data.meta };
}

export async function submitLeaveRequest(staffId: string, data: Record<string, any>) {
  const res = await apiClient.post(`/v1/staff/${staffId}/leave`, data);
  return res.data.data;
}

export async function approveLeave(leaveId: string) {
  const res = await apiClient.put(`/v1/staff/leave/${leaveId}/approve`);
  return res.data.data;
}

export async function rejectLeave(leaveId: string) {
  const res = await apiClient.put(`/v1/staff/leave/${leaveId}/reject`);
  return res.data.data;
}

export async function cancelLeave(leaveId: string) {
  const res = await apiClient.put(`/v1/staff/leave/${leaveId}/cancel`);
  return res.data.data;
}

export async function getLeaveBalances(staffId: string, year?: number) {
  const res = await apiClient.get(`/v1/staff/${staffId}/leave/balance`, { params: { year } });
  return res.data.data;
}

// ============================================================
// Assignments
// ============================================================

export async function getServiceAssignments(staffId: string) {
  const res = await apiClient.get(`/v1/staff/${staffId}/services`);
  return res.data.data;
}

export async function assignServices(staffId: string, assignments: Array<{ serviceId: string; variantId?: string; isPrimary?: boolean }>) {
  const res = await apiClient.post(`/v1/staff/${staffId}/services`, { assignments });
  return res.data.data;
}

export async function removeServiceAssignment(staffId: string, serviceId: string) {
  await apiClient.delete(`/v1/staff/${staffId}/services/${serviceId}`);
}

export async function getLocationAssignments(staffId: string) {
  const res = await apiClient.get(`/v1/staff/${staffId}/locations`);
  return res.data.data;
}

export async function assignLocations(staffId: string, assignments: Array<{ locationId: string; isPrimary?: boolean }>) {
  const res = await apiClient.post(`/v1/staff/${staffId}/locations`, { assignments });
  return res.data.data;
}

export async function removeLocationAssignment(staffId: string, locationId: string) {
  await apiClient.delete(`/v1/staff/${staffId}/locations/${locationId}`);
}

// ============================================================
// Capacity
// ============================================================

export async function getCapacity(staffId: string) {
  const res = await apiClient.get(`/v1/staff/${staffId}/capacity`);
  return res.data.data;
}

export async function setCapacity(staffId: string, data: Record<string, any>) {
  const res = await apiClient.put(`/v1/staff/${staffId}/capacity`, data);
  return res.data.data;
}

export async function overrideCapacity(staffId: string, data: Record<string, any>) {
  const res = await apiClient.post(`/v1/staff/${staffId}/capacity/override`, data);
  return res.data.data;
}

// ============================================================
// Calendar
// ============================================================

export async function getStaffCalendar(staffId: string, startDate: string, endDate: string) {
  const res = await apiClient.get(`/v1/staff/${staffId}/calendar`, {
    params: { start_date: startDate, end_date: endDate },
  });
  return res.data.data;
}

export async function getTeamCalendar(startDate: string, endDate: string, params?: Record<string, any>) {
  const res = await apiClient.get('/v1/staff/calendar/team', {
    params: { start_date: startDate, end_date: endDate, ...params },
  });
  return res.data.data;
}

// ============================================================
// Self-Service
// ============================================================

export async function getMyProfile() {
  const res = await apiClient.get('/v1/staff/me');
  return res.data.data;
}

export async function updateMyProfile(data: Record<string, any>) {
  const res = await apiClient.put('/v1/staff/me', data);
  return res.data.data;
}

export async function getMyCalendar(startDate: string, endDate: string) {
  const res = await apiClient.get('/v1/staff/me/calendar', {
    params: { start_date: startDate, end_date: endDate },
  });
  return res.data.data;
}

export async function getMyMetrics(startDate: string, endDate: string) {
  const res = await apiClient.get('/v1/staff/me/metrics', {
    params: { start_date: startDate, end_date: endDate },
  });
  return res.data.data;
}

export interface NotificationPreferences {
  booking_confirmed: boolean;
  booking_cancelled: boolean;
  booking_reminder: boolean;
  schedule_changed: boolean;
  leave_approved: boolean;
  leave_rejected: boolean;
  new_review: boolean;
  payroll_ready: boolean;
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const res = await apiClient.get('/v1/staff/me/notifications/preferences');
  return res.data.data;
}

export async function updateNotificationPreferences(data: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
  const res = await apiClient.put('/v1/staff/me/notifications/preferences', data);
  return res.data.data;
}

// ============================================================
// Public Directory
// ============================================================

export async function getPublicDirectory(tenantId: string, params?: Record<string, any>) {
  const res = await apiClient.get('/v1/staff/directory', { params: { tenant_id: tenantId, ...params } });
  return res.data.data;
}
