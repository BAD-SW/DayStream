import { apiClient } from './client';
import type { FormDefinition, FormAnswer } from '@daystream/shared';

/** Treatment charts (spec 51, gap 2). Only clinical roles can call any of these. */
export type ChartAnswers = Record<string, FormAnswer | undefined>;

export interface ChartSummary {
  id: string;
  customerId: string;
  bookingId: string | null;
  formName: string;
  formVersion: number;
  status: 'draft' | 'signed';
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  signedByName: string | null;
  signedAt: string | null;
  amendmentCount: number;
}

export interface ChartAmendment {
  id: string;
  content: string;
  createdByName: string | null;
  createdAt: string;
}

export interface Chart extends ChartSummary {
  definition: FormDefinition;
  answers: ChartAnswers;
  amendments: ChartAmendment[];
}

export async function listCustomerCharts(businessId: string, customerId: string): Promise<ChartSummary[]> {
  const res = await apiClient.get(`/v1/charts/customer/${customerId}`, { params: { business_id: businessId } });
  return res.data.data;
}

export async function listBookingCharts(businessId: string, bookingId: string): Promise<ChartSummary[]> {
  const res = await apiClient.get(`/v1/charts/booking/${bookingId}`, { params: { business_id: businessId } });
  return res.data.data;
}

export async function getChart(businessId: string, id: string): Promise<Chart> {
  const res = await apiClient.get(`/v1/charts/${id}`, { params: { business_id: businessId } });
  return res.data.data;
}

export async function createChart(
  businessId: string, input: { customerId: string; formId: string; bookingId?: string | null },
): Promise<Chart> {
  const res = await apiClient.post('/v1/charts', {
    business_id: businessId, customer_id: input.customerId, form_id: input.formId, booking_id: input.bookingId ?? null,
  });
  return res.data.data;
}

export async function saveChart(businessId: string, id: string, answers: ChartAnswers): Promise<Chart> {
  const res = await apiClient.put(`/v1/charts/${id}`, { business_id: businessId, answers });
  return res.data.data;
}

export async function deleteChart(businessId: string, id: string): Promise<void> {
  await apiClient.delete(`/v1/charts/${id}`, { data: { business_id: businessId } });
}

export async function signOffChart(businessId: string, id: string): Promise<Chart> {
  const res = await apiClient.post(`/v1/charts/${id}/sign`, { business_id: businessId });
  return res.data.data;
}

export async function amendChart(businessId: string, id: string, content: string): Promise<Chart> {
  const res = await apiClient.post(`/v1/charts/${id}/amendments`, { business_id: businessId, content });
  return res.data.data;
}

export async function fetchChartPdf(businessId: string, id: string): Promise<Blob> {
  const res = await apiClient.get(`/v1/charts/${id}/pdf`, { params: { business_id: businessId }, responseType: 'blob' });
  return res.data;
}
