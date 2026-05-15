import { Link, Outlet, useLocation } from 'react-router-dom';
import { Stepper, type StepConfig } from './Stepper';
import { useTheme } from '../hooks/useTheme';
import { useImportStepCompletion } from '../hooks/useImportStepCompletion';
import { useFolderSelections } from '../hooks/useFolderSelections';
import { useCompressionSessionState } from '../hooks/useCompressionJobState';

const workflowStepBlueprint = [
  {
    id: 'import',
    number: 1,
    label: 'Import',
    description: 'Choose source & destination',
    path: '/import'
  },
  {
    id: 'selection',
    number: 2,
    label: 'Selection',
    description: 'Include and exclude scope',
    path: '/selection'
  },
  {
    id: 'compression',
    number: 3,
    label: 'Compression',
    description: 'Set quality and size',
    path: '/compression'
  },
  {
    id: 'grouping',
    number: 4,
    label: 'Grouping',
    description: 'Organize the output',
    path: '/grouping'
  }
] as const;

const AppShell = () => {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const isImportStepComplete = useImportStepCompletion();
  const { sourceSelection, destinationSelection } = useFolderSelections();
  const isSelectionComplete = isImportStepComplete && Boolean(sourceSelection && destinationSelection);
  const compressionSessionState = useCompressionSessionState();
  const isCompressionComplete = compressionSessionState.status === 'completed';

  const workflowSteps: StepConfig[] = workflowStepBlueprint.map((step, index) => ({
    ...step,
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

      // grouping
      return isCompressionComplete ? 'pending' : 'locked';
    })()
  }));

  const currentIndex = workflowStepBlueprint.findIndex((s) => s.path === location.pathname);

  // If the user is on a later step, mark earlier unlocked steps as completed
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

  const currentStep = workflowSteps.find((s) => s.path === location.pathname);
  const isDashboard = location.pathname === '/dashboard';
  const headerTitles: Record<string, string> = {
    import: 'Prepare your source folders',
    selection: 'Select what gets compressed',
    compression: 'Tune compression settings and launch the session',
    grouping: 'Review the final structure'
  };

  return (
    <div className="app-shell-zen">
      {/* Left sidebar */}
      <aside className="sidebar-zen">
        {/* Logo */}
        <div className="sidebar-header">
          <p className="brand-name brand-name-primary">Media Organizer</p>
        </div>

        {/* Workflow stepper */}
        <section className="sidebar-section">
          <p className="sidebar-label">Process</p>
          <Stepper steps={workflowSteps} />
        </section>

        {/* Quick access */}
        <section className="sidebar-section sidebar-quick-access">
          <p className="sidebar-label">Quick Access</p>
          <Link to="/dashboard" className={`quick-link ${isDashboard ? 'active' : ''}`}>
            📊 Dashboard
          </Link>
          <Link to="/settings" className={`quick-link ${location.pathname === '/settings' ? 'active' : ''}`}>
            🔧 Settings
          </Link>
        </section>

        {/* Settings footer */}
        <div className="sidebar-footer">
          <button className="settings-btn language-btn" type="button" title="Toggle language (EN/ES)">
            EN
          </button>
          <button
            className="settings-btn theme-btn"
            type="button"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-pressed={theme === 'dark'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="main-zen">
        {/* Header with context */}
        <header className="header-zen">
          <div>
            {currentStep && (
              <>
                <p className="header-title">{headerTitles[currentStep.id] ?? `${currentStep.label} your media`}</p>
              </>
            )}
            {isDashboard && <p className="header-title">Control panel</p>}
          </div>
        </header>

        {/* Content area */}
        <main className="content-zen">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export { AppShell };
export default AppShell;
