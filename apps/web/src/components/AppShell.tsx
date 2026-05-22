import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Stepper, type StepConfig } from './Stepper';
import { useTheme } from '../hooks/useTheme';
import { useImportStepCompletion } from '../hooks/useImportStepCompletion';
import { useFolderSelections } from '../hooks/useFolderSelections';
import { useCompressionSessionState } from '../hooks/useCompressionJobState';
import { useGroupingSessionState } from '../hooks/useGroupingJobState';
import { useTranslation } from '../i18n';

const workflowStepBlueprint = [
  {
    id: 'import',
    number: 1,
    path: '/import'
  },
  {
    id: 'selection',
    number: 2,
    path: '/selection'
  },
  {
    id: 'compression',
    number: 3,
    path: '/compression'
  },
  {
    id: 'grouping',
    number: 4,
    path: '/grouping'
  },
  {
    id: 'export',
    number: 5,
    path: '/export'
  }
] as const;

const AppShell = () => {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { currentLanguage, languages, locale, setLocale, t } = useTranslation();
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const isImportStepComplete = useImportStepCompletion();
  const { sourceSelection, destinationSelection } = useFolderSelections();
  const isSelectionComplete = isImportStepComplete && Boolean(sourceSelection && destinationSelection);
  const compressionSessionState = useCompressionSessionState();
  const isCompressionComplete = compressionSessionState.status === 'completed';
  const groupingSessionState = useGroupingSessionState();
  const isGroupingReadyForExport = groupingSessionState.status === 'completed' || Boolean(groupingSessionState.outputRootLabel);

  const workflowSteps: StepConfig[] = workflowStepBlueprint.map((step) => ({
    ...step,
    label: t(`workflow.${step.id}.label`),
    description: t(`workflow.${step.id}.description`),
    state: (() => {
      if (step.id === 'import') {
        return isImportStepComplete ? 'completed' : 'pending';
      }

      if (step.id === 'selection') {
        return isSelectionComplete ? 'completed' : isImportStepComplete ? 'pending' : 'locked';
      }

      if (step.id === 'compression') {
        return isCompressionComplete ? 'completed' : isSelectionComplete ? 'pending' : 'locked';
      }

      if (step.id === 'grouping') {
        return isGroupingReadyForExport ? 'completed' : isCompressionComplete ? 'pending' : 'locked';
      }

      return isGroupingReadyForExport ? 'pending' : 'locked';
    })()
  }));

  const currentIndex = workflowStepBlueprint.findIndex((s) => location.pathname === s.path || location.pathname.startsWith(`${s.path}/`));

  if (currentIndex > 0) {
    for (let i = 0; i < currentIndex; i++) {
      const step = workflowSteps[i];

      if (step.state !== 'locked') {
        workflowSteps[i] = {
          ...step,
          state: 'completed'
        };
      }
    }
  }

  const currentStep = workflowSteps.find((s) => location.pathname === s.path || location.pathname.startsWith(`${s.path}/`));
  const isDashboard = location.pathname === '/dashboard';
  const headerTitles: Record<string, string> = {
    import: t('shell.header.import'),
    selection: t('shell.header.selection'),
    compression: t('shell.header.compression'),
    grouping: t('shell.header.grouping'),
    export: t('shell.header.export')
  };

  return (
    <div className="app-shell-zen">
      <aside className="sidebar-zen">
        <div className="sidebar-header">
          <p className="brand-name brand-name-primary">{t('app.brand')}</p>
        </div>

        <section className="sidebar-section">
          <p className="sidebar-label">{t('shell.process')}</p>
          <Stepper steps={workflowSteps} />
        </section>

        <section className="sidebar-section sidebar-quick-access">
          <p className="sidebar-label">{t('shell.quickAccess')}</p>
          <Link to="/dashboard" className={`quick-link ${isDashboard ? 'active' : ''}`}>
            📊 {t('shell.dashboard')}
          </Link>
          <Link to="/settings" className={`quick-link ${location.pathname === '/settings' ? 'active' : ''}`}>
            🔧 {t('shell.settings')}
          </Link>
        </section>

        <div className="sidebar-footer">
          <div className="language-selector">
            <button
              className="settings-btn language-btn"
              type="button"
              title={t('language.selector.title')}
              aria-label={t('language.selector.label')}
              aria-haspopup="menu"
              aria-expanded={isLanguageMenuOpen}
              onClick={() => setIsLanguageMenuOpen((current) => !current)}
            >
              <span aria-hidden="true">{currentLanguage.flag}</span>
              <span>{currentLanguage.shortLabel}</span>
            </button>
            {isLanguageMenuOpen && (
              <div className="language-menu" role="menu" aria-label={t('language.selector.label')}>
                {languages.map((language) => (
                  <button
                    key={language.locale}
                    className={`language-menu-item ${locale === language.locale ? 'is-active' : ''}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={locale === language.locale}
                    onClick={() => {
                      setLocale(language.locale);
                      setIsLanguageMenuOpen(false);
                    }}
                  >
                    <span aria-hidden="true">{language.flag}</span>
                    <span>{language.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="settings-btn theme-btn"
            type="button"
            title={theme === 'dark' ? t('theme.switchToLight') : t('theme.switchToDark')}
            aria-label={theme === 'dark' ? t('theme.switchToLight') : t('theme.switchToDark')}
            aria-pressed={theme === 'dark'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? `☀️ ${t('theme.light')}` : `🌙 ${t('theme.dark')}`}
          </button>
        </div>
      </aside>

      <div className="main-zen">
        <header className="header-zen">
          <div>
            {currentStep && <p className="header-title">{headerTitles[currentStep.id] ?? `${currentStep.label} your media`}</p>}
            {isDashboard && <p className="header-title">{t('shell.header.dashboard')}</p>}
          </div>
        </header>

        <main className="content-zen">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export { AppShell };
export default AppShell;
