import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from '../i18n';

export type StepConfig = {
  id: string;
  number: number;
  label: string;
  description: string;
  path: string;
  state: 'active' | 'pending' | 'locked' | 'completed';
};


type StepperProps = {
  steps: StepConfig[];
};

export const Stepper = ({ steps }: StepperProps) => {
  const location = useLocation();
  const { t } = useTranslation();

  return (
    <nav className="stepper" aria-label={t('workflow.ariaLabel')}>
      {steps.map((step, index) => {
        const isActive = location.pathname === step.path;
        const className = `step step-${step.state} ${isActive ? 'step-active-page' : ''}`;

        const content = (
          <>
            <div className="step-circle">
              {step.state === 'completed' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                  <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span className="step-number">{step.number}</span>
              )}
            </div>
            <div className="step-text">
              <p className="step-label">{step.label}</p>
              <p className="step-description">{step.description}</p>
            </div>
          </>
        );

        return (
          <div key={step.id}>
            {step.state === 'locked' ? (
              <div className={className} aria-disabled="true" title={t('workflow.lockedTitle')}>
                {content}
              </div>
            ) : (
              <Link to={step.path} state={{ from: location.pathname }} className={className} aria-current={isActive ? 'page' : undefined}>
                {content}
              </Link>
            )}

            {index < steps.length - 1 && <div className="step-connector" />}
          </div>
        );
      })}
    </nav>
  );
};
