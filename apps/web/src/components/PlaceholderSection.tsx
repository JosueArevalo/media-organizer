import { Link } from 'react-router-dom';
import { useTranslation } from '../i18n';

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
  const { t } = useTranslation();

  return (
    <section className="panel">
      <p className="panel-kicker">{t('placeholder.scaffold')}</p>
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
          {t('placeholder.backToDashboard')}
        </Link>
      </div>

      <div className="empty-note">
        {t('placeholder.empty')}
      </div>
    </section>
  );
};
