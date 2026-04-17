import { Link, useLocation } from 'react-router-dom';

export type StepConfig = {
  id: string;
  number: number;
  label: string;
  description: string;
  path: string;
  state: 'active' | 'pending' | 'locked';
};

type StepperProps = {
  steps: StepConfig[];
};

export const Stepper = ({ steps }: StepperProps) => {
  const location = useLocation();

  return (
    <nav className="stepper" aria-label="Workflow steps">
      {steps.map((step, index) => {
        const isActive = location.pathname === step.path;

        return (
          <div key={step.id}>
            <Link
              to={step.path}
              className={`step step-${step.state} ${isActive ? 'step-active-page' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <div className="step-circle">
                <span className="step-number">{step.number}</span>
              </div>
              <div className="step-text">
                <p className="step-label">{step.label}</p>
                <p className="step-description">{step.description}</p>
              </div>
            </Link>

            {index < steps.length - 1 && <div className="step-connector" />}
          </div>
        );
      })}
    </nav>
  );
};
