import { SERVICE_STEP_LABELS, SERVICE_STEP_ORDER, ServiceFlowStep } from './types';

interface Props {
  currentStep: ServiceFlowStep;
}

/** Requirement 3.10 — a progress indicator showing current step and total steps at all times. */
export function ProgressIndicator({ currentStep }: Props) {
  const currentIndex = SERVICE_STEP_ORDER.indexOf(currentStep);

  return (
    <div className="dsw-progress" role="list" aria-label="Booking progress">
      {SERVICE_STEP_ORDER.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'upcoming';
        return (
          <div key={step} className={`dsw-progress-step dsw-progress-step--${state}`} role="listitem">
            <span className="dsw-progress-dot">{index < currentIndex ? '✓' : index + 1}</span>
            <span className="dsw-progress-label">{SERVICE_STEP_LABELS[step]}</span>
          </div>
        );
      })}
    </div>
  );
}
