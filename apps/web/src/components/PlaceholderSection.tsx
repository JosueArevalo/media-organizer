import { Link } from 'react-router-dom';

type PlaceholderSectionProps = {
  title: string;
  description: string;
  primaryActionLabel: string;
  secondaryActionLabel: string;
  backTo?: string;
};

export const PlaceholderSection = ({
  title,
  description,
  primaryActionLabel,
  secondaryActionLabel,
  backTo = '/dashboard'
}: PlaceholderSectionProps) => {
  return (
    <section className="panel">
      <p className="panel-kicker">Scaffold</p>
      <h2 className="panel-title">{title}</h2>
      <p className="panel-description">{description}</p>

      <div className="action-row">
        <button className="btn btn-primary" type="button">
          {primaryActionLabel}
        </button>
        <button className="btn btn-secondary" type="button">
          {secondaryActionLabel}
        </button>
        <Link to={backTo} className="btn btn-ghost">
          Back to dashboard
        </Link>
      </div>

      <div className="empty-note">
        This page is intentionally empty for now. Next iterations can wire this to real backend APIs.
      </div>
    </section>
  );
};
