interface Step {
  id: string;
  label: string;
}

interface StepsProps {
  steps: Step[];
  activeStep: string;
  completedSteps?: string[];
  onStepClick?: (stepId: string) => void;
}

export function Steps({ steps, activeStep, completedSteps = [], onStepClick }: StepsProps) {
  return (
    <nav aria-label="Progress" style={styles.nav}>
      <ol style={styles.list}>
        {steps.map((step, index) => {
          const isActive = step.id === activeStep;
          const isCompleted = completedSteps.includes(step.id);
          const isClickable = isCompleted && onStepClick;

          return (
            <li key={step.id} style={styles.item}>
              <button
                onClick={isClickable ? () => onStepClick!(step.id) : undefined}
                disabled={!isClickable && !isActive}
                style={{
                  ...styles.step,
                  ...(isActive ? styles.stepActive : {}),
                  ...(isCompleted ? styles.stepCompleted : {}),
                  cursor: isClickable ? 'pointer' : 'default',
                }}
                aria-current={isActive ? 'step' : undefined}
              >
                <span style={styles.number}>
                  {isCompleted ? '✓' : index + 1}
                </span>
                <span style={styles.label}>{step.label}</span>
              </button>
              {index < steps.length - 1 && <div style={styles.connector} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const styles: Record<string, React.CSSProperties> = {
  nav: {},
  list: { display: 'flex', alignItems: 'center', listStyle: 'none', margin: 0, padding: 0, gap: 0 },
  item: { display: 'flex', alignItems: 'center' },
  step: {
    display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
    background: 'none', border: 'none', padding: 'var(--space-sm)',
    fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)',
    fontFamily: 'var(--font-family)',
  },
  stepActive: { color: 'var(--color-primary)', fontWeight: 600 },
  stepCompleted: { color: 'var(--color-success-light)' },
  number: {
    width: '28px', height: '28px', borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: '2px solid currentColor', fontSize: 'var(--font-size-xs)',
    fontWeight: 600,
  },
  label: {},
  connector: { width: '32px', height: '2px', background: 'var(--color-border)', margin: '0 var(--space-xs)' },
};
