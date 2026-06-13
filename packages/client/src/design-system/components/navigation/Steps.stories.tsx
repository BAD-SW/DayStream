import { Steps } from './Steps';

export default {
  title: 'Navigation/Steps',
  component: Steps,
};

const steps = [
  { id: 'info', label: 'Basic Info' },
  { id: 'services', label: 'Services' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'confirm', label: 'Confirm' },
];

export const FirstStep = { args: { steps, activeStep: 'info', completedSteps: [] } };
export const MiddleStep = { args: { steps, activeStep: 'schedule', completedSteps: ['info', 'services'] } };
export const LastStep = { args: { steps, activeStep: 'confirm', completedSteps: ['info', 'services', 'schedule'] } };
