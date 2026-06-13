import { Avatar } from './Avatar';

export default {
  title: 'Data/Avatar',
  component: Avatar,
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
  },
};

export const WithImage = { args: { name: 'Jane Doe', src: 'https://i.pravatar.cc/150', size: 'md' } };
export const Initials = { args: { name: 'Jane Doe', size: 'md' } };
export const Small = { args: { name: 'JD', size: 'sm' } };
export const Large = { args: { name: 'Maria García', size: 'lg' } };
