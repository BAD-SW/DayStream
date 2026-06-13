import { useState } from 'react';
import { Input } from './Input';

export default {
  title: 'Forms/Input',
  component: Input,
};

export const Default = () => {
  const [value, setValue] = useState('');
  return <Input label="Email" name="email" value={value} onChange={setValue} placeholder="you@example.com" />;
};

export const WithError = () => {
  const [value, setValue] = useState('');
  return <Input label="Email" name="email" value={value} onChange={setValue} error="Please enter a valid email" />;
};

export const WithHelper = () => {
  const [value, setValue] = useState('');
  return <Input label="Username" name="username" value={value} onChange={setValue} helperText="3-20 characters, letters and numbers only" />;
};

export const Required = () => {
  const [value, setValue] = useState('');
  return <Input label="Full Name" name="name" value={value} onChange={setValue} required />;
};

export const Disabled = () => {
  return <Input label="Locked" name="locked" value="Cannot edit" onChange={() => {}} disabled />;
};
