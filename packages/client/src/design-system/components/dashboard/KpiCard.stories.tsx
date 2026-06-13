import { KpiCard } from './KpiCard';

export default {
  title: 'Dashboard/KpiCard',
  component: KpiCard,
};

export const Default = {
  args: { icon: '📅', label: "Today's Bookings", value: 12 },
};

export const WithTrendUp = {
  args: { icon: '💰', label: 'Revenue', value: '€4,250', trend: { direction: 'up', percentage: 12, period: 'vs last week' } },
};

export const WithTrendDown = {
  args: { icon: '👥', label: 'New Customers', value: 3, trend: { direction: 'down', percentage: 8, period: 'vs last week' } },
};

export const CustomColor = {
  args: { icon: '✅', label: 'System Health', value: 'OK', color: '#66BB6A' },
};
