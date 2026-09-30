import { useState } from 'react';
import { SegmentedControl } from './SegmentedControl';

export default {
  title: 'Forms/SegmentedControl',
  component: SegmentedControl,
};

export const SetupMode = () => {
  const [mode, setMode] = useState<'quick' | 'advanced'>('quick');
  return (
    <SegmentedControl
      aria-label="Setup mode"
      value={mode}
      onChange={setMode}
      options={[{ value: 'quick', label: 'Quick Setup' }, { value: 'advanced', label: 'Advanced' }]}
    />
  );
};
