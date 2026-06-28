import { Link } from 'react-router-dom';
import type { ToolPreflightState } from '../hooks/useToolPreflight';
import { useTranslation, type TranslationKey } from '../i18n';

type DashboardWelcomePanelProps = {
  preflight: ToolPreflightState;
  onClose: () => void;
};

const ONBOARDING_STEP_IDS = ['import', 'selection', 'compression', 'grouping', 'export'] as const;

type WelcomeSignalTone = 'loading' | 'warning' | 'error' | 'success';

const getWelcomeSignal = (
  preflight: ToolPreflightState,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
) => {
  const missingTools = preflight.snapshot
    ? Object.values(preflight.snapshot.tools)
      .filter((tool) => tool.key !== 'exiftool' && tool.status !== 'ready')
      .map((tool) => tool.label)
    : [];
  const pythonMissing = preflight.snapshot?.python.status === 'missing';

  if (preflight.status === 'loading') {
    return {
      tone: 'loading' as WelcomeSignalTone,
      title: t('dashboard.onboarding.toolsCheckingTitle'),
      body: t('toolsPreflight.checking')
    };
  }

  if (preflight.status === 'error') {
    return {
      tone: 'error' as WelcomeSignalTone,
      title: t('dashboard.onboarding.toolsAttentionTitle'),
      body: preflight.error ?? t('toolsPreflight.unknown')
    };
  }

  if (pythonMissing) {
    return {
      tone: 'error' as WelcomeSignalTone,
      title: t('dashboard.onboarding.toolsAttentionTitle'),
      body: t('toolsPreflight.pythonMissing')
    };
  }

  if (missingTools.length > 0) {
    return {
      tone: 'warning' as WelcomeSignalTone,
      title: t('dashboard.onboarding.toolsOptionalTitle'),
      body: t('toolsPreflight.missing', { tools: missingTools.join(', ') })
    };
  }

  return {
    tone: 'success' as WelcomeSignalTone,
    title: t('dashboard.onboarding.toolsReadyTitle'),
    body: t('dashboard.onboarding.toolsReadyBody')
  };
};

export const DashboardWelcomePanel = ({ preflight, onClose }: DashboardWelcomePanelProps) => {
  const { t } = useTranslation();
  const toolsSignal = getWelcomeSignal(preflight, t);

  return (
    <section className="dashboard-onboarding" aria-labelledby="dashboard-onboarding-title">
      <div className="dashboard-onboarding-main">
        <div className="dashboard-onboarding-copy">
          <p className="panel-kicker">{t('dashboard.onboarding.kicker')}</p>
          <h2 className="dashboard-onboarding-title" id="dashboard-onboarding-title">
            {t('dashboard.onboarding.title')}
          </h2>
          <p className="dashboard-onboarding-description">{t('dashboard.onboarding.description')}</p>

          <div className="dashboard-onboarding-signals">
            <article className={`dashboard-onboarding-signal dashboard-onboarding-signal-${toolsSignal.tone}`}>
              <span className="dashboard-onboarding-signal-label">{t('dashboard.onboarding.toolsLabel')}</span>
              <strong>{toolsSignal.title}</strong>
              <p>{toolsSignal.body}</p>
            </article>
            <article className="dashboard-onboarding-signal dashboard-onboarding-signal-route">
              <span className="dashboard-onboarding-signal-label">{t('dashboard.onboarding.flowLabel')}</span>
              <strong>{t('dashboard.onboarding.flowTitle')}</strong>
              <p>{t('dashboard.onboarding.flowBody')}</p>
            </article>
          </div>

          <div className="dashboard-onboarding-actions">
            <Link className="btn btn-primary" to="/settings" state={{ returnTo: '/dashboard' }}>
              {t('dashboard.onboarding.primaryAction')}
            </Link>
            <Link className="btn btn-secondary" to="/import">
              {t('dashboard.onboarding.secondaryAction')}
            </Link>
            <button className="btn btn-secondary dashboard-onboarding-close" type="button" onClick={onClose}>
              {t('dashboard.onboarding.close')}
            </button>
          </div>
        </div>

        <div className="dashboard-onboarding-visual" aria-hidden="true">
          <div className="dashboard-onboarding-art">
            <div className="dashboard-onboarding-art-orb dashboard-onboarding-art-orb-a" />
            <div className="dashboard-onboarding-art-orb dashboard-onboarding-art-orb-b" />
            <div className="dashboard-onboarding-art-card dashboard-onboarding-art-card-main">
              <span>{t('dashboard.onboarding.artOrganize')}</span>
              <strong>{t('dashboard.onboarding.artMemories')}</strong>
            </div>
            <div className="dashboard-onboarding-art-card dashboard-onboarding-art-card-top">
              <span>{t('dashboard.onboarding.artCompress')}</span>
            </div>
            <div className="dashboard-onboarding-art-card dashboard-onboarding-art-card-bottom">
              <span>{t('dashboard.onboarding.artBackup')}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard-onboarding-steps" aria-label={t('dashboard.onboarding.stepsAria')}>
        {ONBOARDING_STEP_IDS.map((stepId, index) => {
          const labelKey = `workflow.${stepId}.label` as TranslationKey;
          const descriptionKey = `workflow.${stepId}.description` as TranslationKey;

          return (
            <article className="dashboard-onboarding-step" key={stepId}>
              <span className="dashboard-onboarding-step-number">0{index + 1}</span>
              <strong>{t(labelKey)}</strong>
              <p>{t(descriptionKey)}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default DashboardWelcomePanel;
