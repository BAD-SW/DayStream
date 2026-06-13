import { useState } from 'react';
import { Switch } from './Switch';

export default {
  title: 'Forms/Switch',
  component: Switch,
};

export const Default = () => {
  const [checked, setChecked] = useState(false);
  return <Switch label="Enable notifications" name="notifications" checked={checked} onChange={setChecked} />;
};

export const Checked = () => {
  const [checked, setChecked] = useState(true);
  return <Switch label="Dark mode" name="dark" checked={checked} onChange={setChecked} />;
};

export const Disabled = () => {
  return <Switch label="Locked setting" name="locked" checked={true} onChange={() => {}} disabled />;
};
