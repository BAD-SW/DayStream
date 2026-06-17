import { apiClient } from './client';

export async function getDashboard(params?: Record<string, any>) { const r = await apiClient.get('/v1/reports/dashboard', { params }); return r.data.data; }
export async function getDashboardConfig() { const r = await apiClient.get('/v1/reports/dashboard/config'); return r.data.data; }
export async function saveDashboardConfig(widgets: any[]) { const r = await apiClient.put('/v1/reports/dashboard/config', { widgets }); return r.data.data; }
export async function getRevenueReport(params?: Record<string, any>) { const r = await apiClient.get('/v1/reports/revenue', { params }); return r.data.data; }
export async function getBookingsReport(params?: Record<string, any>) { const r = await apiClient.get('/v1/reports/bookings', { params }); return r.data.data; }
export async function getMembershipsReport(params?: Record<string, any>) { const r = await apiClient.get('/v1/reports/memberships', { params }); return r.data.data; }
export async function getStaffReport(params?: Record<string, any>) { const r = await apiClient.get('/v1/reports/staff', { params }); return r.data.data; }
export async function getCustomersReport(params?: Record<string, any>) { const r = await apiClient.get('/v1/reports/customers', { params }); return r.data.data; }
export async function getFinancialReport(params?: Record<string, any>) { const r = await apiClient.get('/v1/reports/financial', { params }); return r.data.data; }
export async function getScheduledReports() { const r = await apiClient.get('/v1/reports/scheduled'); return r.data.data; }
export async function createScheduledReport(data: Record<string, any>) { const r = await apiClient.post('/v1/reports/scheduled', data); return r.data.data; }
export async function triggerAggregation(date?: string) { const r = await apiClient.post('/v1/reports/aggregate', { date }); return r.data.data; }
export async function exportReport(type: string, params?: Record<string, any>) { const r = await apiClient.get(`/v1/reports/${type}/export`, { params }); return r.data; }
