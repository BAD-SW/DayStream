import { apiClient } from './client';

export async function getActiveMembership() {
  const res = await apiClient.get('/v1/memberships/my');
  const m = res.data.data;
  if (!m) return null;
  return { planName: m.plan_name || 'Membership', creditsRemaining: m.credits_remaining ?? 0, status: m.status, renewalDate: m.renewal_date };
}

export async function getMembershipPlans() {
  const res = await apiClient.get('/v1/memberships/plans');
  return res.data.data || [];
}
