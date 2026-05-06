import { Link, Outlet, useLocation } from 'react-router-dom';
import { Stepper, type StepConfig } from './Stepper';
import { useTheme } from '../hooks/useTheme';
import { useImportStepCompletion } from '../hooks/useImportStepCompletion';
import { useCompressionJobState } from '../hooks/useCompressionJobState';

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
  const compressionJobState = useCompressionJobState();
  const isCompressionComplete = compressionJobState.status === 'completed';

  const workflowSteps: StepConfig[] = workflowStepBlueprint.map((step, index) => ({
    ...step,
    state:
      index === 0 || isImportStepComplete
        ? step.id === 'grouping' && !isCompressionComplete
          ? 'locked'
          : 'pending'
        : 'locked'
  }));

  const currentStep = workflowSteps.find((s) => s.path === location.pathname);
  const isDashboard = location.pathname === '/dashboard';
  const isJobs = location.pathname === '/jobs';
  const headerTitles: Record<string, string> = {
    import: 'Prepare your source folders',
    selection: 'Select what gets compressed',
    compression: 'Tune compression settings and launch jobs',
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
          <Link to="/jobs" className={`quick-link ${isJobs ? 'active' : ''}`}>
            ⚙️ Jobs
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
            {isJobs && <p className="header-title">Processing jobs</p>}
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
