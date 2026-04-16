import { NavLink, Outlet } from 'react-router-dom';

const navItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/import', label: 'Import' },
  { to: '/preview', label: 'Preview' },
  { to: '/compression', label: 'Compression' },
  { to: '/grouping', label: 'Grouping' },
  { to: '/jobs', label: 'Jobs' }
];

export const AppShell = () => {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <p className="brand-kicker">Local-First Toolkit</p>
        <h1 className="brand-title">Media Organizer</h1>
        <nav className="main-nav" aria-label="Main">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div>
            <p className="topbar-kicker">Workflow mock</p>
            <p className="topbar-title">Skeleton UI + fake data layer</p>
          </div>
          <button className="btn btn-secondary" type="button">
            New mocked job
          </button>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
