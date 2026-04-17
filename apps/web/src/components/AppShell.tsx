import { Link, Outlet, useLocation } from 'react-router-dom';
import { Stepper, type StepConfig } from './Stepper';
import { useTheme } from '../hooks/useTheme';

const workflowSteps: StepConfig[] = [
  {
    id: 'import',
    number: 1,
    label: 'Import',
    description: 'Select folders',
    path: '/import',
    state: 'active'
  },
  {
    id: 'preview',
    number: 2,
    label: 'Preview',
    description: 'Review items',
    path: '/preview',
    state: 'pending'
  },
  {
    id: 'compression',
    number: 3,
    label: 'Compression',
    description: 'Optimize media',
    path: '/compression',
    state: 'pending'
  },
  {
    id: 'grouping',
    number: 4,
    label: 'Grouping',
    description: 'Structure output',
    path: '/grouping',
    state: 'pending'
  }
];

export const AppShell = () => {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  const currentStep = workflowSteps.find((s) => s.path === location.pathname);
  const isDashboard = location.pathname === '/dashboard';
  const isJobs = location.pathname === '/jobs';

  return (
    <div className="app-shell-zen">
      {/* Left sidebar */}
      <aside className="sidebar-zen">
        {/* Logo */}
        <div className="sidebar-header">
          <p className="brand-monogram">MO</p>
          <p className="brand-name">Media Organizer</p>
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
                <p className="header-title">{currentStep.label} your media</p>
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
