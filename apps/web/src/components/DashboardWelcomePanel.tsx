import { Link } from 'react-router-dom';
import type { ToolPreflightState } from '../hooks/useToolPreflight';
import { useTranslation, type TranslationKey } from '../i18n';
import type { ExternalToolKey } from '../services/tool-status.service';

type DashboardWelcomePanelProps = {
  preflight: ToolPreflightState;
  onClose: () => void;
};

type OnboardingToolState = 'checking' | 'ready' | 'missing' | 'unknown';

const ONBOARDING_TOOLS: Array<{
  key: ExternalToolKey;
  name: string;
  monogram: string;
  descriptionKey: TranslationKey;
}> = [
  { key: 'image', name: 'MozJPEG', monogram: 'MJ', descriptionKey: 'dashboard.onboarding.tool.mozjpeg' },
  { key: 'imagemagick', name: 'ImageMagick', monogram: 'IM', descriptionKey: 'dashboard.onboarding.tool.imagemagick' },
  { key: 'exiftool', name: 'ExifTool', monogram: 'EX', descriptionKey: 'dashboard.onboarding.tool.exiftool' },
  { key: 'video', name: 'HandBrakeCLI', monogram: 'HB', descriptionKey: 'dashboard.onboarding.tool.handbrake' }
];

const CORE_TOOL_KEYS: ExternalToolKey[] = ['image', 'imagemagick', 'video'];

const TOOL_STATUS_KEYS: Record<OnboardingToolState, TranslationKey> = {
  checking: 'dashboard.onboarding.toolStatus.checking',
  ready: 'dashboard.onboarding.toolStatus.ready',
  missing: 'dashboard.onboarding.toolStatus.missing',
  unknown: 'dashboard.onboarding.toolStatus.unknown'
};

export const getOnboardingToolState = (
  preflight: ToolPreflightState,
  toolKey: ExternalToolKey
): OnboardingToolState => {
  if (preflight.status === 'loading') return 'checking';
  if (preflight.status === 'error' || !preflight.snapshot) return 'unknown';
  return preflight.snapshot.tools[toolKey].status;
};

export const shouldPrioritizeToolSetup = (preflight: ToolPreflightState) => {
  if (preflight.status !== 'ready' || !preflight.snapshot) return true;
  if (preflight.snapshot.python.status === 'missing') return true;
  return CORE_TOOL_KEYS.some((key) => preflight.snapshot?.tools[key].status !== 'ready');
};

export const DashboardWelcomePanel = ({ preflight, onClose }: DashboardWelcomePanelProps) => {
  const { t } = useTranslation();
  const prioritizeToolSetup = shouldPrioritizeToolSetup(preflight);
  const pythonMissing = preflight.snapshot?.python.status === 'missing';
  const criticalMessage = preflight.status === 'error'
    ? preflight.error ?? t('toolsPreflight.unknown')
    : pythonMissing
      ? t('toolsPreflight.pythonMissing')
      : null;

  const settingsAction = (
    <Link
      className={`btn ${prioritizeToolSetup ? 'btn-primary' : 'btn-secondary'}`}
      to="/settings"
      state={{ returnTo: '/dashboard' }}
    >
      {t('dashboard.onboarding.configureTools')}
    </Link>
  );
  const importAction = (
    <Link className={`btn ${prioritizeToolSetup ? 'btn-secondary' : 'btn-primary'}`} to="/import">
      {t('dashboard.onboarding.startImport')}
    </Link>
  );

  return (
    <section className="dashboard-onboarding" aria-labelledby="dashboard-onboarding-title">
      <button
        className="dashboard-onboarding-close"
        type="button"
        onClick={onClose}
        aria-label={t('dashboard.onboarding.close')}
        title={t('dashboard.onboarding.close')}
      />

      <div className="dashboard-onboarding-main">
        <div className="dashboard-onboarding-copy">
          <div className="dashboard-onboarding-intro">
            <p className="panel-kicker">{t('dashboard.onboarding.kicker')}</p>
            <h2 className="dashboard-onboarding-title" id="dashboard-onboarding-title">
              {t('dashboard.onboarding.title')}
            </h2>
            <p className="dashboard-onboarding-description">{t('dashboard.onboarding.description')}</p>
          </div>

          <div className="dashboard-onboarding-tools-heading">
            <div>
              <p className="dashboard-onboarding-eyebrow">{t('dashboard.onboarding.toolsLabel')}</p>
              <h3>{t('dashboard.onboarding.toolsTitle')}</h3>
            </div>
            <p>{t('dashboard.onboarding.toolsDescription')}</p>
          </div>

          <div className="dashboard-onboarding-tools" aria-live="polite">
            {ONBOARDING_TOOLS.map((tool) => {
              const state = getOnboardingToolState(preflight, tool.key);

              return (
                <article className="dashboard-onboarding-tool" key={tool.key}>
                  <span className="dashboard-onboarding-tool-mark" aria-hidden="true">{tool.monogram}</span>
                  <div className="dashboard-onboarding-tool-copy">
                    <div className="dashboard-onboarding-tool-heading">
                      <strong>{tool.name}</strong>
                      <span className={`dashboard-onboarding-tool-status dashboard-onboarding-tool-status-${state}`}>
                        <span className="dashboard-onboarding-tool-status-dot" aria-hidden="true" />
                        {t(TOOL_STATUS_KEYS[state])}
                      </span>
                    </div>
                    <p>{t(tool.descriptionKey)}</p>
                  </div>
                </article>
              );
            })}
          </div>

          {criticalMessage && (
            <div className="dashboard-onboarding-critical" role="alert">
              <strong>{t('dashboard.onboarding.runtimeAttention')}</strong>
              <p>{criticalMessage}</p>
            </div>
          )}

          <div className="dashboard-onboarding-actions">
            {prioritizeToolSetup ? settingsAction : importAction}
            {prioritizeToolSetup ? importAction : settingsAction}
          </div>
        </div>

        <div className="dashboard-onboarding-visual" aria-hidden="true">
          <div className="dashboard-onboarding-art">
            <div className="dashboard-onboarding-art-orb dashboard-onboarding-art-orb-a" />
            <div className="dashboard-onboarding-art-orb dashboard-onboarding-art-orb-b" />
            <div className="dashboard-onboarding-art-card dashboard-onboarding-art-card-main">
              <span>{t('dashboard.onboarding.artFrom')}</span>
              <strong>{t('dashboard.onboarding.artTo')}</strong>
            </div>
            <div className="dashboard-onboarding-art-card dashboard-onboarding-art-card-top">
              <span>{t('dashboard.onboarding.artChoose')}</span>
            </div>
            <div className="dashboard-onboarding-art-card dashboard-onboarding-art-card-bottom">
              <span>{t('dashboard.onboarding.artExport')}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default DashboardWelcomePanel;
