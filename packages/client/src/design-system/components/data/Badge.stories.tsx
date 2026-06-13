import { Badge } from './Badge';

export default {
  title: 'Data/Badge',
  component: Badge,
  argTypes: {
    variant: { control: 'select', options: ['success', 'warning', 'error', 'info', 'neutral'] },
  },
};

export const Success = { args: { children: 'Active', variant: 'success' } };
export const Warning = { args: { children: 'Pending', variant: 'warning' } };
export const Error = { args: { children: 'Failed', variant: 'error' } };
export const Info = { args: { children: 'New', variant: 'info' } };
export const Neutral = { args: { children: 'Draft', variant: 'neutral' } };
