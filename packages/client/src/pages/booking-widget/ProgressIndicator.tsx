import { useTranslation } from 'react-i18next';
import { FlowStep, STEP_LABEL_KEYS } from './types';

interface Props {
  steps: FlowStep[];
  currentStep: FlowStep;
}

/** Requirement 3.10 / 18.1 — current step and total steps at all times; the step list
 * itself is shorter for package/membership purchases (no calendar/slot steps). */
export function ProgressIndicator({ steps, currentStep }: Props) {
  const { t } = useTranslation('widget');
  const currentIndex = steps.indexOf(currentStep);

  return (
    <div className="dsw-progress" role="list" aria-label={t('progress.label')}>
      {steps.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'upcoming';
        return (
          <div key={step} className={`dsw-progress-step dsw-progress-step--${state}`} role="listitem">
            <span className="dsw-progress-dot">{index < currentIndex ? '✓' : index + 1}</span>
            <span className="dsw-progress-label">{t(STEP_LABEL_KEYS[step])}</span>
          </div>
        );
      })}
    </div>
  );
}
