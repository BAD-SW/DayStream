import { Card } from './Card';

export default {
  title: 'Data/Card',
  component: Card,
  argTypes: {
    variant: { control: 'select', options: ['default', 'elevated', 'outlined', 'interactive'] },
    padding: { control: 'select', options: ['sm', 'md', 'lg'] },
  },
};

export const Default = { args: { children: 'Default card content', variant: 'default' } };
export const Elevated = { args: { children: 'Elevated card with shadow', variant: 'elevated' } };
export const Outlined = { args: { children: 'Outlined card with border', variant: 'outlined' } };
export const Interactive = { args: { children: 'Click me!', variant: 'interactive', onClick: () => alert('Clicked') } };
