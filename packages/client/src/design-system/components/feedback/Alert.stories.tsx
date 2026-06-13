import { Alert } from './Alert';

export default {
  title: 'Feedback/Alert',
  component: Alert,
  argTypes: {
    variant: { control: 'select', options: ['success', 'warning', 'error', 'info'] },
  },
};

export const Success = { args: { children: 'Operation completed successfully.', variant: 'success', title: 'Success' } };
export const Warning = { args: { children: 'This action cannot be undone.', variant: 'warning', title: 'Warning' } };
export const Error = { args: { children: 'Something went wrong. Please try again.', variant: 'error', title: 'Error' } };
export const Info = { args: { children: 'Your session will expire in 5 minutes.', variant: 'info', title: 'Info' } };
