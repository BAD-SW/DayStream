import { Tabs } from './Tabs';

export default {
  title: 'Navigation/Tabs',
  component: Tabs,
};

const items = [
  { id: 'details', label: 'Details', content: <p>Details tab content</p> },
  { id: 'settings', label: 'Settings', content: <p>Settings tab content</p> },
  { id: 'history', label: 'History', content: <p>History tab content</p> },
];

export const Horizontal = { args: { items, orientation: 'horizontal' } };
export const Vertical = { args: { items, orientation: 'vertical' } };
