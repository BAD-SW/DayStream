import { Button } from './Button';

export default {
  title: 'Actions/Button',
  component: Button,
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'outline', 'ghost', 'destructive'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    loading: { control: 'boolean' },
    disabled: { control: 'boolean' },
    fullWidth: { control: 'boolean' },
  },
};

export const Primary = { args: { children: 'Primary Button', variant: 'primary' } };
export const Secondary = { args: { children: 'Secondary', variant: 'secondary' } };
export const Outline = { args: { children: 'Outline', variant: 'outline' } };
export const Ghost = { args: { children: 'Ghost', variant: 'ghost' } };
export const Destructive = { args: { children: 'Delete', variant: 'destructive' } };
export const Loading = { args: { children: 'Saving...', variant: 'primary', loading: true } };
export const Small = { args: { children: 'Small', size: 'sm' } };
export const Large = { args: { children: 'Large', size: 'lg' } };
export const FullWidth = { args: { children: 'Full Width', fullWidth: true } };
